import type { FactionId, FactionState } from '../core/types';
import { TROOPS, troopsOf } from '../data/troops';
import { planetsOf, pushLog, type GameState } from './state';

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

/** Ежедневное пополнение пулов по правилам фракции. */
export function replenishUnits(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  const worlds = planetsOf(state, faction);
  const planetCount = worlds.length;
  const rec = fs.bonuses.recruitment;

  switch (faction) {
    case 'superEarth': {
      // Прирост военной силы — от числа контролируемых планет.
      fs.units.seaf = (fs.units.seaf ?? 0) + 1.5 + planetCount * 0.5 + rec * 0.2;
      fs.units.helldivers = Math.min(220, (fs.units.helldivers ?? 0) + 0.25 + rec * 0.03);
      break;
    }
    case 'automatons': {
      // Добыча ископаемых со своих планет.
      const mined = worlds.reduce((s, p) => s + p.minerals, 0) * 0.25;
      fs.resources.minerals += mined;
      // Легионы киборгов — только пока у автоматонов есть Киберстан.
      const hasCyberstan = worlds.some((p) => p.isCapital && p.origin === 'automatons');
      if (hasCyberstan) fs.units.cyborgLegion = (fs.units.cyborgLegion ?? 0) + 1.1;
      // Остальные войска собираются из минералов (1 минерал = 2 бойца).
      const spendFor = (unit: string, wantedBase: number) => {
        const wanted = wantedBase + planetCount * 0.06;
        const cost = wanted / 2;
        const spend = Math.min(fs.resources.minerals, cost);
        fs.resources.minerals -= spend;
        fs.units[unit] = (fs.units[unit] ?? 0) + spend * 2;
      };
      spendFor('vsa', 2.2 + rec * 0.2);
      const factories = new Set(worlds.flatMap((p) => p.buildings));
      if (factories.has('incinFactory')) spendFor('incinerators', 0.9);
      if (factories.has('jetFactory')) spendFor('jets', 0.9);
      break;
    }
    case 'terminids': {
      // Бесконечные армии: рой растёт с каждой планетой — яйца и биомасса.
      fs.units.swarm = (fs.units.swarm ?? 0) + 0.9 * planetCount + rec * 0.25;
      fs.units.breachStrain = (fs.units.breachStrain ?? 0) + 0.07 * planetCount;
      fs.units.predatorStrain = (fs.units.predatorStrain ?? 0) + 0.06 * planetCount;
      fs.units.sporeStrain = (fs.units.sporeStrain ?? 0) + 0.07 * planetCount;
      break;
    }
    case 'illuminate': {
      // Великий флот не восполняется — он пришёл из другого измерения.
      // Массы растут от «урожая» на бывших мирах Супер-Земли.
      const harvested = worlds.filter((p) => p.origin === 'superEarth').length;
      fs.units.voteless = (fs.units.voteless ?? 0) + harvested * 0.5 + rec * 0.1;
      fs.units.confiscators = (fs.units.confiscators ?? 0) + 0.1 * planetCount;
      break;
    }
    case 'superFederation': {
      fs.units.fedArmy = (fs.units.fedArmy ?? 0) + 0.55 * planetCount + rec * 0.15;
      fs.units.fedGuard = (fs.units.fedGuard ?? 0) + 0.1;
      break;
    }
  }

  // Синхронизируем сводный показатель резерва.
  fs.manpower = totalUnits(fs);
}

/** Добыча Е-711 Супер-Землёй с бывших терминидских миров. */
export function mineE711(state: GameState): void {
  const se = state.factions.superEarth;
  if (!se.flags.e711Mining) return;
  let income = 0;
  for (const p of planetsOf(state, 'superEarth')) {
    if (p.e711Rich) income += 0.5;
    else if (p.origin === 'terminids') income += 0.15;
  }
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
