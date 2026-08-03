import type {
  FactionId,
  FactionState,
  Fleet,
  GameSpeed,
  LogEntry,
  Planet,
} from '../core/types';
import { FACTION_IDS, FACTIONS } from '../data/factions';
import { generateGalaxy, type Galaxy } from './galaxy';
import { initUnits } from './troops';
import { RNG } from '../core/rng';

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
  player: FactionId;
  selectedPlanet: string | null;
  selectedFleet: string | null;
  log: LogEntry[];
  superFederationRisen: boolean;
  winner: FactionId | null;
  /** Экзошпили иллюминатов: планета → дней до погружения в Бездну. */
  spires: { planet: string; daysLeft: number }[];
  /** Сектор, выбранный терминидами для распространения Мрака (устарело). */
  gloomTarget: string | null;
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
  /** Заготовки атак игрока: с планеты-плацдарма на смежную вражескую. */
  attackPlans: { from: string; to: string }[];
  /** Перемирия: пары фракций и день, до которого действует мир. */
  truces: { a: FactionId; b: FactionId; until: number }[];
  /** Выполненные цели кампании. */
  doneObjectives: string[];
  /** Ожидающий выбор игрока по сюжетному ивенту. */
  pendingChoice: string | null;
}

function initFaction(id: FactionId): FactionState {
  const units = initUnits(id);
  return {
    id,
    warSupport: 50,
    manpower: Object.values(units).reduce((s, n) => s + n, 0),
    industry: id === 'superEarth' ? 8 : 6,
    production: 0,
    completedFocus: [],
    activeFocus: undefined,
    bonuses: { combat: 0, recruitment: 0, industry: 0, shipCap: 0, fortify: 0 },
    stability: id === 'superEarth' ? 62 : 100,
    specialUnlocked: false,
    lostSpecial: false,
    superShotDay: -100000,
    flags: {},
    units,
    resources: { minerals: 0, e711: 0 },
    politicalPower: id === 'superEarth' ? 30 : 0,
    purchasedBonuses: [],
    alive: true,
  };
}

export function createGame(seed: number): GameState {
  const galaxy = generateGalaxy(seed);
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
    player: 'superEarth',
    selectedPlanet: null,
    selectedFleet: null,
    log: [],
    superFederationRisen: false,
    winner: null,
    spires: [],
    gloomTarget: null,
    gloomSeeds: [],
    lastConqueror: {},
    playerDefeated: false,
    terminidsCapitulated: false,
    firedEvents: [],
    attackPlans: [],
    truces: [],
    doneObjectives: [],
    pendingChoice: null,
  };

  // Seed each active faction with starting fleets at their capital-ish worlds.
  for (const fid of FACTION_IDS) {
    const homeworlds = galaxy.order
      .map((id) => galaxy.planets.get(id)!)
      .filter((p) => p.owner === fid);
    const cap = homeworlds.find((p) => p.isCapital) ?? homeworlds[0];
    if (!cap) continue;
    // Столичный мир каждой фракции начинает с готовой верфью.
    cap.shipyard = { queue: null, stored: { ships: 0, dreadnoughts: 0, battleships: 0 } };
    const isEnemy = fid !== 'superEarth';
    const fleetCount = fid === 'superEarth' ? 3 : 3;
    for (let i = 0; i < fleetCount; i++) {
      const home = homeworlds[(i * 3) % homeworlds.length] ?? cap;
      spawnFleet(state, fid, home.id, {
        ships: (isEnemy ? 9 : 6) + Math.floor(state.rng.range(0, 4)),
        infantry: (isEnemy ? 32 : 20) + Math.floor(state.rng.range(0, 15)),
      });
    }
  }

  pushLog(state, {
    text: 'Галактическая связь установлена. Вторая Галактическая война началась. За Супер-Землю!',
    tone: 'alert',
  });
  return state;
}

export function spawnFleet(
  state: GameState,
  faction: FactionId,
  at: string,
  opts: { ships: number; infantry: number; special?: string; dreadnoughts?: number; battleships?: number }
): Fleet {
  const id = `f_${state.fleetCounter++}`;
  const fleet: Fleet = {
    id,
    faction,
    at,
    ships: opts.ships,
    dreadnoughts: opts.dreadnoughts ?? 0,
    battleships: opts.battleships ?? 0,
    infantry: opts.infantry,
    special: opts.special,
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

