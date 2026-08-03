import { planetsOf, pushLog, type GameState } from './state';
import { yardsOf } from './shipyards';
import { bus } from '../core/emitter';

// Цели кампании: живой список задач партии. Награда — политическая власть.

export interface Objective {
  id: string;
  title: string;
  desc: string;
  reward: number;
  check(state: GameState): boolean;
}

export const OBJECTIVES: Objective[] = [
  { id: 'obj_year1', title: 'Твёрдая рука', desc: 'Прожить первый год со стабильностью выше 50%.', reward: 60,
    check: (s) => s.day >= 365 && s.factions.superEarth.stability > 50 },
  { id: 'obj_cyberstan', title: 'Освободитель Киберстана', desc: 'Отбить Киберстан у машин до конца третьего года.', reward: 120,
    check: (s) => s.day <= 1095 && [...s.galaxy.planets.values()].some((p) => p.name === 'Киберстан' && p.owner === s.player) },
  { id: 'obj_capitulate', title: 'Укротитель роя', desc: 'Принудить терминидов к капитуляции.', reward: 150,
    check: (s) => s.terminidsCapitulated },
  { id: 'obj_yards', title: 'Кузница флота', desc: 'Держать одновременно три верфи.', reward: 80,
    check: (s) => yardsOf(s, s.player).length >= 3 },
  { id: 'obj_fifty', title: 'Половина галактики', desc: 'Контролировать 50 планет.', reward: 100,
    check: (s) => planetsOf(s, s.player).length >= 50 },
  { id: 'obj_superweapon', title: 'Разрушитель богов', desc: 'Уничтожить супероружие любой вражеской фракции.', reward: 120,
    check: (s) => (Object.keys(s.factions) as (keyof typeof s.factions)[]).some((f) => f !== s.player && s.factions[f].lostSpecial) },
];

/** Ежедневная проверка целей кампании (награда выдаётся один раз). */
export function checkObjectives(state: GameState): void {
  for (const o of OBJECTIVES) {
    if (state.doneObjectives.includes(o.id)) continue;
    if (!o.check(state)) continue;
    state.doneObjectives.push(o.id);
    state.factions[state.player].politicalPower += o.reward;
    pushLog(state, {
      faction: state.player,
      text: `🏆 Цель кампании выполнена: «${o.title}» (+${o.reward} ПВ).`,
      tone: 'good',
    });
    bus.emit('gameEvent', { title: `ЦЕЛЬ ВЫПОЛНЕНА: ${o.title}`, text: `${o.desc} Награда: +${o.reward} политической власти.` });
  }
}
