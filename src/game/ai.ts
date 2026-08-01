import type { FactionId, Fleet, Planet } from '../core/types';
import { areHostile, FACTIONS } from '../data/factions';
import { fleetsOf, planetsOf, pushLog, spawnFleet, type GameState } from './state';
import { orderFleetTo } from './units';
import { canEnter } from './supply';
import { drawUnits, mineE711, replenishUnits, totalUnits } from './troops';

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
  const fleets = fleetsOf(state, faction);
  if (fs.production >= FLEET_COST && fleets.length < fleetCap(state, faction) && totalUnits(fs) >= 20) {
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
  pushLog(state, {
    faction,
    text: `Фракция «${FACTIONS[faction].name}» повержена и изгнана из галактики!`,
    tone: faction === state.player ? 'bad' : 'good',
  });
}

/** AI fleet orders for a non-player faction. */
export function runAI(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.alive) return;
  for (const f of fleetsOf(state, faction)) {
    if (f.transit) continue;
    const here = state.galaxy.planets.get(f.at);
    if (!here) continue;

    // If stranded with no troops on a hostile world, retreat to reload.
    if (here.owner !== faction && f.infantry < 6) {
      const refuge = nearestOwnedWorld(state, faction, f.at);
      if (refuge) orderFleetTo(state, f, refuge, false);
      continue;
    }
    // Already invading a hostile world with troops — hold and keep fighting.
    if (here.owner !== faction && areHostile(faction, here.owner)) continue;

    // On a friendly world with troops: push to the nearest hostile frontier.
    if (f.infantry >= 10) {
      const target = nearestHostileWorld(state, faction, f.at);
      if (target) {
        orderFleetTo(state, f, target, true);
        continue;
      }
    }
    // Otherwise reinforce a threatened friendly world.
    const threat = mostThreatenedWorld(state, faction);
    if (threat && threat !== f.at) orderFleetTo(state, f, threat, false);
  }
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

function nearestHostileWorld(state: GameState, faction: FactionId, from: string): string | null {
  return bfsFind(
    state,
    from,
    (p) => p.owner === faction && canEnter(state, faction, p),
    (p) => p.owner !== faction && areHostile(faction, p.owner) && canEnter(state, faction, p)
  );
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
