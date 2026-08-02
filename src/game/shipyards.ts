import type { FactionId, Fleet, Planet, Shipyard } from '../core/types';
import { SHIP_CLASSES, type ShipClassId } from '../data/troops';
import { drawUnits, totalUnits } from './troops';
import { fleetCap } from './ai';
import { fleetsAt, fleetsOf, pushLog, spawnFleet, type GameState } from './state';

// ---------------------------------------------------------------------------
// Верфи. Корабли игрока строятся ТОЛЬКО на верфях и только по его приказу:
// сначала строится сама верфь на выбранной планете, затем на её стапель
// ставится заказ. Готовые корпуса складируются на верфи, пока их не заберёт
// флот на орбите — или пока из них не сформируют новое соединение.
// ---------------------------------------------------------------------------

export const SHIPYARD_COST = 100;

export function emptyYard(): Shipyard {
  return { queue: null, stored: { ships: 0, dreadnoughts: 0, battleships: 0 } };
}

/** Все планеты фракции с верфями. */
export function yardsOf(state: GameState, faction: FactionId): Planet[] {
  return state.galaxy.order
    .map((id) => state.galaxy.planets.get(id)!)
    .filter((p) => p.owner === faction && p.shipyard && !p.shattered && !p.abyss);
}

/** Построить верфь на своей снабжаемой планете. */
export function buildShipyard(state: GameState, faction: FactionId, planetId: string): boolean {
  const fs = state.factions[faction];
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.owner !== faction || p.shipyard || !p.supplied || p.shattered || p.abyss) return false;
  if (fs.production < SHIPYARD_COST) return false;
  fs.production -= SHIPYARD_COST;
  p.shipyard = emptyYard();
  pushLog(state, {
    faction,
    text: `На орбите ${p.name} развёрнута верфь. Стапели готовы принять первый заказ.`,
    tone: faction === state.player ? 'good' : 'info',
  });
  return true;
}

/** Поставить корабль в очередь постройки на верфи (один заказ за раз). */
export function queueShip(state: GameState, faction: FactionId, planetId: string, cls: ShipClassId): boolean {
  const fs = state.factions[faction];
  const p = state.galaxy.planets.get(planetId);
  const def = SHIP_CLASSES.find((c) => c.id === cls);
  if (!def || !p || p.owner !== faction || !p.shipyard || p.shipyard.queue) return false;
  if (fs.production < def.cost) return false;
  fs.production -= def.cost;
  p.shipyard.queue = { cls, daysLeft: def.days };
  return true;
}

/** Отменить заказ на стапеле (возврат половины стоимости). */
export function cancelQueue(state: GameState, faction: FactionId, planetId: string): boolean {
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.owner !== faction || !p.shipyard?.queue) return false;
  const def = SHIP_CLASSES.find((c) => c.id === p.shipyard!.queue!.cls);
  if (def) state.factions[faction].production += def.cost * 0.5;
  p.shipyard.queue = null;
  return true;
}

/** Ежедневный шаг всех верфей: стапели работают, готовые корпуса — на склад. */
export function stepShipyards(state: GameState): void {
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    const yard = p.shipyard;
    if (!yard || p.shattered) continue;
    // Верфь без снабжения не работает.
    if (!yard.queue || !p.supplied) continue;
    yard.queue.daysLeft--;
    if (yard.queue.daysLeft <= 0) {
      const def = SHIP_CLASSES.find((c) => c.id === yard.queue!.cls);
      yard.queue = null;
      if (!def) continue;
      if (def.id === 'destroyer') yard.stored.ships += def.count;
      else if (def.id === 'dreadnought') yard.stored.dreadnoughts += def.count;
      else yard.stored.battleships += def.count;
      pushLog(state, {
        faction: p.owner,
        text: `Верфь ${p.name}: ${def.name.toLowerCase()} сходит со стапелей и встаёт на прикол.`,
        tone: p.owner === state.player ? 'good' : 'info',
      });
    }
  }
}

/** Сколько корпусов ждёт на складе верфи. */
export function storedHulls(yard: Shipyard): number {
  return yard.stored.ships + yard.stored.dreadnoughts + yard.stored.battleships;
}

/** Флот на орбите забирает все корабли со склада верфи. */
export function takeStoredShips(state: GameState, fleet: Fleet): boolean {
  const p = state.galaxy.planets.get(fleet.at);
  if (!p || p.owner !== fleet.faction || !p.shipyard || fleet.transit) return false;
  const yard = p.shipyard;
  if (storedHulls(yard) <= 0) return false;
  fleet.ships += yard.stored.ships;
  fleet.dreadnoughts += yard.stored.dreadnoughts;
  fleet.battleships += yard.stored.battleships;
  yard.stored = { ships: 0, dreadnoughts: 0, battleships: 0 };
  pushLog(state, {
    faction: fleet.faction,
    text: `Соединение у ${p.name} принимает корабли с верфи в свой состав.`,
    tone: fleet.faction === state.player ? 'good' : 'info',
  });
  return true;
}

/** Сформировать новое соединение из кораблей, ожидающих на верфи. */
export function formFleetFromYard(state: GameState, faction: FactionId, planetId: string): Fleet | null {
  const fs = state.factions[faction];
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.owner !== faction || !p.shipyard) return null;
  const yard = p.shipyard;
  if (storedHulls(yard) <= 0) return null;
  if (fleetsOf(state, faction).length >= fleetCap(state, faction)) return null;
  const crew = drawUnits(fs, Math.min(20, totalUnits(fs)));
  const fleet = spawnFleet(state, faction, planetId, {
    ships: yard.stored.ships,
    dreadnoughts: yard.stored.dreadnoughts,
    battleships: yard.stored.battleships,
    infantry: crew,
  });
  yard.stored = { ships: 0, dreadnoughts: 0, battleships: 0 };
  pushLog(state, {
    faction,
    text: `У ${p.name} сформировано новое оперативное соединение (${(fleet.ships + fleet.dreadnoughts + fleet.battleships).toFixed(0)} корп.).`,
    tone: faction === state.player ? 'good' : 'info',
  });
  return fleet;
}

/** При смене владельца планеты склад и стапель верфи гибнут (сама верфь остаётся). */
export function scuttleYard(p: Planet): void {
  if (p.shipyard) p.shipyard = emptyYard();
}

/** Есть ли на планете флот фракции, способный забрать корабли. */
export function fleetAtYard(state: GameState, faction: FactionId, planetId: string): Fleet | null {
  return fleetsAt(state, planetId).find((f) => f.faction === faction) ?? null;
}
