import type { FactionId, Fleet, Planet } from '../core/types';
import { areHostile, FACTIONS } from '../data/factions';
import { fleetsOf, planetsOf, pushLog, spawnFleet, type GameState } from './state';
import { orderFleetTo } from './units';
import { canEnter } from './supply';
import { drawUnits, mineE711, replenishUnits, totalUnits } from './troops';
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
    // runEconomy is only invoked for active factions, so the Super Federation
    // reaches this path only after it has actually risen.
    eliminate(state, faction);
    return;
  }

  const income = worlds.reduce((s, p) => s + p.value, 0);
  fs.production += 0.4 * (fs.industry + income * 0.3);

  // Пополнение пулов войск по правилам фракции + добыча Е-711.
  replenishUnits(state, faction);
  if (faction === 'superEarth') mineE711(state);

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
  const aggression = FACTIONS[faction].aggression;

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
    if (f.infantry >= 12) {
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
  void aggression;
}

/**
 * Оценка целей вторжения: перевес сил обязателен, окружённые и слабо
 * защищённые миры ценятся выше, столицы — лакомая добыча.
 */
function bestInvasionTarget(state: GameState, faction: FactionId, f: Fleet): string | null {
  const myPower = f.infantry * (1 + state.factions[faction].bonuses.combat);
  let best: string | null = null;
  let bestScore = 0;

  // Кандидаты: вражеские миры, смежные с нашей территорией (фронтир).
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    if (p.owner === faction || p.shattered) continue;
    if (!areHostile(faction, p.owner) || !canEnter(state, faction, p)) continue;
    const onFrontier = p.links.some((lid) => {
      const n = state.galaxy.planets.get(lid)!;
      return n.owner === faction && !n.shattered;
    });
    if (!onFrontier) continue;

    const defence = p.garrison * (1 + p.fortification * 0.12) * (p.supplied ? 1 : 0.55);
    // Без полуторного перевеса ИИ не лезет — копит силы.
    if (myPower < defence * 0.66) continue;

    let score = myPower / (defence + 10);
    score += p.value * 0.35;
    if (!p.supplied) score += 3.5;          // окружённые — добить
    if (p.isCapital) score += 3;            // обезглавить врага
    if (p.battle && p.battle.attacker === faction) score += 2.5; // дожать штурм
    if (p.cities.length) score += p.cities.length * 0.5;

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
