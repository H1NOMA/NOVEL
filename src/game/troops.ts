import type { FactionId, FactionState } from '../core/types';
import { TROOPS, troopsOf } from '../data/troops';
import { modActive, planetsOf, pushLog, type GameState } from './state';

// ---------------------------------------------------------------------------
// Людские (и не очень) ресурсы. Пулы войск — единственный источник пехоты:
// из них комплектуются флоты и пополняются гарнизоны. Правила пополнения:
//   СЗ         — прирост от числа контролируемых планет; стартовый пул велик.
//   Автоматоны — ВСА/отряды требуют ископаемых; особые отряды — ещё и фабрик;
//                Легионы киборгов собираются только пока у них есть Киберстан.
//   Терминиды  — Рой растёт бесконечно, пропорционально числу планет.
//   Иллюминаты — Великий флот НЕ восполняется; Безмозглые массы пополняются
//                за счёт населения захваченных миров Супер-Земли.
// ---------------------------------------------------------------------------

export function initUnits(faction: FactionId): Record<string, number> {
  const units: Record<string, number> = {};
  for (const t of troopsOf(faction)) units[t.id] = t.initial;
  return units;
}

export function totalUnits(fs: FactionState): number {
  return Object.values(fs.units).reduce((s, n) => s + n, 0);
}

function roleShare(fs: FactionState, role: 'elite' | 'mass'): number {
  const total = totalUnits(fs);
  if (total <= 0) return 0;
  let n = 0;
  for (const t of TROOPS) {
    if (t.faction === fs.id && t.role === role) n += fs.units[t.id] ?? 0;
  }
  return n / total;
}

/** Доля элиты — усиливает бой. */
export function eliteShare(fs: FactionState): number {
  return roleShare(fs, 'elite');
}

/** Доля массовой пехоты — ускоряет установление контроля над планетами. */
export function massShare(fs: FactionState): number {
  return roleShare(fs, 'mass');
}

/**
 * Списать `amount` бойцов из пулов (масса → спец → элита; элиту берегут).
 * Возвращает фактически списанное число.
 */
export function drawUnits(fs: FactionState, amount: number): number {
  let need = amount;
  const order = ['mass', 'special', 'elite'] as const;
  for (const role of order) {
    if (need <= 0) break;
    for (const t of troopsOf(fs.id)) {
      if (t.role !== role || need <= 0) continue;
      const have = fs.units[t.id] ?? 0;
      const take = Math.min(have, need);
      fs.units[t.id] = have - take;
      need -= take;
    }
  }
  return amount - need;
}

/**
 * Ежедневная добыча ископаемых: каждая СНАБЖАЕМАЯ планета с залежами даёт
 * доход по уровню залежей. Автоматоны копают быстрее — машинам не нужен сон.
 */
export function mineMinerals(state: GameState, faction: FactionId): number {
  // Балансовые прогоны (5 сидов × 10 лет): при 0.22 машины выигрывали
  // экономику в каждой партии — темп срезан до 0.17.
  let rate = faction === 'automatons' ? 0.17 : 0.11;
  let mineRate = 0.06;
  // Условие кампании «Богатые жилы»: щедрая галактика. Множитель идёт и на
  // города-шахты — жилы богаче ВЕЗДЕ, а не только в залежах на карте. Раньше
  // шахты его не получали, и на мирах, где вся добыча держалась на них,
  // условие кампании почти ничего не меняло.
  if (modActive(state, 'richVeins')) {
    rate *= 1.5;
    mineRate *= 1.5;
  }
  let income = 0;
  for (const p of planetsOf(state, faction)) {
    if (!p.supplied) continue;
    if (p.minerals > 0) income += p.minerals * rate;
    // Город-шахта даёт руду даже на бедных мирах.
    income += p.cities.filter((c) => c.spec === 'mine' && c.holder === faction).length * mineRate;
  }
  state.factions[faction].resources.minerals += income;
  return income;
}

/**
 * Ежедневное пополнение пулов по правилам фракции. Армии КОНЕЧНЫ: у роста
 * есть потолки, зависящие от числа планет, — затяжная война выжигает резервы.
 */
export function replenishUnits(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  const worlds = planetsOf(state, faction);
  const planetCount = worlds.length;
  const rec = fs.bonuses.recruitment;
  // Поддержка войны реально двигает призыв: 0% → ×0.85, 100% → ×1.15.
  let morale = 0.85 + fs.warSupport / 333;
  // Условие кампании «Век роя»: биомасса терминидов цветёт.
  if (faction === 'terminids' && modActive(state, 'swarmAge')) morale *= 1.4;
  const grow = (unit: string, amount: number, cap: number) => {
    fs.units[unit] = Math.min(cap, (fs.units[unit] ?? 0) + amount * (1 + rec) * morale);
  };

  switch (faction) {
    case 'superEarth': {
      // Призыв идёт с контролируемых планет, но мобилизационный резерв ограничен.
      grow('seaf', 1.2 + planetCount * 0.16, 240 + planetCount * 6);
      grow('helldivers', 0.22, 90 + planetCount * 0.8);
      break;
    }
    case 'automatons': {
      // Легионы киборгов — только пока у автоматонов есть Киберстан.
      const hasCyberstan = worlds.some((p) => p.isCapital && p.origin === 'automatons');
      if (hasCyberstan) grow('cyborgLegion', 1.0, 160);
      // Остальные корпуса собираются ИЗ ИСКОПАЕМЫХ (1 минерал = 2 бойца).
      const spendFor = (unit: string, wantedBase: number, cap: number) => {
        if ((fs.units[unit] ?? 0) >= cap) return;
        const wanted = wantedBase + planetCount * 0.06;
        const spend = Math.min(fs.resources.minerals, wanted / 2);
        fs.resources.minerals -= spend;
        fs.units[unit] = Math.min(cap, (fs.units[unit] ?? 0) + spend * 2);
      };
      spendFor('vsa', 2.0 + rec * 2, 200 + planetCount * 7);
      const factories = new Set(worlds.flatMap((p) => p.buildings));
      if (factories.has('incinFactory')) spendFor('incinerators', 0.8, 120);
      if (factories.has('jetFactory')) spendFor('jets', 0.8, 120);
      break;
    }
    case 'terminids': {
      // Рой растёт с каждым ульем — но биомасса тоже не бесконечна на малой
      // территории: загоните жуков на пару планет, и рой иссякнет.
      grow('swarm', 0.8 * planetCount, 220 + planetCount * 14);
      grow('breachStrain', 0.06 * planetCount, 60 + planetCount * 2);
      grow('predatorStrain', 0.05 * planetCount, 50 + planetCount * 2);
      grow('sporeStrain', 0.06 * planetCount, 60 + planetCount * 2);
      break;
    }
    case 'illuminate': {
      // Великий флот не восполняется — он пришёл из другого измерения.
      // Массы растут от «урожая» на бывших мирах Супер-Земли.
      const harvested = worlds.filter((p) => p.origin === 'superEarth').length;
      grow('voteless', harvested * 0.45, 160 + harvested * 20);
      grow('confiscators', 0.09 * planetCount, 90);
      break;
    }
    case 'superFederation': {
      grow('fedArmy', 0.5 * planetCount, 160 + planetCount * 8);
      grow('fedGuard', 0.1, 70);
      break;
    }
  }

  // Синхронизируем сводный показатель резерва.
  fs.manpower = totalUnits(fs);
}

/** Добыча Е-711 Супер-Землёй: свои бывшие терминидские миры + станции на марионетках. */
export function mineE711(state: GameState): void {
  const se = state.factions.superEarth;
  let income = 0;
  if (se.flags.e711Mining) {
    for (const p of planetsOf(state, 'superEarth')) {
      if (p.e711Rich) income += 0.5;
      else if (p.origin === 'terminids') income += 0.15;
    }
  }
  // Станции добычи на жучьих мирах-марионетках работают и без общего решения.
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    if (p.puppetOf === 'superEarth' && p.buildings.includes('e711Station')) income += 0.7;
  }
  if (income <= 0) return;
  se.resources.e711 += income;
  // Топливо ускоряет флотское производство.
  se.production += income * 0.6;
}

/** Иллюминаты забирают население при захвате мира Супер-Земли. */
export function harvestPopulation(state: GameState, planetName: string, garrisonLost: number, cities: number): void {
  const ill = state.factions.illuminate;
  const gained = Math.floor(garrisonLost * 0.4 + cities * 6);
  if (gained <= 0) return;
  ill.units.voteless = (ill.units.voteless ?? 0) + gained;
  pushLog(state, {
    faction: 'illuminate',
    text: `Конфискаторы вывозят население ${planetName}: Безмозглые массы +${gained}.`,
    tone: 'alert',
  });
}
