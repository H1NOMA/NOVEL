import type { FactionId } from '../core/types';
import { FACTIONS, FACTION_IDS } from '../data/factions';
import { pushLog, type GameState } from './state';
import {
  adjustRelation, atWar, canNegotiate, declareWar, makePeace, relationOf, WAR_THRESHOLD,
} from './relations';

// ---------------------------------------------------------------------------
// Дипломатические происшествия.
//
// Это тот слой, из-за которого мир не длится вечно и война не начинается на
// ровном месте. Каждые несколько дней между парой фракций может случиться
// инцидент — пограничная стычка, шпионский скандал, торговое соглашение,
// требование уступить мир. Игрок видит их в ленте и понимает, куда всё катится.
// ---------------------------------------------------------------------------

interface Incident {
  id: string;
  /** Насколько двигает симпатию (отрицательное — портит). */
  delta: number;
  /** Текст: %A и %B заменяются именами фракций. */
  text: string;
  tone: 'good' | 'bad' | 'info' | 'alert';
  /** Годится ли инцидент для пары в мире / в войне. */
  when: 'peace' | 'war' | 'any';
  /** Не для роя: у терминидов нет ни послов, ни торговли. */
  needsTalks?: boolean;
}

const INCIDENTS: Incident[] = [
  { id: 'border_clash', delta: -9, when: 'peace', tone: 'bad',
    text: 'Пограничный инцидент: патрули %A и %B обменялись огнём в спорной системе.' },
  { id: 'spy_scandal', delta: -12, when: 'peace', tone: 'bad', needsTalks: true,
    text: 'Шпионский скандал: агентура %A вскрыта в штабах %B. Ноты протеста летят вторые сутки.' },
  { id: 'convoy_seized', delta: -7, when: 'peace', tone: 'bad',
    text: 'Досмотр обернулся конфискацией: %A задержала грузовой конвой %B.' },
  { id: 'propaganda', delta: -5, when: 'peace', tone: 'info', needsTalks: true,
    text: 'Пропагандистская кампания %A называет %B угрозой цивилизации.' },
  { id: 'trade_pact', delta: 11, when: 'peace', tone: 'good', needsTalks: true,
    text: 'Торговое соглашение: %A и %B открывают коридоры снабжения.' },
  { id: 'joint_rescue', delta: 8, when: 'peace', tone: 'good', needsTalks: true,
    text: 'Совместная спасательная операция: флоты %A и %B вместе сняли колонистов с гибнущего мира.' },
  { id: 'summit', delta: 14, when: 'peace', tone: 'good', needsTalks: true,
    text: 'Саммит на нейтральной станции: %A и %B подтверждают статус-кво.' },
  { id: 'prisoner_swap', delta: 9, when: 'war', tone: 'info', needsTalks: true,
    text: 'Обмен пленными: %A и %B провели тяжёлые переговоры под огнём.' },
  { id: 'atrocity', delta: -10, when: 'war', tone: 'alert',
    text: 'Разбомблен госпитальный конвой. %B обвиняет %A в военном преступлении.' },
  { id: 'ceasefire_talks', delta: 12, when: 'war', tone: 'good', needsTalks: true,
    text: 'Переговоры о прекращении огня: %A и %B впервые сели за стол.' },
];

/** Раз в несколько дней разыгрываем одно происшествие на случайной паре. */
export function stepDiploEvents(state: GameState): void {
  if (state.day % 6 !== 0) return;
  const alive = FACTION_IDS.filter((f) => state.factions[f].alive);
  if (alive.length < 2) return;

  const a = alive[Math.floor(state.rng.range(0, alive.length))]!;
  const rest = alive.filter((f) => f !== a);
  if (!rest.length) return;
  const b = rest[Math.floor(state.rng.range(0, rest.length))]!;

  // Марионетка и сюзерен не ссорятся.
  if (state.puppets?.[a] === b || state.puppets?.[b] === a) return;

  const war = atWar(state, a, b);
  const talks = canNegotiate(a, b);
  const pool = INCIDENTS.filter((i) =>
    (i.when === 'any' || (i.when === 'war') === war) && (!i.needsTalks || talks));
  if (!pool.length) return;

  // Чем хуже отношения, тем чаще выпадает плохое: настроение само себя кормит.
  const rel = relationOf(state, a, b);
  const wantBad = state.rng.range(0, 100) > (rel + 100) / 2;
  const filtered = pool.filter((i) => (i.delta < 0) === wantBad);
  const inc = (filtered.length ? filtered : pool)[
    Math.floor(state.rng.range(0, (filtered.length ? filtered : pool).length))
  ]!;

  adjustRelation(state, a, b, inc.delta);
  pushLog(state, {
    text: inc.text.replace('%A', FACTIONS[a].name).replace('%B', FACTIONS[b].name),
    tone: inc.tone,
  });

  // Инцидент мог стать последней каплей.
  if (!war && relationOf(state, a, b) <= WAR_THRESHOLD) {
    declareWar(state, a, b, 'череда инцидентов');
  }
}

/**
 * Решения ИИ по войне и миру. Компьютерные фракции не объявляют войну сразу
 * всем: им нужен и повод (низкая симпатия), и силы. Уставшие от долгой войны
 * охотно мирятся — иначе галактика застревает в вечной мясорубке.
 */
export function stepAiDiplomacy(state: GameState): void {
  if (state.day % 10 !== 0) return;
  for (const r of state.relations) {
    const { a, b } = r;
    if (!state.factions[a].alive || !state.factions[b].alive) continue;
    if (!canNegotiate(a, b)) continue;
    if (state.puppets?.[a] === b || state.puppets?.[b] === a) continue;

    const worlds = (f: FactionId) =>
      state.galaxy.order.filter((id) => state.galaxy.planets.get(id)!.owner === f).length;

    if (r.war) {
      // Мир заключают, когда обе стороны выдохлись и злость поутихла.
      const days = state.day - (r.warSince ?? state.day);
      const tired = days > 200 && r.value > -35;
      if (tired && state.rng.range(0, 1) < 0.4) makePeace(state, a, b);
      continue;
    }

    // Сильный сосед со слабым и нелюбимым соседом — классический повод.
    const ratio = worlds(a) / Math.max(1, worlds(b));
    if (r.value < -40 && ratio > 1.6 && state.rng.range(0, 1) < 0.25) {
      declareWar(state, a, b, 'притязания на пограничные миры');
    }
  }
}
