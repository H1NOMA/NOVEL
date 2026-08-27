import type { FactionId, Planet } from '../core/types';
import { pushLog, type GameState } from './state';
import { canEnter } from './supply';
import { lockedInBattle } from './units';
import { bus } from '../core/emitter';

// ---------------------------------------------------------------------------
// Бездна иллюминатов.
//
// Остальные фракции воюют по линиям снабжения: чтобы ударить в тыл, надо
// сначала прогрызть фронт. Иллюминаты пришли из другого измерения, и карта для
// них — не сеть дорог, а поверхность, сквозь которую можно нырнуть. Отсюда две
// вещи, которых нет больше ни у кого:
//
//   • ВАРП-ПРЫЖОК. Соединение уходит в Бездну и выходит у ЛЮБОГО мира
//     галактики — хоть у самой Супер-Земли. Платят за это политической
//     властью, и платят дорого: прыжок стоит как объявление войны.
//   • ТОЧКА ЛЮДСКОГО РЕСУРСА. Мир, взятый после такого прыжка, не просто
//     переходит к иллюминатам — его население становится сырьём. Оттуда
//     ежедневно идут Безмозглые массы, и чем больше таких точек, тем быстрее
//     растёт единственная пополняемая пехота иллюминатов.
//
// Цена прыжка не только в очках. Соединение выходит из Бездны БЕЗ ПЛАЦДАРМА:
// у него нет смежного своего мира, откуда идёт снабжение атаки, и штурм оно
// ведёт с постоянным штрафом. Варп забрасывает войска, но не тыл.
// ---------------------------------------------------------------------------

/** Политическая власть за один прыжок. */
export const WARP_COST = 35;

/** Может ли эта фракция вообще нырять в Бездну. */
export function canWarpAtAll(faction: FactionId): boolean {
  return faction === 'illuminate';
}

/** Причина, по которой прыжок невозможен, или null — можно прыгать. */
export function warpBlocker(
  state: GameState,
  faction: FactionId,
  fleetId: string,
  target: string,
): string | null {
  if (!canWarpAtAll(faction)) return 'Бездна открыта только иллюминатам';
  const f = state.fleets.get(fleetId);
  if (!f || f.faction !== faction) return 'Соединение не ваше';
  // В Бездну ныряют и на полпути: перелёт прыжку не помеха — соединение
  // просто уходит вниз, не доводя маршрут. Единственный запрет — сцепка боем:
  // иначе варп стал бы способом выдернуть флот из проигранного сражения.
  if (lockedInBattle(state, f)) return 'Соединение сковано боем';
  if (!f.transit && f.at === target) return 'Соединение уже здесь';
  const p = state.galaxy.planets.get(target);
  if (!p || p.shattered) return 'Мира больше нет';
  if (!canEnter(state, faction, p)) return 'Выход из Бездны здесь закрыт';
  if (state.factions[faction].politicalPower < WARP_COST) return `Нужно ${WARP_COST} ПВ`;
  return null;
}

/**
 * Прыжок: соединение исчезает с орбиты и появляется у цели. Если цель чужая,
 * над ней зажигается маяк вторжения — взятый с маяка мир становится точкой
 * людского ресурса.
 */
export function warpFleet(state: GameState, faction: FactionId, fleetId: string, target: string): boolean {
  if (warpBlocker(state, faction, fleetId, target)) return false;
  const f = state.fleets.get(fleetId)!;
  const to = state.galaxy.planets.get(target)!;
  const from = state.galaxy.planets.get(f.at);

  state.factions[faction].politicalPower -= WARP_COST;
  f.at = target;
  f.transit = undefined;
  f.orderQueue = undefined;
  // Плацдарма у прыжка нет: снабжение атаки за ним не идёт.
  f.origin = undefined;
  f.order = { kind: 'idle' };
  if (to.owner !== faction) to.warpBeacon = true;

  pushLog(state, {
    faction,
    text: `Бездна раскрывается у ${to.name}: соединение иллюминатов выходит из перехода${
      from ? ` (было у ${from.name})` : ''}.`,
    tone: to.owner === state.player ? 'alert' : faction === state.player ? 'good' : 'info',
  });
  if (to.owner === state.player) {
    bus.emit('combatAlert', {
      planetId: to.id,
      text: `${to.name} — выход из Бездны на орбите!`,
      tone: 'bad',
      voice: 'incursion',
    });
  }
  return true;
}

/**
 * Мир взят иллюминатами после варп-вторжения — он становится точкой людского
 * ресурса. Вызывается из capturePlanet, когда маяк ещё горит.
 */
export function claimHarvestPoint(state: GameState, planet: Planet): void {
  planet.harvest = true;
  planet.warpBeacon = undefined;
  pushLog(state, {
    faction: 'illuminate',
    text: `${planet.name} обращён в точку людского ресурса: население мира отныне питает Безмозглые массы.`,
    tone: state.player === 'illuminate' ? 'good' : 'alert',
  });
}

/** Все точки людского ресурса под контролем иллюминатов. */
export function harvestPoints(state: GameState): Planet[] {
  return state.galaxy.order
    .map((id) => state.galaxy.planets.get(id)!)
    .filter((p) => p.harvest && p.owner === 'illuminate' && !p.shattered);
}

/** Сколько Безмозглых масс дают точки людского ресурса за день. */
export const HARVEST_YIELD = 0.7;
