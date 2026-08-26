import { pushLog, type GameState } from './state';
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

/** Столица взята игроком и не принадлежала ему изначально. */
function capturedCapital(s: GameState, name: string): boolean {
  const p = [...s.galaxy.planets.values()].find((w) => w.name === name);
  return !!p && p.owner === s.player && p.origin !== s.player;
}

export const OBJECTIVES: Objective[] = [
  { id: 'obj_year1', title: 'Твёрдая рука', desc: 'Прожить первый год со стабильностью выше 50%.', reward: 60,
    check: (s) => s.day >= 365 && s.factions.superEarth.stability > 50 },
  // Столица засчитывается, только если она НЕ своя изначально: играя за
  // автоматонов, Киберстан игрок держит с первого дня, и цель закрывалась
  // сама собой ещё до начала войны.
  { id: 'obj_cyberstan', title: 'Освободитель Киберстана', desc: 'Отбить Киберстан у машин до конца третьего года.', reward: 120,
    check: (s) => s.day <= 1095 && capturedCapital(s, 'Киберстан') },
  { id: 'obj_capitulate', title: 'Укротитель роя', desc: 'Принудить терминидов к капитуляции.', reward: 150,
    check: (s) => s.terminidsCapitulated },
  { id: 'obj_yards', title: 'Кузница флота', desc: 'Держать одновременно три верфи.', reward: 80,
    check: (s) => yardsOf(s, s.player).length >= 3 },
  // Числовой порог владений здесь бессмыслен в принципе: партия начинается с
  // 95% галактики в руках Супер-Земли, врагам оставлены только домашние
  // сектора. «50 планет» выполнялись на второй день, «девять из десяти» — на
  // первый. Цель имеет смысл только тогда, когда требует взять чужую столицу.
  { id: 'obj_shrine', title: 'Осквернитель святилища', desc: "Взять Святилище Скв'бай у иллюминатов.", reward: 130,
    check: (s) => capturedCapital(s, "Святилище Скв'бай") },
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
