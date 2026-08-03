import type { FactionId, Fleet } from '../core/types';
import { fleetsOf, type GameState } from './state';

// Командиры соединений: у каждой фракции три офицера со своим перком.
// Командир может вести только одно соединение.

export interface Commander {
  id: string;
  faction: FactionId;
  name: string;
  perk: string;
  /** Множитель боевой силы соединения. */
  combat: number;
  /** Множитель скорости захвата, когда соединение ведёт штурм. */
  capture: number;
}

export const COMMANDERS: Commander[] = [
  { id: 'se_c1', faction: 'superEarth', name: 'Ген. Брэш', perk: 'Мастер осад: захват +20%', combat: 1.05, capture: 1.2 },
  { id: 'se_c2', faction: 'superEarth', name: 'Адм. Икар', perk: 'Флотоводец: бой +15%', combat: 1.15, capture: 1 },
  { id: 'se_c3', faction: 'superEarth', name: 'Кап. Вега', perk: 'Универсал: бой и захват +8%', combat: 1.08, capture: 1.08 },
  { id: 'aut_c1', faction: 'automatons', name: 'Узел ШТУРМ-1', perk: 'Мастер осад: захват +20%', combat: 1.05, capture: 1.2 },
  { id: 'aut_c2', faction: 'automatons', name: 'Узел КЛИНОК-7', perk: 'Флотоводец: бой +15%', combat: 1.15, capture: 1 },
  { id: 'aut_c3', faction: 'automatons', name: 'Узел ЖНЕЦ-3', perk: 'Универсал: бой и захват +8%', combat: 1.08, capture: 1.08 },
  { id: 'trm_c1', faction: 'terminids', name: 'Альфа-выводок', perk: 'Мастер осад: захват +20%', combat: 1.05, capture: 1.2 },
  { id: 'trm_c2', faction: 'terminids', name: 'Королевский страж', perk: 'Бой +15%', combat: 1.15, capture: 1 },
  { id: 'trm_c3', faction: 'terminids', name: 'Древний хищник', perk: 'Универсал +8%', combat: 1.08, capture: 1.08 },
  { id: 'ill_c1', faction: 'illuminate', name: 'Иерофант Кел', perk: 'Мастер осад: захват +20%', combat: 1.05, capture: 1.2 },
  { id: 'ill_c2', faction: 'illuminate', name: 'Навигатор Культа', perk: 'Бой +15%', combat: 1.15, capture: 1 },
  { id: 'ill_c3', faction: 'illuminate', name: 'Жрец Глубин', perk: 'Универсал +8%', combat: 1.08, capture: 1.08 },
  { id: 'fed_c1', faction: 'superFederation', name: 'Полк. Реннер', perk: 'Бой +12%', combat: 1.12, capture: 1 },
];

export function commanderOf(fleet: Fleet): Commander | null {
  return COMMANDERS.find((c) => c.id === fleet.commander) ?? null;
}

/** Назначить следующего свободного командира (циклично; null — снять). */
export function cycleCommander(state: GameState, fleet: Fleet): Commander | null {
  const pool = COMMANDERS.filter((c) => c.faction === fleet.faction);
  if (!pool.length) return null;
  const taken = new Set(fleetsOf(state, fleet.faction).filter((f) => f.id !== fleet.id).map((f) => f.commander));
  const free = pool.filter((c) => !taken.has(c.id));
  const cur = free.findIndex((c) => c.id === fleet.commander);
  if (cur >= 0 && cur === free.length - 1) {
    fleet.commander = undefined;
    return null;
  }
  const next = free[cur + 1] ?? free[0];
  fleet.commander = next?.id;
  return next ?? null;
}
