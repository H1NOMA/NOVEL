import type { FactionId } from '../core/types';
import { FACTIONS } from '../data/factions';
import type { GameState } from './state';

// ---------------------------------------------------------------------------
// Карьера: сводка по всем партиям сразу. Живёт в localStorage отдельно от
// сохранений, поэтому переживает и загрузку чужого слота, и начало новой войны.
//
// Обновляется в двух точках: при старте кампании (счётчик походов) и по ходу
// игры на дневном тике (рекорды текущей партии подтягиваются вверх).
// ---------------------------------------------------------------------------

const KEY = 'sgw2_career';

export interface CareerRecord {
  /** Сколько кампаний начато. */
  campaigns: number;
  /** Побед и поражений. */
  wins: number;
  losses: number;
  /** Суммарно прожитых игровых дней. */
  days: number;
  /** Рекорд по числу подконтрольных миров за одну партию. */
  bestWorlds: number;
  /** Самая долгая кампания в днях. */
  longestWar: number;
  /** Взято чужих столиц. */
  capitals: number;
  /** Освобождено фракций (возвращены как марионетки). */
  liberations: number;
  /** Заключено миров. */
  peaces: number;
  /** Партий за каждую фракцию. */
  byFaction: Partial<Record<FactionId, number>>;
  /** Фракции, за которые была одержана победа. */
  wonAs: FactionId[];
}

const EMPTY: CareerRecord = {
  campaigns: 0, wins: 0, losses: 0, days: 0, bestWorlds: 0, longestWar: 0,
  capitals: 0, liberations: 0, peaces: 0, byFaction: {}, wonAs: [],
};

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadCareer(): CareerRecord {
  const raw = storage()?.getItem(KEY);
  if (!raw) return { ...EMPTY, byFaction: {}, wonAs: [] };
  try {
    return { ...EMPTY, ...(JSON.parse(raw) as CareerRecord) };
  } catch {
    return { ...EMPTY, byFaction: {}, wonAs: [] };
  }
}

function save(rec: CareerRecord): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(rec));
  } catch { /* приватный режим браузера — карьера просто не копится */ }
}

/** Новая кампания начата. */
export function careerStart(faction: FactionId): void {
  const c = loadCareer();
  c.campaigns++;
  c.byFaction[faction] = (c.byFaction[faction] ?? 0) + 1;
  save(c);
}

/**
 * Подтянуть рекорды из текущей партии. Зовётся редко (раз в игровой месяц),
 * поэтому пишет в хранилище нечасто и не мешает симуляции.
 */
export function careerSync(state: GameState): void {
  const c = loadCareer();
  const worlds = state.galaxy.order
    .filter((id) => state.galaxy.planets.get(id)!.owner === state.player).length;
  c.bestWorlds = Math.max(c.bestWorlds, worlds);
  c.longestWar = Math.max(c.longestWar, state.day);
  c.capitals = Math.max(c.capitals, Object.keys(state.subjugated ?? {}).length);
  c.liberations = Math.max(c.liberations, Object.keys(state.puppets ?? {}).length);
  save(c);
}

/** Партия закончилась: победа или поражение. */
export function careerFinish(state: GameState, won: boolean): void {
  const c = loadCareer();
  if (won) {
    c.wins++;
    if (!c.wonAs.includes(state.player)) c.wonAs.push(state.player);
  } else {
    c.losses++;
  }
  c.days += state.day;
  save(c);
}

/** Мир подписан — редкое достижение, считаем отдельно. */
export function careerPeace(): void {
  const c = loadCareer();
  c.peaces++;
  save(c);
}

export function resetCareer(): void {
  try {
    storage()?.removeItem(KEY);
  } catch { /* нечего чистить */ }
}

/** Звание по числу побед — короткая витрина прогресса. */
export function careerRank(c: CareerRecord): { title: string; next: string | null } {
  const steps: [number, string][] = [
    [0, 'Рекрут'],
    [1, 'Десантник'],
    [2, 'Сержант'],
    [4, 'Лейтенант'],
    [6, 'Капитан'],
    [9, 'Командор'],
    [13, 'Адмирал'],
    [18, 'Легенда Супер-Земли'],
  ];
  let title = steps[0]![1];
  let next: string | null = null;
  for (let i = 0; i < steps.length; i++) {
    if (c.wins >= steps[i]![0]) title = steps[i]![1];
    else {
      next = `${steps[i]![1]} — ещё ${steps[i]![0] - c.wins} побед${steps[i]![0] - c.wins === 1 ? 'а' : ''}`;
      break;
    }
  }
  return { title, next };
}

/** Строки витрины карьеры для экрана меню. */
export function careerLines(c: CareerRecord): [string, string][] {
  const favourite = (Object.entries(c.byFaction) as [FactionId, number][])
    .sort((a, b) => b[1] - a[1])[0];
  return [
    ['Кампаний начато', String(c.campaigns)],
    ['Побед', String(c.wins)],
    ['Поражений', String(c.losses)],
    ['Прожито дней войны', String(c.days)],
    ['Самая долгая кампания', c.longestWar ? `${c.longestWar} дн` : '—'],
    ['Рекорд подконтрольных миров', c.bestWorlds ? String(c.bestWorlds) : '—'],
    ['Взято чужих столиц', String(c.capitals)],
    ['Освобождено фракций', String(c.liberations)],
    ['Подписано миров', String(c.peaces)],
    ['Излюбленная сторона', favourite ? `${FACTIONS[favourite[0]].name} (${favourite[1]})` : '—'],
  ];
}
