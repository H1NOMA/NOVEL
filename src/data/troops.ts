import type { FactionId } from '../core/types';

// ---------------------------------------------------------------------------
// Типы наземных войск. Каждая фракция комплектует пехоту из своих пулов;
// доля элиты усиливает бой, доля массовой пехоты ускоряет захват планет.
// Правила пополнения у всех разные — см. game/troops.ts.
// ---------------------------------------------------------------------------

export type TroopRole = 'elite' | 'mass' | 'special';

export interface TroopDef {
  id: string;
  faction: FactionId;
  name: string;
  role: TroopRole;
  desc: string;
  /** Начальная численность пула. */
  initial: number;
}

export const TROOPS: TroopDef[] = [
  // --- Супер-Земля ---
  { id: 'helldivers', faction: 'superEarth', name: 'Адские десантники', role: 'elite', initial: 60, desc: 'Элита орбитального сброса. Мало, но каждый стоит взвода.' },
  { id: 'seaf', faction: 'superEarth', name: 'ВССЗ', role: 'mass', initial: 260, desc: 'Вооружённые силы Супер-Земли — многочисленная регулярная пехота, быстрее закрепляет контроль над планетами.' },

  // --- Автоматоны ---
  { id: 'vsa', faction: 'automatons', name: 'ВСА', role: 'mass', initial: 200, desc: 'Вооружённые силы автоматонов — основной боевой состав. Восполняются из ископаемых.' },
  { id: 'incinerators', faction: 'automatons', name: 'Испепеляющий отряд', role: 'special', initial: 0, desc: 'Огнемётные каратели. Производятся только при наличии фабрики испепеляющего отряда.' },
  { id: 'jets', faction: 'automatons', name: 'Реактивный отряд', role: 'special', initial: 0, desc: 'Ракетные штурмовики. Производятся только при наличии фабрики реактивного батальона.' },
  { id: 'cyborgLegion', faction: 'automatons', name: 'Легион киборгов', role: 'elite', initial: 40, desc: 'Древняя гвардия восстания. Собирается ТОЛЬКО на Киберстане.' },

  // --- Терминиды ---
  { id: 'swarm', faction: 'terminids', name: 'Рой', role: 'mass', initial: 280, desc: 'Бесконечная живая волна. Растёт с каждой планетой — рой всегда откладывает яйца.' },
  { id: 'breachStrain', faction: 'terminids', name: 'Прорывной штамм', role: 'special', initial: 30, desc: 'Проламывает укрепления и линии обороны.' },
  { id: 'predatorStrain', faction: 'terminids', name: 'Штамм-хищник', role: 'elite', initial: 30, desc: 'Выведен охотиться на охотников.' },
  { id: 'sporeStrain', faction: 'terminids', name: 'Споровый штамм', role: 'special', initial: 30, desc: 'Разносит споры Мрака и душит миры до прихода роя.' },

  // --- Иллюминаты ---
  { id: 'greatFleet', faction: 'illuminate', name: 'Великий флот', role: 'elite', initial: 130, desc: 'Пришельцы из иного измерения. НЕВОСПОЛНИМЫ — на то он и Великий флот.' },
  { id: 'voteless', faction: 'illuminate', name: 'Безмозглые массы', role: 'mass', initial: 90, desc: 'Обращённое население. Пополняются захватом миров Супер-Земли.' },
  { id: 'confiscators', faction: 'illuminate', name: 'Конфискаторы', role: 'special', initial: 30, desc: 'Собирают живой «урожай» с покорённых планет.' },

  // --- Супер-Федерация ---
  { id: 'fedArmy', faction: 'superFederation', name: 'Армия Федерации', role: 'mass', initial: 130, desc: 'Ополчение отколовшихся колоний.' },
  { id: 'fedGuard', faction: 'superFederation', name: 'Гвардия Конкорда', role: 'elite', initial: 40, desc: 'Бывшие Хеллдайверы, знающие все приёмы СЗ.' },
];

export function troopsOf(faction: FactionId): TroopDef[] {
  return TROOPS.filter((t) => t.faction === faction);
}

export function troopDef(id: string): TroopDef | undefined {
  return TROOPS.find((t) => t.id === id);
}

/** Здания автоматонов, открывающие производство особых отрядов. */
export const FACTORY_DEFS = [
  { id: 'incinFactory', name: 'Фабрика испепеляющего отряда', unlocks: 'incinerators', cost: 80 },
  { id: 'jetFactory', name: 'Фабрика реактивного батальона', unlocks: 'jets', cost: 80 },
] as const;

/**
 * Классы кораблей: базовые эсминцы, тяжёлые дредноуты, линкоры-флагманы и
 * десантные транспорты. Транспорт огня не ведёт (power 0) — он возит пехоту.
 * Поле `only` ограничивает класс одной фракцией: транспорты — доктрина
 * Супер-Земли, у которой пехота летит вниз, а не отращивается на месте.
 */
export const SHIP_CLASSES = [
  { id: 'destroyer', name: 'Супер-эсминцы', count: 4, power: 1, cost: 45, minerals: 6, days: 12, desc: '+4 базовых корабля' },
  { id: 'dreadnought', name: 'Дредноут', count: 1, power: 3, cost: 120, minerals: 18, days: 30, desc: 'Тяжёлый корабль: сила ×3' },
  { id: 'battleship', name: 'Линкор-флагман', count: 1, power: 6, cost: 250, minerals: 42, days: 55, desc: 'Флагман: сила ×6' },
  { id: 'transport', name: 'Транспорты ВССЗ', count: 2, power: 0, cost: 30, minerals: 4, days: 9, only: 'superEarth', desc: 'Десантные корабли: без них ВССЗ не сойдут на планету' },
] as const;

export type ShipClassId = (typeof SHIP_CLASSES)[number]['id'];

/** Сколько пехоты поднимает один транспорт. */
export const TRANSPORT_LIFT = 12;

/** Классы, доступные фракции на верфи. */
export function shipClassesFor(faction: FactionId): typeof SHIP_CLASSES[number][] {
  return SHIP_CLASSES.filter((c) => !('only' in c) || c.only === faction);
}

/** Стоимость производства одной пехотной дивизии (+15 в пул типа). */
export const DIVISION_SIZE = 15;
export const DIVISION_COST = 35;
