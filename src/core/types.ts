// ---------------------------------------------------------------------------
// Shared domain types for The Second Galactic War.
// ---------------------------------------------------------------------------

export type FactionId =
  | 'superEarth'
  | 'automatons'
  | 'illuminate'
  | 'terminids'
  | 'superFederation';

/** Visual / gameplay biome of a planet. Drives the procedural sphere shader. */
export type BiomeId =
  | 'terran'
  | 'ocean'
  | 'desert'
  | 'ice'
  | 'volcanic'
  | 'jungle'
  | 'gloom'
  | 'barren'
  | 'toxic'
  | 'gas'
  | 'magma';

export type UnitKind = 'ship' | 'infantry' | 'special';

export interface FactionDef {
  id: FactionId;
  name: string;
  short: string;
  /** Primary CSS/three colour, hex string. */
  color: string;
  /** Secondary accent colour. */
  accent: string;
  blurb: string;
  capital: string;
  /** Base combat multiplier for this faction's forces. */
  aggression: number;
  /** Name shown for this faction's unique special unit. */
  specialName: string;
  specialBlurb: string;
  /** Preferred biomes when seeding home territory. */
  homeBiomes: BiomeId[];
  playable: boolean;
  /** Hidden factions do not appear until spawned by an event. */
  hidden?: boolean;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Planet {
  id: string;
  name: string;
  biome: BiomeId;
  sector: string;
  /** Polar coordinates on the galactic disc. */
  radius: number;
  angle: number;
  /** Cartesian position on the disc plane (world units). */
  pos: Vec2;
  /** Relative planet size 0.6..1.6. */
  scale: number;
  /** Unique seed driving this planet's procedural surface. */
  seed: number;
  owner: FactionId;
  /** Faction that originally owned the planet (for lore / recapture). */
  origin: FactionId;
  isCapital: boolean;
  /** Ids of planets reachable via a direct supply line. */
  links: string[];
  /** Ground defenders currently holding the planet. */
  garrison: number;
  /** Fortification level 0..5, raised by focuses / time. */
  fortification: number;
  /** Special structure built here, if any (id of the special unit). */
  special?: string;
  /** Active planetary battle, if the planet is contested. */
  battle?: PlanetBattle;
  /** Strategic value — production + score weight. */
  value: number;
  /** Города на планете (если есть) — контроль над ними ускоряет захват. */
  cities: City[];
  /** Построена ли точка снабжения. */
  depot: boolean;
  /** Есть ли связь с ядром территории владельца (пересчитывается ежедневно). */
  supplied: boolean;
  /** Планета окутана Мраком терминидов. */
  gloom: boolean;
  /** Планета погружена в Бездну иллюминатов. */
  abyss: boolean;
  /** Богатство ископаемыми (платина, ценные металлы): 0 — нет, 1 — есть, 2 — богатая. */
  minerals: number;
  /** Построенные сооружения (точки снабжения учитываются отдельно флагом depot). */
  buildings: string[];
  /** Богатые залежи Е-711 — остаются после освобождения мира из Мрака. */
  e711Rich: boolean;
  /** Планета уничтожена орбитальным залпом супероружия — осталось поле обломков. */
  shattered: boolean;
  /** Обломки погибших кораблей на орбите (корпусов; тают со временем). */
  wreckage?: number;
  /** Шрамы долгой битвы: выжженные пятна на поверхности (навсегда). */
  scarred?: boolean;
  /** Верфь: строит корабли по приказу игрока и складирует их до передачи флоту. */
  shipyard?: Shipyard;
  /** Мир-марионетка: владелец капитулировал и подчинён этой фракции. */
  puppetOf?: FactionId;
}

export interface Shipyard {
  /** Текущий заказ на стапеле (одновременно строится один корабль). */
  queue: { cls: string; daysLeft: number } | null;
  /** Повторять заказ автоматически, пока хватает ресурсов. */
  repeat?: string;
  /** Готовые корпуса, ожидающие передачи соединению. */
  stored: { ships: number; dreadnoughts: number; battleships: number };
}

export interface City {
  name: string;
  holder: FactionId;
  /** Специализация: верфь (стройка быстрее), академия (пополнение), шахта (руда). */
  spec?: 'yard' | 'academy' | 'mine';
}

export interface SupplyLine {
  a: string;
  b: string;
}

/** A mobile fleet: the "ship" troop type. Carries infantry between planets. */
export interface Fleet {
  id: string;
  faction: FactionId;
  /** Planet id the fleet is currently docked at (empty while in transit). */
  at: string;
  /** In-transit route, if moving. */
  transit?: {
    from: string;
    to: string;
    /** Full path of planet ids along supply lines. */
    path: string[];
    /** 0..1 progress along the current edge. */
    progress: number;
    legIndex: number;
  };
  /** Ships in the fleet — its space-combat strength. */
  ships: number;
  /** Дредноуты (тяжёлый класс, сила ×3 за корпус). */
  dreadnoughts: number;
  /** Линкоры-флагманы (сила ×6 за корпус). */
  battleships: number;
  /** Infantry troops carried aboard, deployable to planets. */
  infantry: number;
  /** If set, this fleet carries the faction's special unit. */
  special?: string;
  /** Планета-плацдарм, с которой флот начал вторжение (снабжение атаки). */
  origin?: string;
  /** Назначенный командир соединения (id из списка COMMANDERS). */
  commander?: string;
  /** Боевой опыт соединения — растёт в сражениях, даёт ранги и бонусы. */
  xp?: number;
  /** Очередь приказов: цели, к которым флот пойдёт после текущего приказа. */
  orderQueue?: { target: string }[];
  /** Player/AI order the fleet is executing. */
  order?: FleetOrder;
}

export type FleetOrder =
  | { kind: 'idle' }
  | { kind: 'move'; target: string }
  | { kind: 'invade'; target: string }
  | { kind: 'reinforce'; target: string };

/** Фазы наземной операции: высадка → плацдарм → генеральный штурм. */
export type BattlePhase = 'landing' | 'foothold' | 'assault';

export interface PlanetBattle {
  attacker: FactionId;
  defender: FactionId;
  /** Attacking ground strength committed. */
  attackerForce: number;
  /** Defending ground strength. */
  defenderForce: number;
  /** 0..100 — when it reaches 100 the planet flips to the attacker. */
  liberation: number;
  /** Days the battle has raged. */
  days: number;
  /** Текущая фаза операции (выводится из liberation, хранится для UI). */
  phase?: BattlePhase;
  /** Высаженный на поверхность десант атакующего: дерётся даже без флота. */
  landed?: number;
}

export interface SpecialUnitDef {
  id: string;
  faction: FactionId;
  name: string;
  blurb: string;
  /** Combat multiplier granted while present. */
  power: number;
  /** Passive daily effect radius (supply hops). */
  auraRange: number;
}

// --- Focus trees -----------------------------------------------------------

export type FocusEffect =
  | { kind: 'warSupport'; amount: number }
  | { kind: 'recruitment'; amount: number }
  | { kind: 'industry'; amount: number }
  | { kind: 'shipCap'; amount: number }
  | { kind: 'combat'; amount: number }
  | { kind: 'fortify'; amount: number }
  | { kind: 'stability'; amount: number }
  | { kind: 'manpower'; amount: number }
  | { kind: 'fleet'; ships: number; infantry: number }
  | { kind: 'unlockSpecial' }
  | { kind: 'spawnSuperFederation' }
  | { kind: 'arkArrival' }
  | { kind: 'flag'; flag: FactionFlag }
  | { kind: 'custom'; note: string }
  // --- уникальные разовые эффекты (раунд 39) ---
  /** Мгновенные очки производства. */
  | { kind: 'production'; amount: number }
  /** Мгновенная политическая власть. */
  | { kind: 'politicalPower'; amount: number }
  /** Стратегические ресурсы разом. */
  | { kind: 'resources'; minerals: number; e711: number }
  /** +N гарнизона на всех своих мирах. */
  | { kind: 'garrisonAll'; amount: number }
  /** +N укреплений (до максимума 5) на всех своих мирах. */
  | { kind: 'fortifyAll'; amount: number }
  /** Боевой опыт всем соединениям фракции. */
  | { kind: 'xpAll'; amount: number }
  /** Разведать все сектора галактики на N дней. */
  | { kind: 'revealAll'; days: number }
  /** Перемирие со всеми живыми фракциями на N дней. */
  | { kind: 'truceAll'; days: number }
  /** Вернуть исконным владельцам до N завоёванных миров: мир в обмен на землю. */
  | { kind: 'returnTerritory'; count: number }
  /** Бесплатные щит и орбитальная станция на N ценнейших мирах. */
  | { kind: 'freeDefenses'; count: number }
  /** Пространственный сдвиг: все флоты мгновенно возвращаются к столице. */
  | { kind: 'recallFleets' }
  /** Все зреющие зачатки Мрака созревают немедленно. */
  | { kind: 'gloomSurge' }
  /** Тяжёлое соединение с дредноутами и линкорами. */
  | { kind: 'heavyFleet'; ships: number; dreadnoughts: number; battleships: number; infantry: number };

/** Особые способности, открываемые фокусами-спецпроектами. */
export type FactionFlag = 'gloomTravel' | 'gloomSpread' | 'abyss' | 'e711Mining' | 'termicide' | 'arkPrepared' | 'arkGhost' | 'arkDone';

export interface FocusNode {
  id: string;
  faction: FactionId;
  title: string;
  desc: string;
  /** Days of focus effort to complete. */
  cost: number;
  /** Grid position for the tree layout. */
  x: number;
  y: number;
  /** Prerequisite focus ids (all required). */
  requires: string[];
  effects: FocusEffect[];
  /** Optional gate: only selectable when this predicate passes. */
  gate?: 'lowStability' | 'cyberstanLost' | 'arkReady';
  /** Branch tag for grouping (e.g. 'federation'). */
  branch?: string;
}

// --- Faction runtime economy ----------------------------------------------

export interface FactionState {
  id: FactionId;
  /** War support / political capital, 0..100. */
  warSupport: number;
  /** Manpower reserve used to raise infantry. */
  manpower: number;
  /** Industrial output — accumulates into ships & infantry. */
  industry: number;
  /** Stockpiled production points. */
  production: number;
  /** Completed focus ids. */
  completedFocus: string[];
  /** Focus currently being worked, with remaining days. */
  activeFocus?: { id: string; remaining: number };
  /** Bonuses accumulated from focuses. */
  bonuses: {
    combat: number;
    recruitment: number;
    industry: number;
    shipCap: number;
    fortify: number;
  };
  /** Super Earth only: political stability 0..100. */
  stability: number;
  /** Whether the special unit has been unlocked. */
  specialUnlocked: boolean;
  /** Супероружие было уничтожено — восстановление стоит очень дорого. */
  lostSpecial: boolean;
  /** День последнего планетарного залпа супероружия (перезарядка 1000 дней). */
  superShotDay: number;
  /** Открытые спецспособности (Мрак, Бездна и т.п.). */
  flags: Partial<Record<FactionFlag, boolean>>;
  /** Пулы наземных войск по типам (id типа → численность). */
  units: Record<string, number>;
  /** Стратегические ресурсы фракции. */
  resources: { minerals: number; e711: number };
  /** Политическая власть — копится ежедневно, тратится на бонусы в досье. */
  politicalPower: number;
  /** Купленные политические бонусы (id, повторные покупки — повторные записи). */
  purchasedBonuses: string[];
  /** Спецоперации: id операции → день последнего применения (для кулдаунов). */
  opsUsed: Partial<Record<string, number>>;
  /** Текущий стратегический план ИИ фракции. */
  aiPlan?: AiPlan;
  alive: boolean;
}

/** Стратегические планы ИИ: не «хватать всё подряд», а вести кампанию. */
export interface AiPlan {
  goal: 'superweaponSite' | 'harvest' | 'swarmSector' | 'consolidate' | 'defense';
  /** Планета-цель плана (если есть). */
  target: string | null;
  /** Человекочитаемое описание — для журнала и отладки. */
  note: string;
}

export type GameSpeed = 0 | 1 | 2 | 3;

export interface LogEntry {
  day: number;
  faction?: FactionId;
  text: string;
  tone: 'info' | 'good' | 'bad' | 'alert';
}
