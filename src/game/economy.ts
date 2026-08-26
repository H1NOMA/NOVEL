import type { FactionId } from '../core/types';
import { FACTIONS } from '../data/factions';
import { fleetsOf, modActive, planetsOf, type GameState } from './state';
import { PP_PER_DAY } from './politics';

// ---------------------------------------------------------------------------
// Разбор дневного дохода по источникам.
//
// Цифры в шапке показывают ЗАПАС, но не отвечают на главный вопрос стратегии:
// откуда он берётся и что случится, если этот кусок галактики отдать. Здесь
// формулы дневного шага (runEconomy → mineMinerals / mineE711 / accruePower)
// пересчитываются постатейно, чтобы интерфейс мог показать «сектор Ксантанион —
// 3.4 производства с семи миров», а не одно итоговое число.
//
// ВАЖНО: это зеркало симуляции, а не второй её экземпляр. Любая правка ставок в
// ai.ts / troops.ts / politics.ts должна повторяться здесь — иначе окно начнёт
// врать. Тесты round50 сверяют суммы отчёта с фактическим приростом за день.
// ---------------------------------------------------------------------------

export type ResourceId = 'production' | 'minerals' | 'e711' | 'power';

export const RESOURCE_LABEL: Record<ResourceId, string> = {
  production: 'ПРОИЗВОДСТВО',
  minerals: 'РУДА',
  e711: 'Е-711',
  power: 'ПОЛИТИЧЕСКАЯ ВЛАСТЬ',
};

export const RESOURCE_ICON: Record<ResourceId, string> = {
  production: '⚒',
  minerals: '⛏',
  e711: '⛽',
  power: '⚖',
};

/** Одна статья прихода или расхода. */
export interface IncomeLine {
  name: string;
  /** Уточнение: сколько миров, какой сектор, за что списано. */
  detail?: string;
  amount: number;
}

export interface IncomeReport {
  resource: ResourceId;
  /** Текущий запас. */
  stock: number;
  income: IncomeLine[];
  drain: IncomeLine[];
  /**
   * Источники, которые молчат: мир с залежами, отрезанный от снабжения, руды
   * не даёт. В net они НЕ входят — это не расход, а упущенный доход.
   */
  blocked: IncomeLine[];
  /** Сумма прихода. */
  gross: number;
  /** Приход минус расход — то, на сколько запас изменится за сутки. */
  net: number;
}

/** Русское склонение после числа: 1 мир, 2–4 мира, 5+ миров. */
function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const WORLDS: [string, string, string] = ['мир', 'мира', 'миров'];

function byAmount(a: IncomeLine, b: IncomeLine): number {
  return b.amount - a.amount;
}

/**
 * Свернуть длинный список в верхние N строк плюс «прочие» — иначе окно
 * производства Супер-Земли на старте превращается в простыню из ста миров.
 */
function trim(
  lines: IncomeLine[],
  keep: number,
  restName: string,
  unit: [string, string, string] = ['источник', 'источника', 'источников'],
): IncomeLine[] {
  lines.sort(byAmount);
  if (lines.length <= keep) return lines;
  const rest = lines.slice(keep);
  const sum = rest.reduce((s, l) => s + l.amount, 0);
  return [...lines.slice(0, keep), {
    name: restName,
    detail: `${rest.length} ${plural(rest.length, ...unit)}`,
    amount: sum,
  }];
}

/** Множитель промышленности: стабильность СЗ и условие «Холодные кузницы». */
function prodMultiplier(state: GameState, faction: FactionId): number {
  let m = 1;
  if (faction === 'superEarth') m *= 0.75 + state.factions[faction].stability / 200;
  if (modActive(state, 'coldForges')) m *= 0.85;
  return m;
}

/** Производство: промбаза, ценность миров по секторам, топливо, дань. Минус содержание флота. */
export function productionReport(state: GameState, faction: FactionId): IncomeReport {
  const fs = state.factions[faction];
  const worlds = planetsOf(state, faction);
  const mult = prodMultiplier(state, faction);
  const income: IncomeLine[] = [];
  const drain: IncomeLine[] = [];

  if (fs.industry > 0) {
    income.push({
      name: 'Промышленная база',
      detail: `${fs.industry.toFixed(0)} пром.`,
      amount: 0.4 * fs.industry * mult,
    });
  }

  // Миры дают долю от стратегической ценности; группируем по секторам.
  const bySector = new Map<string, { sum: number; worlds: number }>();
  for (const p of worlds) {
    const cell = bySector.get(p.sector) ?? { sum: 0, worlds: 0 };
    cell.sum += 0.4 * p.value * 0.3 * mult;
    cell.worlds++;
    bySector.set(p.sector, cell);
  }
  const sectorLines: IncomeLine[] = [];
  for (const [name, cell] of bySector) {
    if (cell.sum <= 0) continue;
    sectorLines.push({
      name,
      detail: `${cell.worlds} ${plural(cell.worlds, 'мир', 'мира', 'миров')}`,
      amount: cell.sum,
    });
  }
  income.push(...trim(sectorLines, 12, 'Прочие сектора', ['сектор', 'сектора', 'секторов']));

  // Топливо Е-711 подстёгивает верфи (только Супер-Земля).
  if (faction === 'superEarth') {
    const fuel = e711Report(state).gross;
    if (fuel > 0) income.push({ name: 'Топливо Е-711', detail: 'ускорение верфей', amount: fuel * 0.6 });
  }

  // Дань марионеток и дань сюзерену.
  const puppets = state.puppets ?? {};
  for (const [vassal, master] of Object.entries(puppets) as [FactionId, FactionId][]) {
    const vs = state.factions[vassal];
    if (!vs?.alive || !state.factions[master]?.alive) continue;
    if (master === faction) {
      income.push({
        name: `Дань: ${FACTIONS[vassal].name}`,
        detail: 'марионетка',
        amount: vs.production * 0.15,
      });
    } else if (vassal === faction) {
      drain.push({
        name: `Дань: ${FACTIONS[master].name}`,
        detail: 'протекторат',
        amount: fs.production * 0.15,
      });
    }
  }

  // Содержание флота: каждый корпус ест производство ежедневно.
  const upkeepRate = modActive(state, 'scrapShortage') ? 0.07 : 0.05;
  const fleets = fleetsOf(state, faction);
  const hulls = fleets.reduce((s, f) => s + f.ships + f.dreadnoughts * 2 + f.battleships * 4, 0);
  if (hulls > 0) {
    drain.push({
      name: 'Содержание флота',
      detail: `${fleets.length} соед. · ${hulls.toFixed(0)} ${plural(hulls, 'корпус', 'корпуса', 'корпусов')}`,
      amount: hulls * upkeepRate,
    });
  }

  return finish('production', fs.production, income, drain);
}

/** Руда: залежи снабжаемых миров и города-шахты. У машин — минус сборка корпусов. */
export function mineralsReport(state: GameState, faction: FactionId): IncomeReport {
  const fs = state.factions[faction];
  const worlds = planetsOf(state, faction);
  let rate = faction === 'automatons' ? 0.17 : 0.11;
  let mineRate = 0.06;
  if (modActive(state, 'richVeins')) {
    rate *= 1.5;
    mineRate *= 1.5;
  }

  const lines: IncomeLine[] = [];
  const cut: IncomeLine[] = [];
  for (const p of worlds) {
    const mines = p.cities.filter((c) => c.spec === 'mine' && c.holder === faction).length;
    const amount = (p.minerals > 0 ? p.minerals * rate : 0) + mines * mineRate;
    if (amount <= 0) continue;
    const what = [
      p.minerals > 1 ? 'богатые залежи' : p.minerals > 0 ? 'залежи' : '',
      mines ? `${mines} шахт.` : '',
    ].filter(Boolean).join(' · ');
    // Мир без снабжения не отдаёт руду — но в списке он нужен: игрок должен
    // видеть, какой доход ему вернёт пробитый коридор.
    if (!p.supplied) cut.push({ name: p.name, detail: `${what} · нет снабжения`, amount });
    else lines.push({ name: p.name, detail: `${p.sector} · ${what}`, amount });
  }
  const income = trim(lines, 16, 'Прочие миры', WORLDS);
  const drain: IncomeLine[] = [];

  // Автоматоны переплавляют руду в корпуса — расход того же дня.
  if (faction === 'automatons') {
    const gross = income.reduce((s, l) => s + l.amount, 0);
    let avail = fs.resources.minerals + gross;
    const planetCount = worlds.length;
    const rec = fs.bonuses.recruitment;
    const take = (unit: string, wantedBase: number, cap: number, label: string): void => {
      if ((fs.units[unit] ?? 0) >= cap) return;
      const spend = Math.min(avail, (wantedBase + planetCount * 0.06) / 2);
      if (spend <= 0) return;
      avail -= spend;
      drain.push({ name: label, detail: 'переплавка в корпуса', amount: spend });
    };
    take('vsa', 2.0 + rec * 2, 200 + planetCount * 7, 'Автоматонские силы');
    const factories = new Set(worlds.flatMap((p) => p.buildings));
    if (factories.has('incinFactory')) take('incinerators', 0.8, 120, 'Испепеляющие отряды');
    if (factories.has('jetFactory')) take('jets', 0.8, 120, 'Реактивные батальоны');
  }

  return finish('minerals', fs.resources.minerals, income, drain, trim(cut, 8, 'Прочие отрезанные миры', WORLDS));
}

/** Е-711: добыча Супер-Земли на бывших жучьих мирах и станции на марионетках. */
export function e711Report(state: GameState): IncomeReport {
  const se = state.factions.superEarth;
  const income: IncomeLine[] = [];
  if (se.flags.e711Mining) {
    for (const p of planetsOf(state, 'superEarth')) {
      if (p.e711Rich) {
        income.push({ name: p.name, detail: `${p.sector} · богатые залежи`, amount: 0.5 });
      } else if (p.origin === 'terminids') {
        income.push({ name: p.name, detail: `${p.sector} · следы залежей`, amount: 0.15 });
      }
    }
  }
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    if (p.puppetOf === 'superEarth' && p.buildings.includes('e711Station')) {
      income.push({ name: p.name, detail: 'станция добычи на марионетке', amount: 0.7 });
    }
  }
  return finish('e711', se.resources.e711, trim(income, 16, 'Прочие миры', WORLDS), []);
}

/** Политвласть: базовый приток, поправка на стабильность, «Военный пыл». */
export function powerReport(state: GameState, faction: FactionId): IncomeReport {
  const fs = state.factions[faction];
  const income: IncomeLine[] = [];
  if (fs.alive) {
    const stabMod = faction === 'superEarth' ? 0.5 + fs.stability / 100 : 1;
    const fervor = modActive(state, 'fervor') ? 1.15 : 1;
    income.push({ name: 'Верховное командование', detail: 'базовый приток', amount: PP_PER_DAY });
    if (stabMod !== 1) {
      income.push({
        name: 'Стабильность в тылу',
        detail: `${fs.stability.toFixed(0)}% · ×${stabMod.toFixed(2)}`,
        amount: PP_PER_DAY * (stabMod - 1),
      });
    }
    if (fervor !== 1) {
      income.push({
        name: 'Военный пыл',
        detail: `условие кампании · ×${fervor.toFixed(2)}`,
        amount: PP_PER_DAY * stabMod * (fervor - 1),
      });
    }
  }
  return finish('power', fs.politicalPower, income, []);
}

function finish(
  resource: ResourceId,
  stock: number,
  income: IncomeLine[],
  drain: IncomeLine[],
  blocked: IncomeLine[] = [],
): IncomeReport {
  income.sort(byAmount);
  drain.sort(byAmount);
  const gross = income.reduce((s, l) => s + l.amount, 0);
  const spent = drain.reduce((s, l) => s + l.amount, 0);
  return { resource, stock, income, drain, blocked, gross, net: gross - spent };
}

/** Отчёт по любому ресурсу — точка входа для интерфейса. */
export function resourceReport(state: GameState, faction: FactionId, res: ResourceId): IncomeReport {
  switch (res) {
    case 'production': return productionReport(state, faction);
    case 'minerals': return mineralsReport(state, faction);
    case 'e711': return e711Report(state);
    case 'power': return powerReport(state, faction);
  }
}
