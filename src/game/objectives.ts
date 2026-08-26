import { isHuman, pushLog, type GameState } from './state';
import { yardsOf } from './shipyards';
import { bus } from '../core/emitter';
import type { FactionId } from '../core/types';

// Цели кампании: живой список задач партии. Награда — политическая власть.
//
// Цели ЛИЧНЫЕ. В сетевой партии за столом сидят несколько человек, и «взял
// Киберстан» — заслуга того, кто его взял, а не хоста. Поэтому проверка идёт
// по каждой человеческой фракции отдельно, а выполненное хранится ключами
// вида «illuminate:obj_shrine»: один общий список, но каждый видит своё.

export interface Objective {
  id: string;
  title: string;
  desc: string;
  reward: number;
  /** Цель имеет смысл только для этой фракции (иначе — для любой). */
  faction?: FactionId;
  check(state: GameState, faction: FactionId): boolean;
}

/** Столица взята указанной фракцией и не принадлежала ей изначально. */
function capturedCapital(s: GameState, name: string, by: FactionId): boolean {
  const p = [...s.galaxy.planets.values()].find((w) => w.name === name);
  return !!p && p.owner === by && p.origin !== by;
}

export const OBJECTIVES: Objective[] = [
  // Стабильность — механика Супер-Земли: у прочих фракций показатель стоит на
  // месте, и цель закрывалась бы сама собой в первый же год.
  { id: 'obj_year1', title: 'Твёрдая рука', desc: 'Прожить первый год со стабильностью выше 50%.', reward: 60,
    faction: 'superEarth',
    check: (s) => s.day >= 365 && s.factions.superEarth.stability > 50 },
  // Столица засчитывается, только если она НЕ своя изначально: играя за
  // автоматонов, Киберстан игрок держит с первого дня, и цель закрывалась
  // сама собой ещё до начала войны.
  { id: 'obj_cyberstan', title: 'Освободитель Киберстана', desc: 'Отбить Киберстан у машин до конца третьего года.', reward: 120,
    check: (s, f) => s.day <= 1095 && capturedCapital(s, 'Киберстан', f) },
  { id: 'obj_capitulate', title: 'Укротитель роя', desc: 'Принудить терминидов к капитуляции.', reward: 150,
    faction: 'superEarth',
    check: (s) => s.terminidsCapitulated },
  { id: 'obj_yards', title: 'Кузница флота', desc: 'Держать одновременно три верфи.', reward: 80,
    check: (s, f) => yardsOf(s, f).length >= 3 },
  // Числовой порог владений здесь бессмыслен в принципе: партия начинается с
  // 95% галактики в руках Супер-Земли, врагам оставлены только домашние
  // сектора. «50 планет» выполнялись на второй день, «девять из десяти» — на
  // первый. Цель имеет смысл только тогда, когда требует взять чужую столицу.
  { id: 'obj_shrine', title: 'Осквернитель святилища', desc: "Взять Святилище Скв'бай у иллюминатов.", reward: 130,
    check: (s, f) => capturedCapital(s, "Святилище Скв'бай", f) },
  { id: 'obj_superweapon', title: 'Разрушитель богов', desc: 'Уничтожить супероружие любой вражеской фракции.', reward: 120,
    check: (s, f) => (Object.keys(s.factions) as FactionId[]).some((o) => o !== f && s.factions[o].lostSpecial) },
];

/** Цели, которые вообще могут быть выполнены этой фракцией. */
export function objectivesFor(faction: FactionId): Objective[] {
  return OBJECTIVES.filter((o) => !o.faction || o.faction === faction);
}

/** Ключ выполненной цели в общем списке состояния. */
export function objectiveKey(faction: FactionId, id: string): string {
  return `${faction}:${id}`;
}

/** Ежедневная проверка целей кампании (награда выдаётся один раз на фракцию). */
export function checkObjectives(state: GameState): void {
  const players = state.humans?.length ? state.humans : [state.player];
  for (const faction of players) {
    if (!state.factions[faction]?.alive) continue;
    for (const o of objectivesFor(faction)) {
      const key = objectiveKey(faction, o.id);
      if (state.doneObjectives.includes(key)) continue;
      if (!o.check(state, faction)) continue;
      state.doneObjectives.push(key);
      state.factions[faction].politicalPower += o.reward;
      pushLog(state, {
        faction,
        text: `🏆 Цель кампании выполнена: «${o.title}» (+${o.reward} ПВ).`,
        tone: isHuman(state, faction) ? 'good' : 'info',
      });
      if (faction === state.player) {
        bus.emit('gameEvent', {
          title: `ЦЕЛЬ ВЫПОЛНЕНА: ${o.title}`,
          text: `${o.desc} Награда: +${o.reward} политической власти.`,
        });
      }
    }
  }
}
