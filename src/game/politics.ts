import type { FactionId, FactionState } from '../core/types';
import { modActive, pushLog, type GameState } from './state';

// ---------------------------------------------------------------------------
// Политическая власть (ПВ). Копится ежедневно; в досье фракции — раскрываемое
// меню бонусов в духе HoI4: трата ПВ на постоянные усиления. Часть бонусов
// повторяемая, часть — разовая.
// ---------------------------------------------------------------------------

export const PP_PER_DAY = 0.35;

export interface PowerBonus {
  id: string;
  name: string;
  desc: string;
  cost: number;
  /** Можно покупать многократно. */
  repeatable: boolean;
  /** Ограничение по фракции (undefined — доступен всем). */
  faction?: FactionId;
}

export const POWER_BONUSES: PowerBonus[] = [
  {
    id: 'propaganda',
    name: 'Военная пропаганда',
    desc: '+8 поддержки войны. Плакаты, марши, свежие сводки побед.',
    cost: 60,
    repeatable: true,
  },
  {
    id: 'recruitment',
    name: 'Ускоренная вербовка',
    desc: '+10% к пополнению войск. Очереди у призывных пунктов.',
    cost: 100,
    repeatable: true,
  },
  {
    id: 'industry',
    name: 'Мобилизация промышленности',
    desc: '+2 промышленности. Заводы переходят на военные рельсы.',
    cost: 120,
    repeatable: true,
  },
  {
    id: 'shipCap',
    name: 'Расширение флотских штатов',
    desc: '+1 к лимиту боевых соединений.',
    cost: 140,
    repeatable: true,
  },
  {
    id: 'emergency',
    name: 'Чрезвычайные полномочия',
    desc: '+12 стабильности. Министерство Правды работает сверхурочно.',
    cost: 90,
    repeatable: true,
    faction: 'superEarth',
  },
  {
    id: 'fortify',
    name: 'Программа укреплений',
    desc: '+1 к укреплениям всех своих миров (разово).',
    cost: 150,
    repeatable: false,
  },
];

/** Бонусы, доступные фракции (без учёта цены). */
export function bonusesFor(faction: FactionId): PowerBonus[] {
  return POWER_BONUSES.filter((b) => !b.faction || b.faction === faction);
}

export function timesBought(state: GameState, faction: FactionId, id: string): number {
  return state.factions[faction].purchasedBonuses.filter((b) => b === id).length;
}

export function canBuyBonus(state: GameState, faction: FactionId, id: string): boolean {
  const def = POWER_BONUSES.find((b) => b.id === id);
  const fs = state.factions[faction];
  if (!def || !fs.alive) return false;
  if (def.faction && def.faction !== faction) return false;
  if (!def.repeatable && timesBought(state, faction, id) > 0) return false;
  // Бонус, который уже ничего не изменит, покупать нельзя.
  //
  // Пропаганда поднимает поддержку войны, чрезвычайные полномочия —
  // стабильность, и оба зажаты сотней. На потолке покупка списывала полную
  // цену, писала строку в журнал и не давала ровным счётом ничего, а кнопка
  // в досье оставалась активной: игрок платил 60–90 ПВ за пустоту.
  if (!applicable(def, fs)) return false;
  return fs.politicalPower >= def.cost;
}

/** Способен ли эффект бонуса вообще что-то изменить прямо сейчас. */
function applicable(def: { id: string }, fs: FactionState): boolean {
  if (def.id === 'propaganda') return fs.warSupport < 100;
  if (def.id === 'emergency') return fs.stability < 100;
  return true;
}

/** Купить бонус за политическую власть и немедленно применить эффект. */
export function buyBonus(state: GameState, faction: FactionId, id: string): boolean {
  if (!canBuyBonus(state, faction, id)) return false;
  const def = POWER_BONUSES.find((b) => b.id === id)!;
  const fs = state.factions[faction];
  fs.politicalPower -= def.cost;
  fs.purchasedBonuses.push(id);
  switch (id) {
    case 'propaganda':
      fs.warSupport = Math.min(100, fs.warSupport + 8);
      break;
    case 'recruitment':
      fs.bonuses.recruitment += 0.1;
      break;
    case 'industry':
      fs.industry += 2;
      break;
    case 'shipCap':
      fs.bonuses.shipCap += 1;
      break;
    case 'emergency':
      fs.stability = Math.min(100, fs.stability + 12);
      break;
    case 'fortify':
      for (const pid of state.galaxy.order) {
        const p = state.galaxy.planets.get(pid)!;
        if (p.owner === faction && !p.shattered) {
          p.fortification = Math.min(5, p.fortification + 1);
        }
      }
      break;
  }
  pushLog(state, {
    faction,
    text: `Политическое решение: «${def.name}» (−${def.cost} ПВ).`,
    tone: faction === state.player ? 'good' : 'info',
  });
  return true;
}

/** Ежедневное накопление ПВ (стабильность подстёгивает или тормозит). */
export function accruePower(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.alive) return;
  const stabMod = faction === 'superEarth' ? 0.5 + fs.stability / 100 : 1;
  // Условие кампании «Военный пыл»: политвласть копится быстрее.
  const fervor = modActive(state, 'fervor') ? 1.15 : 1;
  fs.politicalPower += PP_PER_DAY * stabMod * fervor;
}
