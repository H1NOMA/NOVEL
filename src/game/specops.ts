import type { FactionId, Planet } from '../core/types';
import { fleetsAt, pushLog, type GameState } from './state';
import { hostileNow } from './diplomacy';
import { emptyYard } from './shipyards';

// ---------------------------------------------------------------------------
// Спецоперации: точечные акции за политическую власть. У каждой — своя цена
// и кулдаун; цель выбирается кликом по планете в режиме операции.
// ---------------------------------------------------------------------------

export interface SpecOpDef {
  id: string;
  name: string;
  desc: string;
  /** Стоимость в политической власти. */
  cost: number;
  /** Дней между применениями. */
  cooldown: number;
}

export const SPEC_OPS: SpecOpDef[] = [
  {
    id: 'sabotage',
    name: 'Диверсия на верфи',
    desc: 'Агенты уничтожают стапель и склад корпусов на вражеской верфи. Цель — вражеская планета с верфью.',
    cost: 90,
    cooldown: 120,
  },
  {
    id: 'recon',
    name: 'Разведка сектора',
    desc: 'Разведсеть вскрывает сектор: чужие флоты и линии атак видны 30 дней. Цель — любая планета сектора.',
    cost: 60,
    cooldown: 45,
  },
  {
    id: 'uprising',
    name: 'Подрывная агитация',
    desc: 'Подполье поднимает восстание: гарнизон вражеской планеты редеет, укрепления рушатся.',
    cost: 120,
    cooldown: 180,
  },
];

export const RECON_DAYS = 30;

export function opDef(id: string): SpecOpDef | null {
  return SPEC_OPS.find((o) => o.id === id) ?? null;
}

/** Дней до готовности операции (0 = можно применять). */
export function opReadyIn(state: GameState, faction: FactionId, opId: string): number {
  const def = opDef(opId);
  const used = state.factions[faction].opsUsed[opId];
  if (!def || used === undefined) return 0;
  return Math.max(0, def.cooldown - (state.day - used));
}

function payOp(state: GameState, faction: FactionId, opId: string): boolean {
  const def = opDef(opId);
  const fs = state.factions[faction];
  if (!def || fs.politicalPower < def.cost || opReadyIn(state, faction, opId) > 0) return false;
  fs.politicalPower -= def.cost;
  fs.opsUsed[opId] = state.day;
  return true;
}

/** Годится ли планета как цель диверсии для фракции. */
export function canSabotage(state: GameState, faction: FactionId, p: Planet): boolean {
  return !!p.shipyard && p.owner !== faction && !p.shattered && !p.abyss &&
    hostileNow(state, faction, p.owner);
}

/** Диверсия: стапель и склад вражеской верфи уничтожены. */
export function runSabotage(state: GameState, faction: FactionId, planetId: string): boolean {
  const p = state.galaxy.planets.get(planetId);
  if (!p || !canSabotage(state, faction, p)) return false;
  if (!payOp(state, faction, 'sabotage')) return false;
  p.shipyard = emptyYard();
  pushLog(state, {
    faction,
    text: `Диверсия на ${p.name}: стапель взорван, склад корпусов уничтожен. Верфь врага надолго парализована.`,
    tone: faction === state.player ? 'good' : 'alert',
  });
  return true;
}

/** Действует ли разведка на сектор прямо сейчас. */
export function reconActive(state: GameState, sector: string): boolean {
  return state.recons.some((r) => r.sector === sector && r.until > state.day);
}

/** Разведка: сектор планеты-цели просматривается RECON_DAYS дней. */
export function runRecon(state: GameState, faction: FactionId, planetId: string): boolean {
  const p = state.galaxy.planets.get(planetId);
  if (!p || reconActive(state, p.sector)) return false;
  if (!payOp(state, faction, 'recon')) return false;
  state.recons.push({ sector: p.sector, until: state.day + RECON_DAYS });
  pushLog(state, {
    faction,
    text: `Разведсеть развёрнута в секторе ${p.sector}: чужие флоты и линии атак видны ${RECON_DAYS} дней.`,
    tone: faction === state.player ? 'good' : 'info',
  });
  return true;
}

/** Годится ли планета как цель агитации. */
export function canUprising(state: GameState, faction: FactionId, p: Planet): boolean {
  return p.owner !== faction && !p.shattered && !p.abyss && !p.puppetOf &&
    hostileNow(state, faction, p.owner) && p.garrison > 5;
}

/** Восстание: гарнизон цели −35%, укрепления −1. */
export function runUprising(state: GameState, faction: FactionId, planetId: string): boolean {
  const p = state.galaxy.planets.get(planetId);
  if (!p || !canUprising(state, faction, p)) return false;
  if (!payOp(state, faction, 'uprising')) return false;
  p.garrison = Math.max(1, p.garrison * 0.65);
  p.fortification = Math.max(0, p.fortification - 1);
  pushLog(state, {
    faction,
    text: `Восстание на ${p.name}: гарнизон подавляет мятеж ценой трети сил, укрепления горят.`,
    tone: faction === state.player ? 'good' : 'alert',
  });
  return true;
}

/** Есть ли на орбите плацдарма враги, режущие снабжение атаки. */
export function originBlockaded(state: GameState, originId: string, attacker: FactionId): boolean {
  return fleetsAt(state, originId).some((f) => hostileNow(state, f.faction, attacker));
}

/** Чистка истёкших разведопераций (раз в день). */
export function stepRecons(state: GameState): void {
  const before = state.recons.length;
  state.recons = state.recons.filter((r) => r.until > state.day);
  if (state.recons.length < before) {
    pushLog(state, { text: 'Разведоперация завершена: сектор снова скрыт туманом войны.', tone: 'info' });
  }
}
