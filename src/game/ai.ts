import type { FactionId, Fleet, Planet } from '../core/types';
import { areHostile, FACTIONS } from '../data/factions';
import { fleetsOf, planetsOf, pushLog, spawnFleet, type GameState } from './state';
import { orderFleetTo } from './units';
import { canEnter } from './supply';
import { hostileNow } from './diplomacy';
import { drawUnits, mineE711, mineMinerals, replenishUnits, totalUnits } from './troops';
import { accruePower } from './politics';
import { bus } from '../core/emitter';

const FLEET_COST = 45;
const INFANTRY_CAP = 45;

export function fleetCap(state: GameState, faction: FactionId): number {
  const base = faction === 'superEarth' ? 7 : 5;
  return base + state.factions[faction].bonuses.shipCap;
}

/** Daily economy for every faction: production, manpower, fleet building, reload. */
export function runEconomy(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.alive) return;
  const worlds = planetsOf(state, faction);
  if (worlds.length === 0) {
    // Проект «Ковчег»: разбитые автоматоны с чертежами не гибнут — их разум
    // уходит во тьму за край карты и достраивает корабль-исход.
    if (faction === 'automatons' && fs.flags.arkPrepared && !fs.flags.arkDone) {
      if (!fs.flags.arkGhost) {
        fs.flags.arkGhost = true;
        const by = state.lastConqueror[faction] ?? null;
        for (const f of fleetsOf(state, faction)) f.order = { kind: 'idle' };
        if (faction === state.player) state.playerDefeated = true;
        pushLog(state, {
          faction,
          text: 'Супер-Земля победила автоматонов… но сигнал РАЗУМ-9 ещё звучит из тьмы. Доступен фокус «ПРОЕКТ „КОВЧЕГ“».',
          tone: faction === state.player ? 'alert' : 'good',
        });
        bus.emit('factionDefeated', { faction, by });
      }
      return;
    }
    // runEconomy is only invoked for active factions, so the Super Federation
    // reaches this path only after it has actually risen.
    eliminate(state, faction);
    return;
  }

  const income = worlds.reduce((s, p) => s + p.value, 0);
  fs.production += 0.4 * (fs.industry + income * 0.3);
  accruePower(state, faction);

  // Добыча ископаемых, пополнение пулов войск, добыча Е-711.
  mineMinerals(state, faction);
  replenishUnits(state, faction);
  if (faction === 'superEarth') mineE711(state);

  // Содержание флота: каждый корпус ежедневно ест производство.
  const upkeep = fleetsOf(state, faction)
    .reduce((s, f) => s + f.ships + f.dreadnoughts * 2 + f.battleships * 4, 0) * 0.05;
  fs.production = Math.max(0, fs.production - upkeep);

  // Build a new fleet when affordable and under the cap.
  // Игрок строит корабли сам — на верфях; автосборка флотов только у ИИ.
  const fleets = fleetsOf(state, faction);
  if (faction !== state.player && fs.production >= FLEET_COST && fleets.length < fleetCap(state, faction) && totalUnits(fs) >= 20) {
    fs.production -= FLEET_COST;
    const crew = drawUnits(fs, 20);
    const yard = worlds.find((p) => p.isCapital) ?? worlds[0]!;
    spawnFleet(state, faction, yard.id, { ships: 6, infantry: crew });
  }

  // Флоты на своих планетах докомплектовывают пехоту из пулов.
  for (const f of fleets) {
    if (f.transit) continue;
    const p = state.galaxy.planets.get(f.at);
    if (p && p.owner === faction && f.infantry < INFANTRY_CAP) {
      const load = drawUnits(fs, Math.min(4, INFANTRY_CAP - f.infantry));
      f.infantry += load;
    }
  }
  fs.manpower = totalUnits(fs);
}

function eliminate(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.alive) return;
  fs.alive = false;
  fs.activeFocus = undefined;
  for (const f of fleetsOf(state, faction)) f.order = { kind: 'idle' };
  const by = state.lastConqueror[faction] ?? null;
  pushLog(state, {
    faction,
    text: `Фракция «${FACTIONS[faction].name}» повержена и изгнана из галактики!`,
    tone: faction === state.player ? 'bad' : 'good',
  });
  if (faction === state.player) state.playerDefeated = true;
  bus.emit('factionDefeated', { faction, by });
}

/**
 * Стратегическое планирование: у каждой фракции — кампания с приоритетной
 * целью, а не «хватать всё подряд». План пересматривается раз в 12 дней.
 *  • Автоматоны с чертежами супероружия рвутся к магмовым мирам с богатыми
 *    залежами — там встанет особая верфь и сервисный док ССА.
 *  • Иллюминаты охотятся на населённые миры Супер-Земли — урожай для масс.
 *  • Терминиды дозахватывают сектора роя целиком (Мрак требует полных секторов).
 *  • Остальные (и все по умолчанию) методично закрывают начатые сектора.
 *  • Столица в осаде перекрывает всё — план «оборона».
 */
export function updatePlan(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  const worlds = planetsOf(state, faction);

  // Оборона столицы важнее любых амбиций.
  const capital = worlds.find((p) => p.isCapital);
  if (capital?.battle && capital.battle.liberation > 15) {
    fs.aiPlan = { goal: 'defense', target: capital.id, note: `оборона столицы ${capital.name}` };
    return;
  }

  // Автоматоны: проект супероружия требует платиновых руд магмовых миров.
  if (faction === 'automatons' && fs.specialUnlocked) {
    const hasDock = worlds.some((p) => p.buildings.includes('specialDock'));
    if (!hasDock) {
      const site = state.galaxy.order
        .map((id) => state.galaxy.planets.get(id)!)
        .filter((p) => p.biome === 'magma' && p.minerals >= 2 && !p.shattered && !p.abyss)
        .sort((a, b) => {
          const da = a.owner === faction ? -1 : nearestDist(worlds, a);
          const db = b.owner === faction ? -1 : nearestDist(worlds, b);
          return da - db;
        })[0];
      if (site) {
        fs.aiPlan = { goal: 'superweaponSite', target: site.id, note: `плацдарм супероружия: ${site.name}` };
        return;
      }
    }
  }

  // Иллюминаты: урожай с миров Супер-Земли.
  if (faction === 'illuminate') {
    const prey = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .filter((p) => p.owner === 'superEarth' && !p.shattered &&
        p.links.some((l) => state.galaxy.planets.get(l)!.owner === faction))
      .sort((a, b) => b.cities.length - a.cities.length)[0];
    if (prey) {
      fs.aiPlan = { goal: 'harvest', target: prey.id, note: `сбор урожая: ${prey.name}` };
      return;
    }
  }

  // По умолчанию: закрыть сектор, где у фракции больше всего миров, но не все.
  let best: { target: string; own: number } | null = null;
  for (const sector of state.galaxy.sectors.values()) {
    const ps = sector.planets.map((id) => state.galaxy.planets.get(id)!).filter((p) => !p.shattered && !p.abyss);
    const own = ps.filter((p) => p.owner === faction).length;
    const missing = ps.filter((p) => p.owner !== faction && areHostile(faction, p.owner));
    if (own > 0 && missing.length > 0 && (!best || own > best.own)) {
      const t = missing.sort((a, b) => a.garrison - b.garrison)[0]!;
      best = { target: t.id, own };
    }
  }
  if (best) {
    const goal = faction === 'terminids' ? 'swarmSector' : 'consolidate';
    const t = state.galaxy.planets.get(best.target)!;
    fs.aiPlan = { goal, target: best.target, note: `зачистка сектора ${t.sector}` };
  } else {
    // Нет недобитых секторов — курс на Супер-Землю: ближайший к центру
    // фронтирный вражеский мир становится целью кампании.
    const push = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .filter((p) => areHostile(faction, p.owner) && !p.shattered && !p.abyss &&
        p.links.some((l) => state.galaxy.planets.get(l)!.owner === faction))
      .sort((a, b) => a.radius - b.radius)[0];
    if (push) {
      fs.aiPlan = { goal: 'consolidate', target: push.id, note: `наступление к центру: ${push.name}` };
    } else {
      fs.aiPlan = { goal: 'consolidate', target: null, note: 'экспансия' };
    }
  }
}

function nearestDist(worlds: Planet[], p: Planet): number {
  let d = Infinity;
  for (const w of worlds) d = Math.min(d, Math.hypot(w.pos.x - p.pos.x, w.pos.y - p.pos.y));
  return d;
}

/**
 * Тактический ИИ флотов. Принципы:
 *  • цели оцениваются (слабый гарнизон, окружение, ценность, столицы),
 *    а не берётся просто ближайшая;
 *  • без достаточного перевеса сил ИИ копит войска, а не бросается в бой;
 *  • при угрозе своим мирам флоты отзываются на оборону;
 *  • потрёпанные соединения отходят в тыл на переформирование.
 */
export function runAI(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.alive) return;
  // Пересмотр стратегического плана раз в 12 дней.
  if (!fs.aiPlan || state.day % 12 === 0) {
    updatePlan(state, faction);
  }

  for (const f of fleetsOf(state, faction)) {
    if (f.transit) continue;
    const here = state.galaxy.planets.get(f.at);
    if (!here) continue;

    const hulls = f.ships + f.dreadnoughts + f.battleships;

    // Потрёпан или пуст — отход на переформирование.
    if ((here.owner !== faction && f.infantry < 6) || hulls < 2.5) {
      const refuge = nearestOwnedWorld(state, faction, f.at);
      if (refuge) orderFleetTo(state, f, refuge, false);
      continue;
    }
    // Уже штурмует вражеский мир — держит хватку.
    if (here.owner !== faction && areHostile(faction, here.owner)) continue;

    // Оборона прежде всего: если наш мир под серьёзным ударом — на выручку.
    const threat = mostThreatenedWorld(state, faction);
    if (threat) {
      const tp = state.galaxy.planets.get(threat)!;
      if (tp.battle && tp.battle.liberation > 25 && threat !== f.at) {
        orderFleetTo(state, f, threat, false);
        continue;
      }
    }

    // Наступление: лучшая цель в радиусе досягаемости.
    // Рой не копит резервы поколениями — бросается в атаку раньше прочих.
    const minInfantry = faction === 'terminids' ? 7 : 12;
    if (f.infantry >= minInfantry) {
      const target = bestInvasionTarget(state, faction, f);
      if (target) {
        orderFleetTo(state, f, target, true);
        continue;
      }
    }
    // Сил маловато — копим на месте (докомплектация идёт в runEconomy),
    // а тем временем прикрываем самый ценный фронтовой мир.
    if (threat && threat !== f.at) orderFleetTo(state, f, threat, false);
  }
}

/**
 * Оценка целей вторжения: перевес сил обязателен, окружённые и слабо
 * защищённые миры ценятся выше, столицы — лакомая добыча, а главный вес
 * получает цель ТЕКУЩЕГО СТРАТЕГИЧЕСКОГО ПЛАНА и её сектор.
 */
function bestInvasionTarget(state: GameState, faction: FactionId, f: Fleet): string | null {
  const fs = state.factions[faction];
  const myPower = f.infantry * (1 + fs.bonuses.combat);
  const plan = fs.aiPlan;
  const planSector = plan?.target ? state.galaxy.planets.get(plan.target)?.sector : undefined;
  // Гегемон: фракция, держащая больше 38% живых планет галактики.
  const totals = new Map<FactionId, number>();
  let living = 0;
  for (const pid of state.galaxy.order) {
    const pl = state.galaxy.planets.get(pid)!;
    if (pl.shattered || pl.abyss) continue;
    living++;
    totals.set(pl.owner, (totals.get(pl.owner) ?? 0) + 1);
  }
  let leader: FactionId | null = null;
  for (const [f2, n] of totals) if (f2 !== faction && n / Math.max(1, living) > 0.38) leader = f2;
  let best: string | null = null;
  let bestScore = 0;

  // Кандидаты: вражеские миры, смежные с нашей территорией (фронтир).
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    if (p.owner === faction || p.shattered) continue;
    if (!hostileNow(state, faction, p.owner) || !canEnter(state, faction, p)) continue;
    const onFrontier = p.links.some((lid) => {
      const n = state.galaxy.planets.get(lid)!;
      return n.owner === faction && !n.shattered;
    });
    if (!onFrontier) continue;

    const defence = p.garrison * (1 + p.fortification * 0.12) * (p.supplied ? 1 : 0.55);
    // Без перевеса ИИ не лезет — копит силы (рой безрассуднее прочих).
    if (myPower < defence * (faction === 'terminids' ? 0.45 : 0.66)) continue;

    let score = myPower / (defence + 10);
    score += p.value * 0.35;
    // Все фракции рвутся к Супер-Земле и центру галактики — важные точки.
    score += (1 - p.radius / state.galaxy.radiusMax) * 2.5;
    if (p.id === 'p_super_earth') score += 6;
    // Коалиция против гегемона: лидера по планетам бьют в первую очередь.
    if (leader && p.owner === leader) score += 2.5;
    if (!p.supplied) score += 3.5;          // окружённые — добить
    if (p.isCapital) score += 3;            // обезглавить врага
    if (p.battle && p.battle.attacker === faction) score += 2.5; // дожать штурм
    if (p.cities.length) score += p.cities.length * 0.5;

    // Дисциплина кампании: цель плана — в приоритете, её сектор — тоже;
    // миры в секторах, где у нас ни одной планеты, — распыление сил.
    if (plan?.target === id) score += 8;
    if (planSector && p.sector === planSector) score += 2;
    const sec = [...state.galaxy.sectors.values()].find((sc) => sc.planets.includes(id));
    if (sec && !sec.planets.some((pid) => state.galaxy.planets.get(pid)!.owner === faction)) {
      score -= 2.5;
    }
    // Марионетки без гарнизона — лёгкая, но второстепенная добыча.
    if (p.puppetOf) score -= 1;

    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

// --- BFS helpers over supply lines -----------------------------------------

function bfsFind(state: GameState, start: string, transit: (p: Planet) => boolean, goal: (p: Planet) => boolean): string | null {
  const seen = new Set<string>([start]);
  const q: string[] = [start];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of state.galaxy.planets.get(cur)!.links) {
      if (seen.has(n)) continue;
      seen.add(n);
      const np = state.galaxy.planets.get(n)!;
      if (goal(np)) return n;
      if (transit(np)) q.push(n);
    }
  }
  return null;
}

function nearestOwnedWorld(state: GameState, faction: FactionId, from: string): string | null {
  return bfsFind(state, from, (p) => canEnter(state, faction, p), (p) => p.owner === faction);
}

function mostThreatenedWorld(state: GameState, faction: FactionId): string | null {
  let best: Planet | null = null;
  let bestScore = 0;
  for (const p of planetsOf(state, faction)) {
    const score = (p.battle ? p.battle.liberation : 0) + (p.isCapital ? 20 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best?.id ?? null;
}
