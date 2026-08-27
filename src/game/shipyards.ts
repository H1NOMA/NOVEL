import type { FactionId, Fleet, Planet, Shipyard } from '../core/types';
import { SHIP_CLASSES, TRANSPORT_LIFT, shipClassName, shipClassesFor, type ShipClassId } from '../data/troops';
import { drawUnits, drawUnitsOf, totalUnits } from './troops';
import { beginBuild, hasOrBuilding } from './construction';
import { fleetCap, fleetsOf, pushLog, spawnFleet, type GameState } from './state';

// ---------------------------------------------------------------------------
// Верфи. Корабли игрока строятся ТОЛЬКО на верфях и только по его приказу:
// сначала строится сама верфь на выбранной планете, затем на её стапель
// ставится заказ. Готовые корпуса складируются на верфи, пока их не заберёт
// флот на орбите — или пока из них не соберут соединение в редакторе.
// ---------------------------------------------------------------------------

export const SHIPYARD_COST = 100;

export function emptyYard(): Shipyard {
  return { queue: null, stored: { ships: 0, dreadnoughts: 0, battleships: 0, transports: 0 } };
}

/** Все планеты фракции с верфями. */
export function yardsOf(state: GameState, faction: FactionId): Planet[] {
  return state.galaxy.order
    .map((id) => state.galaxy.planets.get(id)!)
    .filter((p) => p.owner === faction && p.shipyard && !p.shattered);
}

/** Построить верфь на своей снабжаемой планете (работы занимают дни). */
export function buildShipyard(state: GameState, faction: FactionId, planetId: string): boolean {
  const fs = state.factions[faction];
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.owner !== faction || p.shipyard || !p.supplied || p.shattered) return false;
  if (p.build || hasOrBuilding(p, 'shipyard') || fs.production < SHIPYARD_COST) return false;
  fs.production -= SHIPYARD_COST;
  return beginBuild(state, p, 'shipyard', SHIPYARD_COST);
}

/** Поставить корабль в очередь постройки на верфи (один заказ за раз).
 *  Корпус стоит и производство, и ископаемые — без руды флот не построить. */
export function queueShip(state: GameState, faction: FactionId, planetId: string, cls: ShipClassId): boolean {
  const fs = state.factions[faction];
  const p = state.galaxy.planets.get(planetId);
  const def = shipClassesFor(faction).find((c) => c.id === cls);
  if (!def || !p || p.owner !== faction || !p.shipyard || p.shipyard.queue) return false;
  if (fs.production < def.cost || fs.resources.minerals < def.minerals) return false;
  fs.production -= def.cost;
  fs.resources.minerals -= def.minerals;
  p.shipyard.queue = { cls, daysLeft: def.days };
  return true;
}

/** Отменить заказ на стапеле (возврат половины стоимости и руды). */
export function cancelQueue(state: GameState, faction: FactionId, planetId: string): boolean {
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.owner !== faction || !p.shipyard?.queue) return false;
  const def = SHIP_CLASSES.find((c) => c.id === p.shipyard!.queue!.cls);
  if (def) {
    state.factions[faction].production += def.cost * 0.5;
    state.factions[faction].resources.minerals += def.minerals * 0.5;
  }
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
    // Город-верфь ускоряет стапель на четверть.
    yard.queue.daysLeft -= p.cities.some((c) => c.spec === 'yard' && c.holder === p.owner) ? 1.25 : 1;
    if (yard.queue.daysLeft <= 0) {
      const def = SHIP_CLASSES.find((c) => c.id === yard.queue!.cls);
      yard.queue = null;
      if (!def) continue;
      // Приписанное соединение получает корпуса ПРЯМО СО СТАПЕЛЯ: верфь
      // работает на него, а не на общий склад. Приписка гаснет сама, если
      // соединения не стало.
      const target = yard.assigned ? state.fleets.get(yard.assigned) : undefined;
      const toFleet = target && target.faction === p.owner;
      if (!target && yard.assigned) yard.assigned = undefined;
      const sink = toFleet
        ? {
            add: (k: 'ships' | 'dreadnoughts' | 'battleships' | 'transports', n: number) => {
              target![k] = (target![k] ?? 0) + n;
            },
          }
        : {
            add: (k: 'ships' | 'dreadnoughts' | 'battleships' | 'transports', n: number) => {
              yard.stored[k] = (yard.stored[k] ?? 0) + n;
            },
          };
      if (def.id === 'destroyer') sink.add('ships', def.count);
      else if (def.id === 'dreadnought') sink.add('dreadnoughts', def.count);
      else if (def.id === 'transport') sink.add('transports', def.count);
      else sink.add('battleships', def.count);
      if (toFleet) noteEstablishment(target!);
      pushLog(state, {
        faction: p.owner,
        text: toFleet
          ? `Верфь ${p.name}: ${shipClassName(p.owner, def.id).toLowerCase()} уходит в приписанное соединение.`
          : `Верфь ${p.name}: ${shipClassName(p.owner, def.id).toLowerCase()} сходит со стапелей и встаёт на прикол.`,
        tone: p.owner === state.player ? 'good' : 'info',
      });
      // Повтор заказа: та же серия закладывается снова, пока хватает ресурсов.
      if (yard.repeat) queueShip(state, p.owner, p.id, yard.repeat as never);
    }
  }
}

/** Сколько корпусов ждёт на складе верфи. */
export function storedHulls(yard: Shipyard): number {
  return yard.stored.ships + yard.stored.dreadnoughts + yard.stored.battleships + (yard.stored.transports ?? 0);
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
  fleet.transports = (fleet.transports ?? 0) + (yard.stored.transports ?? 0);
  yard.stored = { ships: 0, dreadnoughts: 0, battleships: 0, transports: 0 };
  noteEstablishment(fleet);
  pushLog(state, {
    faction: fleet.faction,
    text: `Соединение у ${p.name} принимает корабли с верфи в свой состав.`,
    tone: fleet.faction === state.player ? 'good' : 'info',
  });
  return true;
}

/** Сформировать новое соединение из всех кораблей, ожидающих на верфи. */
export function formFleetFromYard(state: GameState, faction: FactionId, planetId: string): Fleet | null {
  const fs = state.factions[faction];
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.owner !== faction || !p.shipyard) return null;
  const yard = p.shipyard;
  if (storedHulls(yard) <= 0) return null;
  if (fleetsOf(state, faction).length >= fleetCap(state, faction)) return null;
  // Десант берётся ровно на столько, на сколько хватает транспортов: пехота
  // без корабля с аппарелью — балласт (см. liftCapacity).
  const transports = yard.stored.transports ?? 0;
  const want = Math.min(20, totalUnits(fs));
  const lift = faction === 'superEarth' ? Math.min(want, transports * TRANSPORT_LIFT) : want;
  const crew = drawUnits(fs, lift);
  const fleet = spawnFleet(state, faction, planetId, {
    ships: yard.stored.ships,
    dreadnoughts: yard.stored.dreadnoughts,
    battleships: yard.stored.battleships,
    transports,
    infantry: crew,
  });
  noteEstablishment(fleet);
  yard.stored = { ships: 0, dreadnoughts: 0, battleships: 0, transports: 0 };
  pushLog(state, {
    faction,
    text: `У ${p.name} сформировано новое оперативное соединение (${(fleet.ships + fleet.dreadnoughts + fleet.battleships).toFixed(0)} корп.).`,
    tone: faction === state.player ? 'good' : 'info',
  });
  return fleet;
}

/**
 * Запомнить штат соединения: состав, к которому оно будет стремиться.
 *
 * Штат — это ВЫСШАЯ ТОЧКА состава, а не пожелание игрока: собрали группу из
 * восьми корпусов — восемь и есть норма, и потери до неё будут восполняться.
 * Отдельного экрана «задать штат» нет намеренно: он не нужен, а лишний экран
 * стоил бы игроку внимания.
 */
export function noteEstablishment(f: Fleet): void {
  const e = f.establishment ?? { ships: 0, dreadnoughts: 0, battleships: 0, transports: 0 };
  f.establishment = {
    ships: Math.max(e.ships, Math.round(f.ships)),
    dreadnoughts: Math.max(e.dreadnoughts, Math.round(f.dreadnoughts)),
    battleships: Math.max(e.battleships, Math.round(f.battleships)),
    transports: Math.max(e.transports, Math.round(f.transports ?? 0)),
  };
}

/**
 * Пополнение соединений из резерва.
 *
 * Раньше выбитые корпуса приходилось возвращать вручную: подвести соединение
 * к верфи, открыть карточку, нажать «принять корабли». На фронте из десятка
 * групп это превращалось в рутину, и соединения воевали дырявыми просто
 * потому, что до них не дошли руки.
 *
 * Теперь так: соединение, стоящее на своём снабжаемом мире с верфью, само
 * добирает со склада недостающее ДО ШТАТА — не больше. Излишек остаётся на
 * складе: резерв не растаскивается по группам сверх нормы, и его по-прежнему
 * можно пустить на новое соединение в редакторе.
 */
export function reinforceFleets(state: GameState): void {
  for (const id of state.fleetOrder) {
    const f = state.fleets.get(id);
    if (!f || f.transit) continue;
    const p = state.galaxy.planets.get(f.at);
    if (!p || p.owner !== f.faction || !p.shipyard || !p.supplied || p.shattered) continue;
    const want = f.establishment;
    if (!want) continue;
    const yard = p.shipyard;
    let took = 0;
    const pull = (k: 'ships' | 'dreadnoughts' | 'battleships' | 'transports') => {
      const need = want[k] - (f[k] ?? 0);
      if (need <= 0) return;
      const have = yard.stored[k] ?? 0;
      const take = Math.min(need, have);
      if (take <= 0) return;
      f[k] = (f[k] ?? 0) + take;
      yard.stored[k] = have - take;
      took += take;
    };
    pull('ships');
    pull('dreadnoughts');
    pull('battleships');
    pull('transports');
    if (took > 0) {
      pushLog(state, {
        faction: f.faction,
        text: `${p.name}: соединение принимает пополнение из резерва (${took.toFixed(0)} корп.).`,
        tone: f.faction === state.player ? 'good' : 'info',
      });
    }
  }
}

/** Приписать верфь к соединению (или снять приписку, если оно уже приписано). */
export function assignYard(state: GameState, faction: FactionId, planetId: string, fleetId: string | null): boolean {
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.owner !== faction || !p.shipyard) return false;
  if (!fleetId) {
    if (!p.shipyard.assigned) return false;
    p.shipyard.assigned = undefined;
    return true;
  }
  const f = state.fleets.get(fleetId);
  if (!f || f.faction !== faction) return false;
  p.shipyard.assigned = p.shipyard.assigned === fleetId ? undefined : fleetId;
  return true;
}

// ---------------------------------------------------------------------------
// Редактор соединений
//
// «Забрать всё со склада» — это не приказ, а инвентаризация. Настоящее
// оперативное соединение собирают по составу: столько-то эсминцев прикрытия,
// столько-то тяжёлых корпусов, столько-то транспортов и вполне конкретные
// части на борту — Хеллдайверы отдельно, ВССЗ отдельно. Отсюда и шаблон:
// одна структура описывает корабли и десант, и её же сохраняет интерфейс.
// ---------------------------------------------------------------------------

export interface FleetSpec {
  ships: number;
  dreadnoughts: number;
  battleships: number;
  transports: number;
  /** Пехота по типам: id из TROOPS → численность. */
  troops: Record<string, number>;
}

/** Сколько пехоты соединение способно ссадить на планету. */
export function liftCapacity(f: { faction: FactionId; transports?: number }): number {
  // Транспорты обязательны только Супер-Земле: у роя пехота — это сам рой,
  // машины десантируются капсулами, иллюминаты сдвигают массы Бездной.
  if (f.faction !== 'superEarth') return Infinity;
  return (f.transports ?? 0) * TRANSPORT_LIFT;
}

/** Сколько бойцов реально сойдёт на грунт с этого соединения. */
export function landableInfantry(f: Fleet): number {
  return Math.min(f.infantry, liftCapacity(f));
}

function clampInt(v: unknown, hi: number): number {
  const n = Math.floor(Number(v) || 0);
  return Math.max(0, Math.min(hi, n));
}

/**
 * Собрать соединение по шаблону: корпуса берутся со склада верфи, пехота — из
 * пулов фракции поимённо. Всё, что заказано сверх наличия, молча урезается до
 * наличия — редактор показывает те же потолки, поэтому расхождение возможно
 * только при гонке приказов в сетевой партии.
 */
export function composeFleet(
  state: GameState,
  faction: FactionId,
  planetId: string,
  spec: FleetSpec,
): Fleet | null {
  const fs = state.factions[faction];
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.owner !== faction || !p.shipyard || p.shattered) return null;
  if (fleetsOf(state, faction).length >= fleetCap(state, faction)) return null;
  const yard = p.shipyard;

  const ships = clampInt(spec.ships, yard.stored.ships);
  const dreadnoughts = clampInt(spec.dreadnoughts, yard.stored.dreadnoughts);
  const battleships = clampInt(spec.battleships, yard.stored.battleships);
  const transports = clampInt(spec.transports, yard.stored.transports ?? 0);
  if (ships + dreadnoughts + battleships + transports <= 0) return null;

  // Пехота: поимённо из пулов, и не больше, чем поднимут транспорты.
  const capacity = faction === 'superEarth' ? transports * TRANSPORT_LIFT : Infinity;
  let room = capacity;
  let infantry = 0;
  for (const [troop, n] of Object.entries(spec.troops ?? {})) {
    if (room <= 0) break;
    const want = Math.min(clampInt(n, Number.MAX_SAFE_INTEGER), room);
    if (want <= 0) continue;
    const got = drawUnitsOf(fs, troop, want);
    infantry += got;
    room -= got;
  }

  yard.stored.ships -= ships;
  yard.stored.dreadnoughts -= dreadnoughts;
  yard.stored.battleships -= battleships;
  yard.stored.transports = (yard.stored.transports ?? 0) - transports;

  const fleet = spawnFleet(state, faction, planetId, {
    ships, dreadnoughts, battleships, transports, infantry,
  });
  noteEstablishment(fleet);
  pushLog(state, {
    faction,
    text: `У ${p.name} собрано соединение по шаблону: ${(ships + dreadnoughts + battleships).toFixed(0)} боевых корп.${
      transports ? `, ${transports} трансп.` : ''}, десант ${infantry.toFixed(0)}.`,
    tone: faction === state.player ? 'good' : 'info',
  });
  return fleet;
}
