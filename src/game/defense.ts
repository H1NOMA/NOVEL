import type { FactionId } from '../core/types';
import { type GameState } from './state';
import { beginBuild, hasOrBuilding } from './construction';

// ---------------------------------------------------------------------------
// Оборонительные сооружения:
//   • Планетарный щит — оборона крепче, контроль врага растёт вдвое медленнее.
//   • Орбитальная станция — ежедневно бьёт по вражеским флотам на орбите,
//     даже когда своих кораблей рядом нет.
// Оба гибнут при захвате планеты — победителю достаются руины.
// Оба СТРОЯТСЯ: заказ списывает производство, объект встаёт в строй позже.
// ---------------------------------------------------------------------------

export const SHIELD_COST = 90;
export const STATION_COST = 110;
/** Виртуальная боевая мощь орбитальной станции (в «корпусах» эсминцев). */
export const STATION_POWER = 16;

export function buildShield(state: GameState, faction: FactionId, planetId: string): boolean {
  const p = state.galaxy.planets.get(planetId);
  const fs = state.factions[faction];
  if (!p || p.owner !== faction || !p.supplied || p.shattered) return false;
  if (hasOrBuilding(p, 'shieldGen') || p.build || fs.production < SHIELD_COST) return false;
  fs.production -= SHIELD_COST;
  return beginBuild(state, p, 'shieldGen', SHIELD_COST);
}

export function buildStation(state: GameState, faction: FactionId, planetId: string): boolean {
  const p = state.galaxy.planets.get(planetId);
  const fs = state.factions[faction];
  if (!p || p.owner !== faction || !p.supplied || p.shattered) return false;
  if (hasOrBuilding(p, 'orbStation') || p.build || fs.production < STATION_COST) return false;
  fs.production -= STATION_COST;
  return beginBuild(state, p, 'orbStation', STATION_COST);
}
