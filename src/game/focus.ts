import type { FactionId, FocusEffect, FocusNode } from '../core/types';
import { FOCUS_TREES, FEDERATION_BRANCH } from '../data/focus';
import { FACTIONS, SPECIALS } from '../data/factions';
import { troopsOf } from '../data/troops';
import { bus } from '../core/emitter';
import { pushLog, spawnFleet, planetsOf, type GameState } from './state';

const LOW_STABILITY = 40;

export function canSelectFocus(state: GameState, faction: FactionId, node: FocusNode): boolean {
  const fs = state.factions[faction];
  if (fs.completedFocus.includes(node.id)) return false;
  if (!node.requires.every((r) => fs.completedFocus.includes(r))) return false;
  if (node.gate === 'lowStability' && fs.stability >= LOW_STABILITY) return false;
  return true;
}

export function selectFocus(state: GameState, faction: FactionId, id: string): boolean {
  const node = FOCUS_TREES[faction].find((f) => f.id === id);
  if (!node || !canSelectFocus(state, faction, node)) return false;
  state.factions[faction].activeFocus = { id, remaining: node.cost };
  return true;
}

/** Advance the active focus for one day; complete it when the timer elapses. */
export function stepFocus(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.activeFocus) {
    // AI / auto: pick the next sensible focus.
    if (faction !== state.player) autoPickFocus(state, faction);
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
  const node = FOCUS_TREES[faction].find((f) => f.id === id);
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

export function riseSuperFederation(state: GameState): void {
  if (state.superFederationRisen) return;
  state.superFederationRisen = true;
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
function ancestorsOf(faction: FactionId, id: string): Set<string> {
  const tree = FOCUS_TREES[faction];
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
  const options = FOCUS_TREES[faction].filter((n) => {
    if (fs.completedFocus.includes(n.id)) return false;
    if (!n.requires.every((r) => fs.completedFocus.includes(r))) return false;
    if (n.gate === 'lowStability' && fs.stability >= LOW_STABILITY) return false;
    return true;
  });
  if (!options.length) return;
  // Фракция с ключевым спецпроектом целенаправленно прокладывает путь к нему.
  const goal = AI_GOALS[faction];
  const path = goal && !fs.completedFocus.includes(goal) ? ancestorsOf(faction, goal) : null;
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
    if (e.kind === 'combat') w += 2;
    if (e.kind === 'fleet') w += 2;
    if (e.kind === 'recruitment') w += 1;
    if (e.kind === 'shipCap') w += 1;
  }
  return w;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
