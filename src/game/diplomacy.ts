import type { FactionId } from '../core/types';
import { atWar } from './relations';
import { modActive, pushLog, type GameState } from './state';

// Перемирия: временный мир между парой фракций. Пока действует, стороны не
// начинают новых битв (идущие штурмы затухают сами, когда атакующие уходят).

export const TRUCE_COST = 120;
export const TRUCE_DAYS = 90;

/** Цена перемирия с учётом условий кампании («Тихий космос» — вдвое дешевле). */
export function truceCost(state: GameState): number {
  return modActive(state, 'quietSpace') ? TRUCE_COST / 2 : TRUCE_COST;
}

export function truceActive(state: GameState, a: FactionId, b: FactionId): boolean {
  return state.truces.some((t) => t.until > state.day &&
    ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}

/**
 * Враждебны ли фракции ПРЯМО СЕЙЧАС. Единственная точка правды о том, кто
 * кому враг: состояние войны из системы отношений минус действующее перемирие.
 */
export function hostileNow(state: GameState, a: FactionId, b: FactionId): boolean {
  return atWar(state, a, b) && !truceActive(state, a, b);
}

/**
 * Купить перемирие за политвласть. Покупатель передаётся явно: в сетевой
 * партии перемирие может заключать любой из людей, а не только тот, чьими
 * глазами смотрит экран хоста.
 */
export function buyTruce(state: GameState, actor: FactionId, withFaction: FactionId): boolean {
  const fs = state.factions[actor];
  if (withFaction === actor || !fs?.alive || !state.factions[withFaction]?.alive) return false;
  if (truceActive(state, actor, withFaction)) return false;
  const cost = truceCost(state);
  if (fs.politicalPower < cost) return false;
  fs.politicalPower -= cost;
  state.truces.push({ a: actor, b: withFaction, until: state.day + TRUCE_DAYS });
  pushLog(state, {
    faction: actor,
    text: `Заключено перемирие с фракцией на ${TRUCE_DAYS} дней. Пушки замолкают — до времени.`,
    tone: 'good',
  });
  return true;
}

/** Чистка истёкших перемирий (раз в день). */
export function stepTruces(state: GameState): void {
  const before = state.truces.length;
  state.truces = state.truces.filter((t) => t.until > state.day);
  if (state.truces.length < before) {
    pushLog(state, { text: 'Перемирие истекло. Война возобновляется.', tone: 'alert' });
  }
}
