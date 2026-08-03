import type { FactionId, Fleet, Planet, Vec2 } from '../core/types';
import { findPath, type Galaxy } from './galaxy';
import { pushLog, type GameState } from './state';
import { canEnter, nearestFriendly } from './supply';

/** World units a fleet travels per game-day. */
export const MOVE_SPEED = 72;

function edgeLength(galaxy: Galaxy, a: string, b: string): number {
  const pa = galaxy.planets.get(a)!.pos;
  const pb = galaxy.planets.get(b)!.pos;
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

/** Can a fleet of `faction` transit *through* this planet (not as a destination)? */
function transitable(state: GameState, p: Planet, faction: FactionId): boolean {
  return p.owner === faction && canEnter(state, faction, p);
}

/** Order a fleet to move/invade toward a target planet along supply lines. */
export function orderFleetTo(state: GameState, fleet: Fleet, target: string, invade: boolean): boolean {
  if (fleet.at === target && !fleet.transit) {
    fleet.order = { kind: 'idle' };
    return true;
  }
  const targetPlanet = state.galaxy.planets.get(target);
  if (!targetPlanet || !canEnter(state, fleet.faction, targetPlanet)) return false;
  const from = fleet.transit ? fleet.transit.from : fleet.at;
  const path = findPath(state.galaxy, from, target, (p) => transitable(state, p, fleet.faction) || p.id === target);
  if (!path || path.length < 2) return false;
  fleet.transit = { from, to: target, path, progress: 0, legIndex: 0 };
  fleet.order = invade ? { kind: 'invade', target } : { kind: 'move', target };
  // Плацдарм: последняя СВОЯ планета на пути — с неё идёт снабжение атаки.
  fleet.origin = invade ? path[path.length - 2] : undefined;
  return true;
}

/**
 * Отступление: флоты фракции на орбите планеты уходят к ближайшему своему
 * миру, если он достижим (не в окружении, не за Мраком/Бездной).
 * Возвращает число отступивших флотов.
 */
export function retreatFleets(state: GameState, planetId: string, faction: FactionId): number {
  let retreated = 0;
  const refuge = nearestFriendly(state, faction, planetId);
  if (!refuge) return 0;
  for (const fid of [...state.fleetOrder]) {
    const f = state.fleets.get(fid);
    if (!f || f.faction !== faction || f.at !== planetId || f.transit) continue;
    // Отступающие прорываются и через чужое пространство — лишь бы оно было
    // проходимым (не Мрак и не Бездна).
    const path = findPath(state.galaxy, planetId, refuge, (p) => canEnter(state, faction, p));
    if (!path || path.length < 2) continue;
    f.transit = { from: planetId, to: refuge, path, progress: 0, legIndex: 0 };
    f.order = { kind: 'move', target: refuge };
    retreated++;
  }
  return retreated;
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
        // Планета впереди могла стать непроходимой (Мрак, Бездна) уже после
        // выдачи приказа — флот останавливается перед ней.
        const next = state.galaxy.planets.get(t.path[t.legIndex + 1]!)!;
        if (!canEnter(state, fleet.faction, next)) {
          fleet.transit = undefined;
          fleet.order = { kind: 'idle' };
          break;
        }
        remaining = (t.progress - 1) * len;
        t.progress = 0;
        t.legIndex++;
        fleet.at = t.path[t.legIndex]!;
      } else {
        remaining = 0;
      }
    }
    if (fleet.transit && t.legIndex >= t.path.length - 1) {
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

/**
 * Разделить соединение пополам: половина корпусов и пехоты уходит в новое
 * соединение на той же орбите. Спецстанция остаётся в исходном.
 */
export function splitFleet(state: GameState, fleet: Fleet): Fleet | null {
  if (fleet.transit) return null;
  const hulls = fleet.ships + fleet.dreadnoughts + fleet.battleships;
  if (hulls < 2) return null;
  const ships = Math.floor(fleet.ships / 2);
  const dreads = Math.floor(fleet.dreadnoughts / 2);
  const bbs = Math.floor(fleet.battleships / 2);
  if (ships + dreads + bbs < 1) return null;
  const inf = Math.floor(fleet.infantry / 2);
  fleet.ships -= ships;
  fleet.dreadnoughts -= dreads;
  fleet.battleships -= bbs;
  fleet.infantry -= inf;
  const nf: Fleet = {
    id: `f_${state.fleetCounter++}`,
    faction: fleet.faction,
    at: fleet.at,
    ships,
    dreadnoughts: dreads,
    battleships: bbs,
    infantry: inf,
    order: { kind: 'idle' },
  };
  state.fleets.set(nf.id, nf);
  state.fleetOrder.push(nf.id);
  pushLog(state, {
    faction: fleet.faction,
    text: `Соединение разделено: сформирована новая боевая группа (${(ships + dreads + bbs).toFixed(0)} корп.).`,
    tone: 'info',
  });
  return nf;
}

/**
 * Расформировать соединение на своей планете: пехота усиливает гарнизон,
 * корпуса встают на склад местной верфи (если её нет — идут на слом,
 * возвращая часть производства).
 */
export function disbandFleet(state: GameState, fleet: Fleet): boolean {
  if (fleet.transit || fleet.special) return false;
  const p = state.galaxy.planets.get(fleet.at);
  if (!p || p.owner !== fleet.faction) return false;
  p.garrison += fleet.infantry;
  if (p.shipyard) {
    p.shipyard.stored.ships += fleet.ships;
    p.shipyard.stored.dreadnoughts += fleet.dreadnoughts;
    p.shipyard.stored.battleships += fleet.battleships;
  } else {
    const scrap = fleet.ships * 6 + fleet.dreadnoughts * 18 + fleet.battleships * 40;
    state.factions[fleet.faction].production += scrap;
  }
  pushLog(state, {
    faction: fleet.faction,
    text: `Соединение у ${p.name} расформировано: пехота — в гарнизон, корпуса — ${p.shipyard ? 'на верфь' : 'на слом'}.`,
    tone: 'info',
  });
  const idx = state.fleetOrder.indexOf(fleet.id);
  if (idx >= 0) state.fleetOrder.splice(idx, 1);
  state.fleets.delete(fleet.id);
  if (state.selectedFleet === fleet.id) state.selectedFleet = null;
  return true;
}

/** Merge friendly fleets that pile up on a planet to reduce clutter (optional). */
export function garrisonReinforce(state: GameState, fleet: Fleet): void {
  const planet = state.galaxy.planets.get(fleet.at)!;
  if (planet.owner === fleet.faction && fleet.infantry > 0) {
    planet.garrison += fleet.infantry;
    pushLog(state, {
      faction: fleet.faction,
      text: `Подкрепление высадилось на ${planet.name}: гарнизон +${fleet.infantry.toFixed(0)}.`,
      tone: fleet.faction === state.player ? 'good' : 'info',
    });
    fleet.infantry = 0;
    fleet.order = { kind: 'idle' };
  }
}
