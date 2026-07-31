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
  | 'gas';

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
  /** Infantry troops carried aboard, deployable to planets. */
  infantry: number;
  /** If set, this fleet carries the faction's special unit. */
  special?: string;
  /** Player/AI order the fleet is executing. */
  order?: FleetOrder;
}

export type FleetOrder =
  | { kind: 'idle' }
  | { kind: 'move'; target: string }
  | { kind: 'invade'; target: string }
  | { kind: 'reinforce'; target: string };

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
  | { kind: 'custom'; note: string };

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
  gate?: 'lowStability';
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
  alive: boolean;
}

export type GameSpeed = 0 | 1 | 2 | 3;

export interface LogEntry {
  day: number;
  faction?: FactionId;
  text: string;
  tone: 'info' | 'good' | 'bad' | 'alert';
}
