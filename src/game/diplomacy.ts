import type { FactionId } from '../core/types';
import { areHostile } from '../data/factions';
import { pushLog, type GameState } from './state';

// Перемирия: временный мир между парой фракций. Пока действует, стороны не
// начинают новых битв (идущие штурмы затухают сами, когда атакующие уходят).

export const TRUCE_COST = 120;
export const TRUCE_DAYS = 90;

export function truceActive(state: GameState, a: FactionId, b: FactionId): boolean {
  return state.truces.some((t) => t.until > state.day &&
    ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}

/** Враждебны ли фракции ПРЯМО СЕЙЧАС (вражда минус перемирие). */
export function hostileNow(state: GameState, a: FactionId, b: FactionId): boolean {
  return areHostile(a, b) && !truceActive(state, a, b);
}

/** Купить перемирие за политвласть (игрок → фракция). */
export function buyTruce(state: GameState, withFaction: FactionId): boolean {
  const fs = state.factions[state.player];
  if (withFaction === state.player || !state.factions[withFaction].alive) return false;
  if (truceActive(state, state.player, withFaction)) return false;
  if (fs.politicalPower < TRUCE_COST) return false;
  fs.politicalPower -= TRUCE_COST;
  state.truces.push({ a: state.player, b: withFaction, until: state.day + TRUCE_DAYS });
  pushLog(state, {
    faction: state.player,
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
