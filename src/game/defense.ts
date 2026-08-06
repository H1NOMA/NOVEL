import type { FactionId } from '../core/types';
import { pushLog, type GameState } from './state';

// ---------------------------------------------------------------------------
// Оборонительные сооружения:
//   • Планетарный щит — оборона крепче, контроль врага растёт вдвое медленнее.
//   • Орбитальная станция — ежедневно бьёт по вражеским флотам на орбите,
//     даже когда своих кораблей рядом нет.
// Оба гибнут при захвате планеты — победителю достаются руины.
// ---------------------------------------------------------------------------

export const SHIELD_COST = 90;
export const STATION_COST = 110;
/** Виртуальная боевая мощь орбитальной станции (в «корпусах» эсминцев). */
export const STATION_POWER = 16;

export function buildShield(state: GameState, faction: FactionId, planetId: string): boolean {
  const p = state.galaxy.planets.get(planetId);
  const fs = state.factions[faction];
  if (!p || p.owner !== faction || !p.supplied || p.shattered || p.abyss) return false;
  if (p.buildings.includes('shieldGen') || fs.production < SHIELD_COST) return false;
  fs.production -= SHIELD_COST;
  p.buildings.push('shieldGen');
  pushLog(state, {
    faction,
    text: `Над ${p.name} развёрнут планетарный щит. Вторжение здесь захлебнётся в помехах.`,
    tone: faction === state.player ? 'good' : 'info',
  });
  return true;
}

export function buildStation(state: GameState, faction: FactionId, planetId: string): boolean {
  const p = state.galaxy.planets.get(planetId);
  const fs = state.factions[faction];
  if (!p || p.owner !== faction || !p.supplied || p.shattered || p.abyss) return false;
  if (p.buildings.includes('orbStation') || fs.production < STATION_COST) return false;
  fs.production -= STATION_COST;
  p.buildings.push('orbStation');
  pushLog(state, {
    faction,
    text: `На орбите ${p.name} собрана боевая станция. Незваные гости встретят шквал огня.`,
    tone: faction === state.player ? 'good' : 'info',
  });
  return true;
}

/** Оборонительные сооружения гибнут при смене владельца планеты. */
export function demolishDefenses(planet: { buildings: string[] }): void {
  planet.buildings = planet.buildings.filter((b) => b !== 'shieldGen' && b !== 'orbStation');
}

/** ИИ: столица и ценные фронтовые миры получают щит и станцию. */
export function aiBuildDefenses(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.alive || fs.production < STATION_COST + 120) return;
  const worlds = state.galaxy.order
    .map((id) => state.galaxy.planets.get(id)!)
    .filter((p) => p.owner === faction && p.supplied && !p.shattered && !p.abyss)
    .sort((a, b) => (b.isCapital ? 100 : b.value) - (a.isCapital ? 100 : a.value));
  for (const p of worlds.slice(0, 3)) {
    if (!p.buildings.includes('shieldGen')) { buildShield(state, faction, p.id); return; }
    if (!p.buildings.includes('orbStation')) { buildStation(state, faction, p.id); return; }
  }
}
