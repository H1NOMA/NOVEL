import type { Fleet, Planet, Vec2 } from '../core/types';
import { findPath, type Galaxy } from './galaxy';
import { pushLog, type GameState } from './state';

/** World units a fleet travels per game-day. */
export const MOVE_SPEED = 72;

function edgeLength(galaxy: Galaxy, a: string, b: string): number {
  const pa = galaxy.planets.get(a)!.pos;
  const pb = galaxy.planets.get(b)!.pos;
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

/** Can a fleet of `faction` transit *through* this planet (not as a destination)? */
function transitable(p: Planet, faction: string): boolean {
  return p.owner === faction;
}

/** Order a fleet to move/invade toward a target planet along supply lines. */
export function orderFleetTo(state: GameState, fleet: Fleet, target: string, invade: boolean): boolean {
  if (fleet.at === target && !fleet.transit) {
    fleet.order = { kind: 'idle' };
    return true;
  }
  const from = fleet.transit ? fleet.transit.from : fleet.at;
  const path = findPath(state.galaxy, from, target, (p) => transitable(p, fleet.faction) || p.id === target);
  if (!path || path.length < 2) return false;
  fleet.transit = { from, to: target, path, progress: 0, legIndex: 0 };
  fleet.order = invade ? { kind: 'invade', target } : { kind: 'move', target };
  return true;
}

/** Advance all in-transit fleets by `days` (may be fractional). Returns arrivals. */
export function stepFleets(state: GameState, days: number): Fleet[] {
  const arrived: Fleet[] = [];
  for (const id of state.fleetOrder) {
    const fleet = state.fleets.get(id);
    if (!fleet || !fleet.transit) continue;
    const t = fleet.transit;
    let remaining = MOVE_SPEED * days;
    while (remaining > 0 && t.legIndex < t.path.length - 1) {
      const a = t.path[t.legIndex]!;
      const b = t.path[t.legIndex + 1]!;
      const len = Math.max(1, edgeLength(state.galaxy, a, b));
      t.progress += remaining / len;
      if (t.progress >= 1) {
        remaining = (t.progress - 1) * len;
        t.progress = 0;
        t.legIndex++;
        fleet.at = t.path[t.legIndex]!;
      } else {
        remaining = 0;
      }
    }
    if (t.legIndex >= t.path.length - 1) {
      fleet.at = t.to;
      fleet.transit = undefined;
      arrived.push(fleet);
    }
  }
  return arrived;
}

/** Interpolated world position of a fleet for rendering. */
export function fleetWorldPos(galaxy: Galaxy, fleet: Fleet): Vec2 {
  if (!fleet.transit) {
    const p = galaxy.planets.get(fleet.at);
    return p ? { ...p.pos } : { x: 0, y: 0 };
  }
  const t = fleet.transit;
  const a = galaxy.planets.get(t.path[t.legIndex]!)!.pos;
  const b = galaxy.planets.get(t.path[Math.min(t.legIndex + 1, t.path.length - 1)]!)!.pos;
  return {
    x: a.x + (b.x - a.x) * t.progress,
    y: a.y + (b.y - a.y) * t.progress,
  };
}

/** Merge friendly fleets that pile up on a planet to reduce clutter (optional). */
export function garrisonReinforce(state: GameState, fleet: Fleet): void {
  const planet = state.galaxy.planets.get(fleet.at)!;
  if (planet.owner === fleet.faction && fleet.infantry > 0) {
    planet.garrison += fleet.infantry;
    pushLog(state, {
      faction: fleet.faction,
      text: `Reinforcements landed on ${planet.name}: +${fleet.infantry} garrison.`,
      tone: fleet.faction === state.player ? 'good' : 'info',
    });
    fleet.infantry = 0;
    fleet.order = { kind: 'idle' };
  }
}
