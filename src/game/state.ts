import type {
  FactionId,
  FactionState,
  Fleet,
  GameSpeed,
  LogEntry,
  Planet,
} from '../core/types';
import { FACTION_IDS, FACTIONS } from '../data/factions';
import { GALAXY_MODIFIERS } from '../data/modifiers';
import { generateGalaxy, type Galaxy } from './galaxy';
import { DEFAULT_SHAPE, type GalaxyShape } from './galaxyShapes';
import { initUnits } from './troops';
import { TRANSPORT_LIFT } from '../data/troops';
import { RNG } from '../core/rng';
import { initRelations, type Relation } from './relations';
import { rollFocusVariants } from './trophies';

export interface GameState {
  seed: number;
  rng: RNG;
  galaxy: Galaxy;
  factions: Record<FactionId, FactionState>;
  fleets: Map<string, Fleet>;
  fleetOrder: string[];
  fleetCounter: number;
  day: number;
  speed: GameSpeed;
  /**
   * Фракция, глазами которой смотрит ЭТОТ экран: чьи панели рисуются, чей
   * туман войны, чьи приказы отдаёт мышь. В сетевой партии у каждого
   * участника она своя, состояние при этом общее.
   */
  player: FactionId;
  /**
   * Все фракции под управлением людей. ИИ не трогает их: в сетевой партии
   * это список занятых мест, в одиночной — ровно один игрок.
   */
  humans: FactionId[];
  selectedPlanet: string | null;
  selectedFleet: string | null;
  log: LogEntry[];
  superFederationRisen: boolean;
  winner: FactionId | null;
  /** Экзошпили иллюминатов: планета → дней до погружения в Бездну. */
  spires: { planet: string; daysLeft: number }[];
  /** Зреющие зачатки Мрака: планета → дней до окутывания. */
  gloomSeeds: { planet: string; daysLeft: number }[];
  /** Кто последним отнимал планету у фракции — для сводки о поражении. */
  lastConqueror: Partial<Record<FactionId, FactionId>>;
  /** Игрок выбыл, но наблюдает за продолжением войны. */
  playerDefeated: boolean;
  /** Терминиды загнаны на 1–2 мира и капитулировали перед Супер-Землёй. */
  terminidsCapitulated: boolean;
  /** Идентификаторы уже случившихся ивентов таймлайна. */
  firedEvents: string[];
  /**
   * Заготовки атак: с планеты-плацдарма на смежную вражескую. Хранят фракцию,
   * потому что в сетевой партии плацдармы у каждого свои.
   */
  attackPlans: { from: string; to: string; faction?: FactionId }[];
  /** Перемирия: пары фракций и день, до которого действует мир. */
  truces: { a: FactionId; b: FactionId; until: number }[];
  /** Выполненные цели кампании. */
  doneObjectives: string[];
  /**
   * Ожидающие развилки сюжетных ивентов — ПО ФРАКЦИЯМ. За одним столом сидят
   * несколько человек, и вопрос, заданный автоматонам, показывать иллюминатам
   * бессмысленно: у каждого экрана своя строка в этой записи.
   */
  pendingChoices: Partial<Record<FactionId, string>>;
  /** Активные разведоперации: сектор просматривается до указанного дня. */
  recons: { sector: string; until: number }[];
  /** Летопись войны: ключевые вехи (капитуляции, столицы, супероружие…). */
  chronicle: { day: number; text: string }[];
  /** История контроля: снапшоты числа планет по фракциям (раз в 30 дней). */
  history: { day: number; control: Partial<Record<FactionId, number>> }[];
  /** Галактические модификаторы партии (id из GALAXY_MODIFIERS). */
  modifiers: string[];
  /** Отношения между парами фракций: симпатия и состояние войны. */
  relations: Relation[];
  /** Рой проснулся: терминиды вступили в войну и мира уже не заключат. */
  swarmAwake: boolean;
  /** Чья столица пала и кому: порабощённый → поработитель. */
  subjugated: Partial<Record<FactionId, FactionId>>;
  /** Марионетки: вассал → сюзерен-освободитель. */
  puppets: Partial<Record<FactionId, FactionId>>;
  /** Трофейные технологии: победитель → список покорённых им фракций. */
  trophies: Partial<Record<FactionId, FactionId[]>>;
  /** Выбранные в этой партии варианты узлов древа фокусов. */
  focusVariants: Record<string, string>;
}

function initFaction(id: FactionId): FactionState {
  const units = initUnits(id);
  return {
    id,
    warSupport: 50,
    manpower: Object.values(units).reduce((s, n) => s + n, 0),
    // Промбаза врагов выше: у них мало миров, и весь их вес — в ядре державы.
    industry: id === 'superEarth' ? 8 : 11,
    // Стартовая казна. Супер-Земля живёт с двухсот планет и копить ей незачем,
    // а вот у остальных без начального запаса первые полсотни дней уходили
    // впустую: ни верфи, ни щита, ни дивизии.
    production: id === 'superEarth' ? 0 : 220,
    completedFocus: [],
    activeFocus: undefined,
    bonuses: { combat: 0, recruitment: 0, industry: 0, shipCap: 0, fortify: 0 },
    stability: id === 'superEarth' ? 62 : 100,
    specialUnlocked: false,
    lostSpecial: false,
    superShotDay: -100000,
    flags: {},
    units,
    resources: { minerals: id === 'superEarth' ? 0 : 60, e711: 0 },
    politicalPower: id === 'superEarth' ? 30 : 0,
    purchasedBonuses: [],
    opsUsed: {},
    alive: true,
  };
}

export function createGame(
  seed: number,
  player: FactionId = 'superEarth',
  shape: GalaxyShape = DEFAULT_SHAPE,
): GameState {
  const galaxy = generateGalaxy(seed, shape);
  const factions = {} as Record<FactionId, FactionState>;
  for (const id of Object.keys(FACTIONS) as FactionId[]) factions[id] = initFaction(id);

  const state: GameState = {
    seed,
    rng: new RNG(seed ^ 0x9e3779b9),
    galaxy,
    factions,
    fleets: new Map(),
    fleetOrder: [],
    fleetCounter: 0,
    day: 1,
    speed: 0,
    player,
    humans: [player],
    selectedPlanet: null,
    selectedFleet: null,
    log: [],
    superFederationRisen: false,
    winner: null,
    spires: [],
    gloomSeeds: [],
    lastConqueror: {},
    playerDefeated: false,
    terminidsCapitulated: false,
    firedEvents: [],
    attackPlans: [],
    truces: [],
    doneObjectives: [],
    pendingChoices: {},
    recons: [],
    chronicle: [],
    history: [],
    modifiers: [],
    relations: [],
    swarmAwake: false,
    subjugated: {},
    puppets: {},
    trophies: {},
    focusVariants: {},
  };

  // Seed each active faction with starting fleets at their capital-ish worlds.
  for (const fid of FACTION_IDS) {
    const homeworlds = galaxy.order
      .map((id) => galaxy.planets.get(id)!)
      .filter((p) => p.owner === fid);
    const cap = homeworlds.find((p) => p.isCapital) ?? homeworlds[0];
    if (!cap) continue;
    // Столичный мир каждой фракции начинает с готовой верфью.
    cap.shipyard = { queue: null, stored: { ships: 0, dreadnoughts: 0, battleships: 0, transports: 0 } };
    const isEnemy = fid !== 'superEarth';
    const fleetCount = fid === 'superEarth' ? 3 : 3;
    for (let i = 0; i < fleetCount; i++) {
      const home = homeworlds[(i * 3) % homeworlds.length] ?? cap;
      const infantry = (isEnemy ? 32 : 20) + Math.floor(state.rng.range(0, 15));
      spawnFleet(state, fid, home.id, {
        ships: (isEnemy ? 9 : 6) + Math.floor(state.rng.range(0, 4)),
        infantry,
        // Стартовые соединения Супер-Земли укомплектованы транспортами под
        // весь свой десант: доктрина ВССЗ работает с первого дня войны.
        transports: fid === 'superEarth' ? Math.ceil(infantry / TRANSPORT_LIFT) : 0,
      });
    }
  }

  // Стартовый запас политической власти — выбранной фракции игрока.
  state.factions[player].politicalPower = Math.max(state.factions[player].politicalPower, 30);

  // Партия начинается в мире: у каждой пары фракций своя стартовая симпатия.
  initRelations(state);
  // Доктрины партии: у каждой фракции свой вариант ключевого узла древа.
  rollFocusVariants(state);

  // Условия кампании: два случайных галактических модификатора по сиду.
  const pool = [...GALAXY_MODIFIERS];
  state.rng.shuffle(pool);
  state.modifiers = pool.slice(0, 2).map((m) => m.id);

  pushLog(state, {
    text: `Галактическая связь установлена. Вторая Галактическая война началась. Вы ведёте фракцию «${FACTIONS[player].name}».`,
    tone: 'alert',
  });
  for (const id of state.modifiers) {
    const m = GALAXY_MODIFIERS.find((g) => g.id === id)!;
    pushLog(state, { text: `Условие кампании — «${m.name}»: ${m.desc}`, tone: 'info' });
  }
  return state;
}

/** Действует ли галактический модификатор в этой партии. */
export function modActive(state: GameState, id: string): boolean {
  return state.modifiers.includes(id);
}

export function spawnFleet(
  state: GameState,
  faction: FactionId,
  at: string,
  opts: { ships: number; infantry: number; special?: string; dreadnoughts?: number; battleships?: number; transports?: number }
): Fleet {
  const id = `f_${state.fleetCounter++}`;
  const fleet: Fleet = {
    id,
    faction,
    at,
    ships: opts.ships,
    dreadnoughts: opts.dreadnoughts ?? 0,
    battleships: opts.battleships ?? 0,
    transports: opts.transports ?? 0,
    infantry: opts.infantry,
    special: opts.special,
    // Штат соединения — его состав при рождении. Без этого пополнение из
    // резерва не работало бы для стартовых и автосборных групп: им просто
    // нечего было бы догонять.
    establishment: {
      ships: Math.round(opts.ships),
      dreadnoughts: Math.round(opts.dreadnoughts ?? 0),
      battleships: Math.round(opts.battleships ?? 0),
      transports: Math.round(opts.transports ?? 0),
    },
    order: { kind: 'idle' },
  };
  state.fleets.set(id, fleet);
  state.fleetOrder.push(id);
  return fleet;
}

export function removeFleet(state: GameState, id: string): void {
  state.fleets.delete(id);
  const i = state.fleetOrder.indexOf(id);
  if (i >= 0) state.fleetOrder.splice(i, 1);
  if (state.selectedFleet === id) state.selectedFleet = null;
}

export function pushLog(state: GameState, entry: Omit<LogEntry, 'day'>): void {
  const e: LogEntry = { day: state.day, ...entry };
  state.log.push(e);
  if (state.log.length > 400) state.log.shift();
}

/** Веха в летопись войны (журнал 📜 помнит всё, в отличие от лога). */
export function pushChronicle(state: GameState, text: string): void {
  state.chronicle.push({ day: state.day, text });
}

/** Снапшот контроля галактики для графика журнала войны. */
export function snapshotControl(state: GameState): void {
  const control: Partial<Record<FactionId, number>> = {};
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    if (p.shattered || p.abyss) continue;
    control[p.owner] = (control[p.owner] ?? 0) + 1;
  }
  state.history.push({ day: state.day, control });
}

export function planetsOf(state: GameState, faction: FactionId): Planet[] {
  // Поля обломков никому не принадлежат и территорией не считаются.
  return state.galaxy.order
    .map((id) => state.galaxy.planets.get(id)!)
    .filter((p) => p.owner === faction && !p.shattered);
}

export function fleetsAt(state: GameState, planetId: string): Fleet[] {
  return state.fleetOrder
    .map((id) => state.fleets.get(id)!)
    .filter((f) => f && f.at === planetId && !f.transit);
}

export function fleetsOf(state: GameState, faction: FactionId): Fleet[] {
  return state.fleetOrder
    .map((id) => state.fleets.get(id)!)
    .filter((f) => f && f.faction === faction);
}


/**
 * Потолок числа соединений у фракции. Живёт здесь, а не в ai.ts: его читают и
 * верфи, и редактор соединений, и сам ИИ, — а держать общий предел в модуле
 * ИИ означало бы кольцо импортов «верфи ↔ ИИ».
 */
export function fleetCap(state: GameState, faction: FactionId): number {
  const base = faction === 'superEarth' ? 7 : 5;
  return base + state.factions[faction].bonuses.shipCap;
}

/**
 * Выбывший игрок берёт другую сторону.
 *
 * Поражение раньше означало «смотрите, чем всё кончится»: игрок оставался
 * наблюдателем до конца партии, иногда на несколько игровых лет. Теперь
 * разгром — не выход из игры, а смена шинели: место в списке людей
 * освобождается за павшей фракцией и занимается за новой.
 *
 * Правила жёсткие и очевидные: перейти можно ТОЛЬКО из мёртвой фракции и
 * ТОЛЬКО в живую, за которой не сидит другой человек. Иначе это была бы
 * не смена стороны, а способ бросить проигранную позицию — или отобрать
 * фракцию у соседа по столу.
 */
export function takeOverFaction(state: GameState, from: FactionId, to: FactionId): boolean {
  if (from === to) return false;
  const old = state.factions[from];
  const next = state.factions[to];
  if (!old || !next) return false;
  // Уходить можно только с погибшей стороны.
  if (old.alive && planetsOf(state, from).length > 0) return false;
  if (!next.alive || planetsOf(state, to).length === 0) return false;
  // Занятое место не отнимают.
  if (state.humans.includes(to)) return false;

  state.humans = state.humans.filter((f) => f !== from).concat(to);
  // Экран смотрит новой стороной только у того, кто перешёл; в сетевой партии
  // остальные видят свои — их `player` задаётся локально и снапшотом не едет.
  if (state.player === from) {
    state.player = to;
    state.playerDefeated = false;
    state.selectedFleet = null;
    state.selectedPlanet = null;
  }
  pushLog(state, {
    faction: to,
    text: `Командование переходит к новой стороне: «${FACTIONS[from].name}» пала, война продолжается за «${FACTIONS[to].name}».`,
    tone: 'alert',
  });
  pushChronicle(state, `Выбывший игрок принимает командование фракцией «${FACTIONS[to].name}».`);
  return true;
}

/** Живые стороны, за которые может встать выбывший игрок. */
export function availableSides(state: GameState, forPlayer: FactionId): FactionId[] {
  return (Object.keys(state.factions) as FactionId[]).filter((f) =>
    f !== forPlayer && state.factions[f].alive &&
    planetsOf(state, f).length > 0 && !state.humans.includes(f) &&
    (f !== 'superFederation' || state.superFederationRisen));
}

/** Управляет ли фракцией живой игрок (в одиночной партии — только свой). */
export function isHuman(state: GameState, faction: FactionId): boolean {
  return state.humans ? state.humans.includes(faction) : faction === state.player;
}
