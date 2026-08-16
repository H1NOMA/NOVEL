import type { FactionId, FocusEffect, FocusNode } from '../core/types';
import { FOCUS_TREES, FEDERATION_BRANCH } from '../data/focus';
import { treeFor } from './trophies';
import { adjustRelation, riseFederation } from './relations';
import { FACTIONS, SPECIALS } from '../data/factions';
import { troopsOf } from '../data/troops';
import { bus } from '../core/emitter';
import { isHuman, fleetsOf, pushLog, spawnFleet, planetsOf, type GameState } from './state';
import { gainXp } from './veterancy';

const LOW_STABILITY = 40;

/** Киберстан (родная столица автоматонов) потерян? */
export function cyberstanLost(state: GameState): boolean {
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    if (p.origin === 'automatons' && p.isCapital) return p.owner !== 'automatons' || p.shattered;
  }
  return true; // столицы больше нет вовсе
}

function gatePasses(state: GameState, faction: FactionId, node: FocusNode): boolean {
  const fs = state.factions[faction];
  if (node.gate === 'lowStability' && fs.stability >= LOW_STABILITY) return false;
  if (node.gate === 'cyberstanLost' && !cyberstanLost(state)) return false;
  if (node.gate === 'arkReady' &&
      (planetsOf(state, 'automatons').length > 0 || !fs.flags.arkPrepared || fs.flags.arkDone)) return false;
  return true;
}

export function canSelectFocus(state: GameState, faction: FactionId, node: FocusNode): boolean {
  const fs = state.factions[faction];
  if (fs.completedFocus.includes(node.id)) return false;
  if (!node.requires.every((r) => fs.completedFocus.includes(r))) return false;
  return gatePasses(state, faction, node);
}

export function selectFocus(state: GameState, faction: FactionId, id: string): boolean {
  const node = treeFor(state, faction).find((f) => f.id === id);
  if (!node || !canSelectFocus(state, faction, node)) return false;
  state.factions[faction].activeFocus = { id, remaining: node.cost };
  return true;
}

/** Advance the active focus for one day; complete it when the timer elapses. */
export function stepFocus(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.alive) return;
  if (!fs.activeFocus) {
    // AI / auto: pick the next sensible focus.
    if (!isHuman(state, faction)) autoPickFocus(state, faction);
    return;
  }
  const rate = 1 + fs.bonuses.industry * 0.02;
  fs.activeFocus.remaining -= rate;
  if (fs.activeFocus.remaining <= 0) {
    const id = fs.activeFocus.id;
    fs.activeFocus = undefined;
    completeFocus(state, faction, id);
  }
}

function completeFocus(state: GameState, faction: FactionId, id: string): void {
  const node = treeFor(state, faction).find((f) => f.id === id);
  if (!node) return;
  const fs = state.factions[faction];
  fs.completedFocus.push(id);
  for (const eff of node.effects) applyEffect(state, faction, eff);

  pushLog(state, {
    faction,
    text: `${FACTIONS[faction].short}: фокус «${node.title}» завершён.`,
    tone: faction === state.player ? 'good' : 'info',
  });
  bus.emit('focusCompleted', { faction, id });

  // Super Federation rises once the majority of the Path to Federation is walked.
  if (faction === 'superEarth' && !state.superFederationRisen) {
    const done = FEDERATION_BRANCH.filter((f) => fs.completedFocus.includes(f)).length;
    const needed = Math.ceil(FEDERATION_BRANCH.length * 0.6);
    if (done >= needed) riseSuperFederation(state);
  }
}

function applyEffect(state: GameState, faction: FactionId, eff: FocusEffect): void {
  const fs = state.factions[faction];
  switch (eff.kind) {
    case 'warSupport':
      fs.warSupport = clamp(fs.warSupport + eff.amount, 0, 100);
      break;
    case 'recruitment':
      fs.bonuses.recruitment += eff.amount;
      break;
    case 'industry':
      fs.bonuses.industry += eff.amount;
      fs.industry += eff.amount;
      break;
    case 'shipCap':
      fs.bonuses.shipCap += eff.amount;
      break;
    case 'combat':
      fs.bonuses.combat += eff.amount;
      break;
    case 'fortify':
      fs.bonuses.fortify += eff.amount;
      break;
    case 'stability':
      fs.stability = clamp(fs.stability + eff.amount, 0, 100);
      break;
    case 'manpower': {
      // Прирост уходит в массовую пехоту фракции.
      const mass = troopsOf(faction).find((t) => t.role === 'mass');
      if (mass) fs.units[mass.id] = (fs.units[mass.id] ?? 0) + eff.amount;
      fs.manpower = Object.values(fs.units).reduce((s, n) => s + n, 0);
      break;
    }
    case 'flag':
      fs.flags[eff.flag] = true;
      break;
    case 'fleet': {
      const worlds = planetsOf(state, faction);
      const home = worlds.find((p) => p.isCapital) ?? worlds[0];
      if (home) spawnFleet(state, faction, home.id, { ships: eff.ships, infantry: eff.infantry });
      break;
    }
    case 'unlockSpecial':
      unlockSpecial(state, faction);
      break;
    case 'spawnSuperFederation':
      if (!state.superFederationRisen) riseSuperFederation(state);
      break;
    case 'arkArrival':
      arkArrival(state);
      break;
    // --- уникальные разовые эффекты ---
    case 'production':
      fs.production += eff.amount;
      break;
    case 'politicalPower':
      fs.politicalPower += eff.amount;
      break;
    case 'resources':
      fs.resources.minerals += eff.minerals;
      fs.resources.e711 += eff.e711;
      break;
    case 'garrisonAll':
      for (const p of planetsOf(state, faction)) p.garrison += eff.amount;
      break;
    case 'fortifyAll':
      for (const p of planetsOf(state, faction)) p.fortification = Math.min(5, p.fortification + eff.amount);
      break;
    case 'xpAll':
      for (const f of fleetsOf(state, faction)) gainXp(f, eff.amount);
      break;
    case 'revealAll': {
      // Разведать все сектора: срок отсчитывается от текущего дня.
      const sectors = new Set(state.galaxy.order.map((id) => state.galaxy.planets.get(id)!.sector));
      for (const sector of sectors) {
        const cur = state.recons.find((r) => r.sector === sector);
        const until = state.day + eff.days;
        if (cur) cur.until = Math.max(cur.until, until);
        else state.recons.push({ sector, until });
      }
      break;
    }
    case 'truceAll':
      for (const other of Object.keys(state.factions) as FactionId[]) {
        if (other === faction || !state.factions[other].alive) continue;
        state.truces.push({ a: faction, b: other, until: state.day + eff.days });
      }
      break;
    case 'returnTerritory': {
      // Возврат земель: отдаём захваченные миры их исконным хозяевам. Каждый
      // такой жест резко чинит отношения, а иногда и заканчивает войну.
      const conquered = planetsOf(state, faction)
        .filter((p) => p.origin !== faction && state.factions[p.origin]?.alive && !p.isCapital && !p.battle)
        .sort((a, b) => a.value - b.value)
        .slice(0, eff.count);
      for (const p of conquered) {
        const to = p.origin;
        p.owner = to;
        adjustRelation(state, faction, to, 22);
        pushLog(state, {
          faction,
          text: `${p.name} возвращён фракции «${FACTIONS[to].name}». Земля в обмен на мир.`,
          tone: 'info',
        });
      }
      break;
    }
    case 'freeDefenses': {
      const worlds = planetsOf(state, faction)
        .filter((p) => p.supplied && !p.abyss)
        .sort((a, b) => (b.isCapital ? 100 : b.value) - (a.isCapital ? 100 : a.value))
        .slice(0, eff.count);
      for (const p of worlds) {
        if (!p.buildings.includes('shieldGen')) p.buildings.push('shieldGen');
        if (!p.buildings.includes('orbStation')) p.buildings.push('orbStation');
      }
      break;
    }
    case 'recallFleets': {
      const worlds = planetsOf(state, faction);
      const home = worlds.find((p) => p.isCapital) ?? worlds[0];
      if (home) {
        for (const f of fleetsOf(state, faction)) {
          f.transit = undefined;
          f.at = home.id;
          f.order = { kind: 'idle' };
          f.origin = undefined;
        }
      }
      break;
    }
    case 'gloomSurge':
      for (const seed of state.gloomSeeds) seed.daysLeft = Math.min(seed.daysLeft, 1);
      break;
    case 'heavyFleet': {
      const worlds = planetsOf(state, faction);
      const home = worlds.find((p) => p.isCapital) ?? worlds[0];
      if (home) {
        spawnFleet(state, faction, home.id, {
          ships: eff.ships,
          dreadnoughts: eff.dreadnoughts,
          battleships: eff.battleships,
          infantry: eff.infantry,
        });
      }
      break;
    }
    case 'custom':
      break;
  }
}

function unlockSpecial(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (fs.specialUnlocked) return;
  fs.specialUnlocked = true;
  const spec = SPECIALS[faction];
  const worlds = planetsOf(state, faction);
  const home = worlds.find((p) => p.isCapital) ?? worlds[0];
  if (!home) return;
  spawnFleet(state, faction, home.id, { ships: 14, infantry: 40, special: spec.id });
  pushLog(state, {
    faction,
    text: `${spec.name} — вступает в строй над ${home.name}!`,
    tone: faction === state.player ? 'good' : 'alert',
  });
}

/**
 * ПРОЕКТ «КОВЧЕГ». Из тьмы за границей карты — со стороны рубежа, занятого
 * Супер-Землёй, — прибывает Ковчег автоматонов: флагман-супероружие
 * («гордость машинного флота»). Плацдарм: пять пограничных миров СЗ
 * переходят к машинам, а новый флот равен половине сил флота Супер-Земли.
 */
export function arkArrival(state: GameState): void {
  const aut = state.factions.automatons;
  if (aut.flags.arkDone) return;
  aut.flags.arkDone = true;
  aut.alive = true;

  // Точка прорыва: мир СЗ на внешнем рубеже карты (граница тьмы).
  const seWorlds = planetsOf(state, 'superEarth').filter((p) => !p.abyss);
  if (!seWorlds.length) return;
  const rim = seWorlds.filter((p) => p.radius >= state.galaxy.radiusMax * 0.66);
  const beachheadSeed = state.rng.pick(rim.length ? rim : seWorlds);

  // Пять ближайших к точке прорыва миров СЗ становятся плацдармом машин.
  const targets = seWorlds
    .sort((a, b) =>
      Math.hypot(a.pos.x - beachheadSeed.pos.x, a.pos.y - beachheadSeed.pos.y) -
      Math.hypot(b.pos.x - beachheadSeed.pos.x, b.pos.y - beachheadSeed.pos.y))
    .slice(0, 5);
  for (const p of targets) {
    state.lastConqueror.superEarth = 'automatons';
    p.owner = 'automatons';
    p.battle = undefined;
    p.puppetOf = undefined;
    p.garrison = 55;
    p.fortification = Math.max(p.fortification, 2);
    for (const c of p.cities) c.holder = 'automatons';
  }

  // Флотилия в половину мощи флота Супер-Земли (у СЗ ничего не отнимается).
  const sePower = fleetsOf(state, 'superEarth')
    .reduce((s, f) => s + f.ships + f.dreadnoughts * 3 + f.battleships * 6, 0);
  const grant = Math.max(14, Math.round(sePower / 2));
  const bb = Math.floor(grant / 12);
  const dd = Math.floor((grant - bb * 6) / 8);
  const ships = Math.max(4, grant - bb * 6 - dd * 3);

  // Сам Ковчег — флагман-супероружие во главе нового флота.
  aut.specialUnlocked = true;
  aut.lostSpecial = false;
  spawnFleet(state, 'automatons', beachheadSeed.id, {
    ships: Math.ceil(ships / 2),
    dreadnoughts: dd,
    battleships: bb + 1,
    infantry: 80,
    special: 'ark',
  });
  const second = targets[1] ?? beachheadSeed;
  spawnFleet(state, 'automatons', second.id, {
    ships: Math.floor(ships / 2),
    infantry: 60,
  });

  // Экипажи и припасы исхода.
  aut.units.vsa = (aut.units.vsa ?? 0) + 220;
  aut.manpower = Object.values(aut.units).reduce((s, n) => s + n, 0);
  aut.production += 150;
  aut.resources.minerals += 60;
  aut.aiPlan = undefined;
  if (state.player === 'automatons') state.playerDefeated = false;

  pushLog(state, {
    text: `ИЗ ТЬМЫ КОСМОСА ПРИБЫВАЕТ КОВЧЕГ АВТОМАТОНОВ. Пограничные миры Супер-Земли (${targets.map((p) => p.name).join(', ')}) захвачены машинами. Гордость машинного флота вступает в войну!`,
    tone: 'alert',
  });
  bus.emit('gameEvent', {
    title: 'ПРОЕКТ «КОВЧЕГ»',
    text: 'Из тьмы за краем карты прибывает Ковчег автоматонов. Машины вернулись.',
  });
}

export function riseSuperFederation(state: GameState): void {
  if (state.superFederationRisen) return;
  state.superFederationRisen = true;
  // Конкорд поднимается сразу против всех — мира с ним ни у кого нет.
  riseFederation(state);
  const fed = state.factions.superFederation;
  fed.alive = true;

  // Flip a few random Super-Earth sectors to the Super Federation (orange).
  const seSectors = [...state.galaxy.sectors.values()].filter((s) =>
    s.planets.some((pid) => state.galaxy.planets.get(pid)!.owner === 'superEarth') && s.ring >= 1
  );
  state.rng.shuffle(seSectors);
  const flipCount = Math.min(4, Math.max(2, Math.floor(seSectors.length * 0.25)));
  const flipped: string[] = [];
  for (const sector of seSectors.slice(0, flipCount)) {
    for (const pid of sector.planets) {
      const p = state.galaxy.planets.get(pid)!;
      if (p.owner === 'superEarth' && !p.isCapital) {
        p.owner = 'superFederation';
        flipped.push(pid);
      }
    }
  }
  // The strongest seceded world becomes the Federation capital, New Concord.
  const bases = flipped.map((id) => state.galaxy.planets.get(id)!);
  if (bases.length) {
    const cap = bases.reduce((a, b) => (b.value + b.garrison > a.value + a.garrison ? b : a));
    cap.isCapital = true;
    cap.name = 'Новый Конкорд';
    cap.scale = Math.max(cap.scale, 1.35);
    cap.garrison = Math.max(cap.garrison, 90);
    cap.fortification = 4;
    cap.value = 8;
  }
  // Give the Federation a starting navy from the seceded worlds.
  for (let i = 0; i < Math.min(3, bases.length); i++) {
    const base = bases[i]!;
    base.garrison = Math.max(base.garrison, 60);
    spawnFleet(state, 'superFederation', base.id, { ships: 8, infantry: 30 });
  }
  // Stability shock to Super Earth.
  state.factions.superEarth.stability = clamp(state.factions.superEarth.stability - 20, 0, 100);

  pushLog(state, {
    text: `РАСКОЛ! Миров подняло оранжевое знамя СУПЕР-ФЕДЕРАЦИИ: ${flipped.length}. Отныне она воюет против Супер-Земли и всех остальных.`,
    tone: 'alert',
  });
  bus.emit('superFederationRose', undefined);
}

/** Ключевые спецпроекты, к которым ИИ фракций идёт направленно. */
const AI_GOALS: Partial<Record<FactionId, string>> = {
  terminids: 'term_sp_gloomcloud',
  illuminate: 'ill_sp_abyss',
};

/** Все предки узла (включая его самого) по графу requires. */
function ancestorsOf(state: GameState, faction: FactionId, id: string): Set<string> {
  const tree = treeFor(state, faction);
  const acc = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (acc.has(cur)) continue;
    acc.add(cur);
    const node = tree.find((n) => n.id === cur);
    if (node) stack.push(...node.requires);
  }
  return acc;
}

/** Simple AI focus selection: pick the cheapest currently-selectable focus. */
export function autoPickFocus(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (fs.activeFocus) return;
  const options = treeFor(state, faction).filter((n) => canSelectFocus(state, faction, n));
  if (!options.length) return;
  // Фракция с ключевым спецпроектом целенаправленно прокладывает путь к нему.
  const goal = AI_GOALS[faction];
  const path = goal && !fs.completedFocus.includes(goal) ? ancestorsOf(state, faction, goal) : null;
  const bonus = (n: FocusNode) => (path?.has(n.id) ? 10 : 0);
  options.sort((a, b) => weight(b) + bonus(b) - weight(a) - bonus(a) || a.cost - b.cost);
  const pick = options[0]!;
  fs.activeFocus = { id: pick.id, remaining: pick.cost };
}

function weight(n: FocusNode): number {
  let w = 0;
  for (const e of n.effects) {
    if (e.kind === 'unlockSpecial') w += 3;
    if (e.kind === 'flag') w += 3; // спецпроекты (Мрак, Бездна) — приоритет ИИ
    if (e.kind === 'heavyFleet') w += 3;
    if (e.kind === 'combat') w += 2;
    if (e.kind === 'fleet') w += 2;
    if (e.kind === 'freeDefenses') w += 2;
    if (e.kind === 'garrisonAll') w += 1;
    if (e.kind === 'recruitment') w += 1;
    if (e.kind === 'shipCap') w += 1;
  }
  return w;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
