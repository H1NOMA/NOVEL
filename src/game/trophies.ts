import type { FactionId, FocusNode } from '../core/types';
import { FACTIONS } from '../data/factions';
import { FOCUS_TREES } from '../data/focus';
import type { GameState } from './state';

// ---------------------------------------------------------------------------
// Трофейные технологии и вариативность древа фокусов.
//
// Трофеи. Когда фракция берёт чужую столицу, к её древу прирастает ветвь
// побеждённого: три ключевых узла чужого дерева, переписанных как трофейные.
// Требования у них снимаются (архивы достались целиком), а стоимость выше —
// осваивать чужую школу дольше, чем свою.
//
// Вариативность. Часть узлов каждой партии выбирается из пары альтернатив по
// сиду: доктрина, с которой фракция входит в войну, каждый раз другая.
// ---------------------------------------------------------------------------

/** Сколько узлов чужого древа достаётся победителю. */
const TROPHY_COUNT = 3;

/** Узлы, которые считаются «сутью» фракции и уходят победителю первыми. */
const CROWN_JEWELS: Record<FactionId, string[]> = {
  superEarth: ['se_orbital', 'se_fleet', 'se_truth'],
  automatons: ['aut_iron_horde', 'aut_dev_ai', 'aut_replicate'],
  illuminate: ['ill_rend', 'ill_conversion', 'ill_crystal_res'],
  terminids: ['term_royal_brood', 'term_gloom', 'term_apex_guard'],
  superFederation: [],
};

function trophyId(source: string): string {
  return `trophy_${source}`;
}

/** Трофейные узлы, доставшиеся фракции за взятые столицы. */
export function trophyNodes(state: GameState, faction: FactionId): FocusNode[] {
  const beaten = state.trophies?.[faction] ?? [];
  if (!beaten.length) return [];
  const out: FocusNode[] = [];
  // Ряд трофеев рисуется ниже собственного древа, чтобы не путать ветви.
  const baseY = Math.max(0, ...FOCUS_TREES[faction].map((n) => n.y)) + 2;
  beaten.forEach((victim, vi) => {
    const tree = FOCUS_TREES[victim] ?? [];
    const picks = (CROWN_JEWELS[victim] ?? [])
      .map((id) => tree.find((n) => n.id === id))
      .filter((n): n is FocusNode => !!n)
      .slice(0, TROPHY_COUNT);
    picks.forEach((src, i) => {
      out.push({
        ...src,
        id: trophyId(src.id),
        faction,
        title: `${src.title} (трофей)`,
        desc: `Из архивов фракции «${FACTIONS[victim].name}»: ${src.desc}`,
        // Чужая школа осваивается дольше своей.
        cost: Math.round(src.cost * 1.4),
        requires: [],
        gate: undefined,
        branch: 'trophy',
        x: i * 2 - 2,
        y: baseY + vi,
      });
    });
  });
  return out;
}

/** Полное древо фракции в этой партии: свои узлы, доктрина партии и трофеи. */
export function treeFor(state: GameState, faction: FactionId): FocusNode[] {
  return [...FOCUS_TREES[faction], ...variantNodes(state, faction), ...trophyNodes(state, faction)];
}

/** Узел по идентификатору с учётом трофеев. */

// --- Вариативность -----------------------------------------------------------

/**
 * Альтернативные доктрины. Для каждого слота партия выбирает один вариант:
 * его эффект заменяет базовый узел, поэтому две партии за одну фракцию
 * играются по-разному.
 */
export interface FocusVariant {
  slot: string;
  faction: FactionId;
  options: { id: string; title: string; desc: string; effects: FocusNode['effects'] }[];
}

export const FOCUS_VARIANTS: FocusVariant[] = [
  {
    slot: 'se_doctrine',
    faction: 'superEarth',
    options: [
      {
        id: 'se_doctrine_blitz',
        title: 'Доктрина «Молния»',
        desc: 'Ставка на скорость: десант бьёт раньше, чем враг успевает окопаться.',
        effects: [{ kind: 'combat', amount: 6 }, { kind: 'recruitment', amount: 4 }],
      },
      {
        id: 'se_doctrine_fortress',
        title: 'Доктрина «Бастион»',
        desc: 'Ставка на оборону: каждый освобождённый мир превращается в крепость.',
        effects: [{ kind: 'fortify', amount: 8 }, { kind: 'industry', amount: 3 }],
      },
      {
        id: 'se_doctrine_industry',
        title: 'Доктрина «Арсенал»',
        desc: 'Ставка на промышленность: верфи важнее лозунгов.',
        effects: [{ kind: 'industry', amount: 8 }, { kind: 'shipCap', amount: 1 }],
      },
    ],
  },
  {
    slot: 'aut_doctrine',
    faction: 'automatons',
    options: [
      {
        id: 'aut_doctrine_furnace',
        title: 'Протокол «Домна»',
        desc: 'Литейные работают без остановки: сталь льётся быстрее, чем гибнут легионы.',
        effects: [{ kind: 'industry', amount: 8 }],
      },
      {
        id: 'aut_doctrine_swarmlogic',
        title: 'Протокол «Рой машин»',
        desc: 'Численность вместо качества: линии сборки штампуют пехоту.',
        effects: [{ kind: 'recruitment', amount: 9 }],
      },
      {
        id: 'aut_doctrine_precision',
        title: 'Протокол «Точный расчёт»',
        desc: 'Холодная оптимизация огня: меньше залпов, больше попаданий.',
        effects: [{ kind: 'combat', amount: 8 }],
      },
    ],
  },
  {
    slot: 'ill_doctrine',
    faction: 'illuminate',
    options: [
      {
        id: 'ill_doctrine_veil',
        title: 'Путь Пелены',
        desc: 'Разум противника ломается раньше его строя.',
        effects: [{ kind: 'combat', amount: 5 }, { kind: 'politicalPower', amount: 40 }],
      },
      {
        id: 'ill_doctrine_crystal',
        title: 'Путь Кристалла',
        desc: 'Флот растёт из кристаллических верфей быстрее обычного.',
        effects: [{ kind: 'shipCap', amount: 2 }, { kind: 'industry', amount: 4 }],
      },
      {
        id: 'ill_doctrine_harvest',
        title: 'Путь Жатвы',
        desc: 'Покорённое население вливается в ряды Великого Воинства.',
        effects: [{ kind: 'recruitment', amount: 8 }],
      },
    ],
  },
  {
    slot: 'term_doctrine',
    faction: 'terminids',
    options: [
      {
        id: 'term_doctrine_brood',
        title: 'Инстинкт: выводок',
        desc: 'Каждая кладка крупнее прежней.',
        effects: [{ kind: 'recruitment', amount: 10 }],
      },
      {
        id: 'term_doctrine_chitin',
        title: 'Инстинкт: хитин',
        desc: 'Панцирь толще, потери роя ниже.',
        effects: [{ kind: 'fortify', amount: 7 }, { kind: 'combat', amount: 3 }],
      },
      {
        id: 'term_doctrine_spore',
        title: 'Инстинкт: споры',
        desc: 'Мрак стелется впереди роя.',
        effects: [{ kind: 'combat', amount: 6 }, { kind: 'industry', amount: 3 }],
      },
    ],
  },
];

/** Выбрать доктрины партии по сиду (вызывается один раз при создании игры). */
export function rollFocusVariants(state: GameState): void {
  state.focusVariants = {};
  for (const v of FOCUS_VARIANTS) {
    const pick = v.options[Math.floor(state.rng.range(0, v.options.length)) % v.options.length]!;
    state.focusVariants[v.slot] = pick.id;
  }
}

/** Узлы выбранных доктрин — они добавляются в древо как обычные фокусы. */
export function variantNodes(state: GameState, faction: FactionId): FocusNode[] {
  const out: FocusNode[] = [];
  for (const v of FOCUS_VARIANTS) {
    if (v.faction !== faction) continue;
    const chosen = state.focusVariants?.[v.slot];
    const opt = v.options.find((o) => o.id === chosen) ?? v.options[0]!;
    out.push({
      id: v.slot,
      faction,
      title: opt.title,
      desc: opt.desc,
      cost: 60,
      x: 0,
      y: 0,
      requires: [],
      effects: opt.effects,
      branch: 'doctrine',
    });
  }
  return out;
}
