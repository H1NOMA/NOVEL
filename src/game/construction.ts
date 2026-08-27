import type { FactionId, Planet } from '../core/types';
import { pushLog, type GameState } from './state';

// ---------------------------------------------------------------------------
// Стройка занимает время.
//
// Раньше любое сооружение появлялось в тот же кадр, в который игрок нажал
// кнопку: щит над столицей вырастал мгновенно, и оборона превращалась в
// вопрос запаса производства, а не планирования. Теперь на планете есть
// СТРОЙПЛОЩАДКА — ровно одна: заказ списывает производство сразу, а само
// сооружение встаёт в строй через положенные дни.
//
// Правила намеренно жёсткие:
//   • одна стройка на мир — параллельно два сооружения не тянет никто;
//   • мир без снабжения стройку не двигает (но и не теряет вложенное);
//   • отмена возвращает половину — как и отмена заказа на верфи;
//   • при смене владельца площадка гибнет вместе со всем остальным.
// ---------------------------------------------------------------------------

export interface BuildDef {
  id: string;
  name: string;
  /** Дней работ на снабжаемом мире. */
  days: number;
}

export const BUILD_DEFS: BuildDef[] = [
  { id: 'depot', name: 'Точка снабжения', days: 10 },
  { id: 'shipyard', name: 'Верфь', days: 16 },
  { id: 'shieldGen', name: 'Планетарный щит', days: 20 },
  { id: 'orbStation', name: 'Орбитальная станция', days: 24 },
  { id: 'specialDock', name: 'Особая верфь и сервисный док', days: 30 },
  { id: 'e711Station', name: 'Станция добычи Е-711', days: 14 },
  { id: 'termicide', name: 'Система термицида', days: 14 },
  { id: 'incinFactory', name: 'Фабрика испепеляющего отряда', days: 18 },
  { id: 'jetFactory', name: 'Фабрика реактивного батальона', days: 18 },
];

export function buildDef(id: string): BuildDef | undefined {
  return BUILD_DEFS.find((b) => b.id === id);
}

/** Уже стоит или уже строится это сооружение на планете? */
export function hasOrBuilding(p: Planet, id: string): boolean {
  if (p.build?.id === id) return true;
  if (id === 'depot') return p.depot;
  if (id === 'shipyard') return !!p.shipyard;
  return p.buildings.includes(id);
}

/**
 * Заложить сооружение. Производство уже списано вызывающей стороной — здесь
 * только площадка: проверки стоимости остаются там, где они и жили
 * (buildShield, buildDepot и прочие), и каждая знает про свои ресурсы.
 * Вложенное запоминается в самой площадке, чтобы отмена вернула половину и
 * не понадобилась вторая таблица цен.
 */
export function beginBuild(state: GameState, planet: Planet, id: string, cost: number): boolean {
  const def = buildDef(id);
  if (!def || planet.build) return false;
  planet.build = { id, daysLeft: def.days, total: def.days, cost };
  pushLog(state, {
    faction: planet.owner,
    text: `${planet.name}: заложено сооружение «${def.name}» — работ на ${def.days} дн.`,
    tone: 'info',
  });
  return true;
}

/** Ежедневный шаг всех строек галактики. */
export function stepConstruction(state: GameState): void {
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    const site = p.build;
    if (!site || p.shattered) continue;
    // Отрезанный мир стройку не двигает: бетон и балки везут по линиям снабжения.
    if (!p.supplied) continue;
    // Город-верфь — это ещё и строительный трест: работы идут четвертью быстрее.
    site.daysLeft -= p.cities.some((c) => c.spec === 'yard' && c.holder === p.owner) ? 1.25 : 1;
    if (site.daysLeft > 0) continue;
    p.build = undefined;
    finishBuild(state, p, site.id);
  }
}

function finishBuild(state: GameState, p: Planet, id: string): void {
  const def = buildDef(id);
  if (id === 'depot') p.depot = true;
  // Верфь заводится прямо здесь, а не через shipyards.emptyYard(): модуль
  // верфей тянет за собой ИИ и снабжение, а стройка обязана оставаться листом
  // графа импортов — иначе получаем цикл supply → construction → shipyards → ai.
  else if (id === 'shipyard') p.shipyard = { queue: null, stored: { ships: 0, dreadnoughts: 0, battleships: 0, transports: 0 } };
  else if (!p.buildings.includes(id)) p.buildings.push(id);
  pushLog(state, {
    faction: p.owner,
    text: `${p.name}: «${def?.name ?? id}» — работы завершены, объект принят в строй.`,
    tone: p.owner === state.player ? 'good' : 'info',
  });
}

/** Свернуть стройку: половина вложенного производства возвращается. */
export function cancelBuild(state: GameState, faction: FactionId, planetId: string): boolean {
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.owner !== faction || !p.build) return false;
  state.factions[faction].production += (p.build.cost ?? 0) * 0.5;
  p.build = undefined;
  return true;
}

/**
 * Захват мира стирает всё построенное.
 *
 * Победителю достаётся голая планета: щит, станция, верфь со складом, точка
 * снабжения, фабрики и недостроенная площадка гибнут вместе с обороной.
 * Отстраиваться придётся с нуля — и это главный тормоз блицкрига.
 */
export function razeBuildings(p: Planet): void {
  p.buildings = [];
  p.build = undefined;
  p.depot = false;
  p.shipyard = undefined;
}
