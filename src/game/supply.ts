import type { FactionId, Planet } from '../core/types';
import { pushLog, type GameState } from './state';

export const DEPOT_COST = 60;

// ---------------------------------------------------------------------------
// Снабжение, блокировки перемещения (Мрак/Бездна), точки снабжения, окружение.
// ---------------------------------------------------------------------------

/** Может ли флот фракции войти на планету (транзитом или как в цель). */
export function canEnter(state: GameState, faction: FactionId, planet: Planet): boolean {
  if (planet.shattered) return false;
  if (planet.abyss) return faction === 'illuminate';
  if (planet.gloom && faction !== 'terminids' && !state.factions[faction].flags.gloomTravel) return false;
  return true;
}

/**
 * Ежедневный пересчёт снабжения. Планеты каждой фракции разбиваются на
 * связные компоненты по линиям снабжения (через свои планеты). Снабжается
 * компонент, содержащий столицу (или крупнейший, если столицы нет). Планета
 * в отрезанном компоненте — В ОКРУЖЕНИИ: гарнизон тает, оборона слабеет.
 */
export function recomputeSupply(state: GameState): void {
  const byFaction = new Map<FactionId, Planet[]>();
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    if (p.shattered) continue;
    if (!byFaction.has(p.owner)) byFaction.set(p.owner, []);
    byFaction.get(p.owner)!.push(p);
  }

  for (const [faction, planets] of byFaction) {
    if (planets.length === 0) continue;
    // Связные компоненты по своим планетам.
    const visited = new Set<string>();
    const components: Planet[][] = [];
    for (const start of planets) {
      if (visited.has(start.id)) continue;
      const comp: Planet[] = [];
      const stack = [start];
      visited.add(start.id);
      while (stack.length) {
        const cur = stack.pop()!;
        comp.push(cur);
        for (const nid of cur.links) {
          const n = state.galaxy.planets.get(nid)!;
          if (n.owner === faction && !visited.has(n.id)) {
            visited.add(n.id);
            stack.push(n);
          }
        }
      }
      components.push(comp);
    }
    // Опорный компонент: со столицей, иначе крупнейший.
    let anchor = components[0]!;
    const withCapital = components.find((c) => c.some((p) => p.isCapital));
    if (withCapital) anchor = withCapital;
    else for (const c of components) if (c.length > anchor.length) anchor = c;

    for (const comp of components) {
      const supplied = comp === anchor;
      for (const p of comp) p.supplied = supplied;
    }
  }
}

/** Построить точку снабжения на своей планете (за очки производства). */
export function buildDepot(state: GameState, faction: FactionId, planetId: string): boolean {
  const p = state.galaxy.planets.get(planetId);
  const fs = state.factions[faction];
  if (!p || p.owner !== faction || p.depot || fs.production < DEPOT_COST) return false;
  fs.production -= DEPOT_COST;
  p.depot = true;
  pushLog(state, {
    faction,
    text: `На ${p.name} развёрнута точка снабжения.`,
    tone: faction === state.player ? 'good' : 'info',
  });
  return true;
}

/** Есть ли рядом (эта или соседняя своя планета) точка снабжения. */
export function depotBonus(state: GameState, planet: Planet): boolean {
  if (planet.depot) return true;
  return planet.links.some((id) => {
    const n = state.galaxy.planets.get(id)!;
    return n.owner === planet.owner && n.depot;
  });
}

/** Ближайший свой мир, достижимый с учётом Мрака/Бездны (для отступления). */
export function nearestFriendly(state: GameState, faction: FactionId, from: string): string | null {
  const seen = new Set<string>([from]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const nid of state.galaxy.planets.get(cur)!.links) {
      if (seen.has(nid)) continue;
      seen.add(nid);
      const n = state.galaxy.planets.get(nid)!;
      if (!canEnter(state, faction, n)) continue;
      if (n.owner === faction) return nid;
      q.push(nid);
    }
  }
  return null;
}
