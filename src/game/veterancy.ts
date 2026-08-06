import type { Fleet } from '../core/types';

// ---------------------------------------------------------------------------
// Боевой опыт соединений. Флот копит опыт в орбитальных и наземных боях;
// ранги дают бонус к боевой силе и скорости захвата. Опыт переживает сейв
// и деление флота, но гибнет вместе с соединением.
// ---------------------------------------------------------------------------

export interface Rank {
  min: number;
  name: string;
  /** Шевроны для карточек. */
  badge: string;
  /** Множитель боевой силы и скорости захвата. */
  mult: number;
}

export const RANKS: Rank[] = [
  { min: 0, name: 'Новобранцы', badge: '', mult: 1 },
  { min: 25, name: 'Обстрелянные', badge: '›', mult: 1.05 },
  { min: 70, name: 'Ветераны', badge: '››', mult: 1.1 },
  { min: 150, name: 'Элита', badge: '›››', mult: 1.16 },
];

export function rankOf(fleet: Fleet): Rank {
  const xp = fleet.xp ?? 0;
  let r = RANKS[0]!;
  for (const rank of RANKS) if (xp >= rank.min) r = rank;
  return r;
}

/** Начислить опыт соединению (за день боя, за победу и т.п.). */
export function gainXp(fleet: Fleet, amount: number): void {
  fleet.xp = Math.min(500, (fleet.xp ?? 0) + amount);
}

/** До следующего ранга (null — уже максимум). */
export function nextRankIn(fleet: Fleet): number | null {
  const xp = fleet.xp ?? 0;
  const next = RANKS.find((r) => r.min > xp);
  return next ? next.min - xp : null;
}
