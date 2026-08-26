import type { FactionId, FactionState, Fleet, LogEntry, Planet, SupplyLine } from '../core/types';
import { RNG } from '../core/rng';
import type { Sector } from './galaxy';
import { pairKey, type Relation } from './relations';
import { FACTION_IDS } from '../data/factions';

/** Старые сохранения не знают об отношениях: восстанавливаем всеобщую войну. */
function legacyRelations(): Relation[] {
  const out: Relation[] = [];
  for (let i = 0; i < FACTION_IDS.length; i++) {
    for (let j = i + 1; j < FACTION_IDS.length; j++) {
      const a = FACTION_IDS[i]!;
      const b = FACTION_IDS[j]!;
      void pairKey(a, b);
      out.push({ a, b, value: -80, war: true, warSince: 1 });
    }
  }
  return out;
}
import type { GameState } from './state';

// ---------------------------------------------------------------------------
// Сохранения. Слоты в localStorage; «Автосейв» — постоянный слот, который
// игра пишет сама каждый игровой год (365 дней).
// ---------------------------------------------------------------------------

const PREFIX = 'sgw2_save_';
const PENDING_KEY = 'sgw2_pending_load';
const VERSION = 1;

export const AUTOSAVE_SLOT = 'autosave';
export const MANUAL_SLOTS = ['slot1', 'slot2', 'slot3'] as const;

export interface SaveMeta {
  slot: string;
  name: string;
  day: number;
  savedAt: string;
  version: number;
}

interface SaveBlob {
  meta: SaveMeta;
  seed: number;
  rngS: number;
  day: number;
  /** Скорость партии. В сетевой игре она общая и едет клиентам со срезом. */
  speed?: number;
  player: FactionId;
  factions: Record<FactionId, FactionState>;
  planets: Planet[];
  order: string[];
  lines: SupplyLine[];
  sectors: Sector[];
  radiusMax: number;
  fleets: Fleet[];
  fleetOrder: string[];
  fleetCounter: number;
  log: LogEntry[];
  superFederationRisen: boolean;
  winner: FactionId | null;
  spires: { planet: string; daysLeft: number }[];
  gloomSeeds?: { planet: string; daysLeft: number }[];
  lastConqueror?: Partial<Record<FactionId, FactionId>>;
  playerDefeated?: boolean;
  terminidsCapitulated?: boolean;
  firedEvents?: string[];
  attackPlans?: { from: string; to: string }[];
  truces?: { a: FactionId; b: FactionId; until: number }[];
  doneObjectives?: string[];
  pendingChoice?: string | null;
  pendingChoices?: Partial<Record<FactionId, string>>;
  recons?: { sector: string; until: number }[];
  chronicle?: { day: number; text: string }[];
  history?: { day: number; control: Partial<Record<FactionId, number>> }[];
  modifiers?: string[];
  humans?: FactionId[];
  relations?: Relation[];
  swarmAwake?: boolean;
  subjugated?: Partial<Record<FactionId, FactionId>>;
  puppets?: Partial<Record<FactionId, FactionId>>;
  trophies?: Partial<Record<FactionId, FactionId[]>>;
  focusVariants?: Record<string, string>;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function serializeState(state: GameState, slot: string, name: string): string {
  const blob: SaveBlob = {
    meta: {
      slot,
      name,
      day: state.day,
      savedAt: new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }),
      version: VERSION,
    },
    seed: state.seed,
    rngS: state.rng.dump(),
    day: state.day,
    speed: state.speed,
    player: state.player,
    factions: state.factions,
    planets: state.galaxy.order.map((id) => state.galaxy.planets.get(id)!),
    order: state.galaxy.order,
    lines: state.galaxy.lines,
    sectors: [...state.galaxy.sectors.values()],
    radiusMax: state.galaxy.radiusMax,
    fleets: state.fleetOrder.map((id) => state.fleets.get(id)!).filter(Boolean),
    fleetOrder: state.fleetOrder,
    fleetCounter: state.fleetCounter,
    log: state.log.slice(-200),
    superFederationRisen: state.superFederationRisen,
    winner: state.winner,
    spires: state.spires,
    gloomSeeds: state.gloomSeeds,
    lastConqueror: state.lastConqueror,
    playerDefeated: state.playerDefeated,
    terminidsCapitulated: state.terminidsCapitulated,
    firedEvents: state.firedEvents,
    attackPlans: state.attackPlans,
    truces: state.truces,
    doneObjectives: state.doneObjectives,
    pendingChoices: state.pendingChoices,
    recons: state.recons,
    chronicle: state.chronicle,
    history: state.history,
    modifiers: state.modifiers,
    humans: state.humans,
    relations: state.relations,
    swarmAwake: state.swarmAwake,
    subjugated: state.subjugated,
    puppets: state.puppets,
    trophies: state.trophies,
    focusVariants: state.focusVariants,
  };
  return JSON.stringify(blob);
}

export function deserializeState(json: string): GameState {
  const b = JSON.parse(json) as SaveBlob;
  const rng = new RNG(b.seed);
  rng.restore(b.rngS);
  const planets = new Map(b.planets.map((p) => [p.id, p]));
  const sectors = new Map(b.sectors.map((s) => [s.id, s]));
  // Старые сейвы могли не знать о классах кораблей.
  for (const f of b.fleets) {
    f.dreadnoughts = f.dreadnoughts ?? 0;
    f.battleships = f.battleships ?? 0;
  }
  // …и о политической власти.
  for (const fs of Object.values(b.factions)) {
    fs.politicalPower = fs.politicalPower ?? 0;
    fs.purchasedBonuses = fs.purchasedBonuses ?? [];
    fs.opsUsed = fs.opsUsed ?? {};
  }
  const fleets = new Map(b.fleets.map((f) => [f.id, f]));
  return {
    seed: b.seed,
    rng,
    galaxy: { planets, order: b.order, lines: b.lines, sectors, radiusMax: b.radiusMax },
    factions: b.factions,
    fleets,
    fleetOrder: b.fleetOrder.filter((id) => fleets.has(id)),
    fleetCounter: b.fleetCounter,
    day: b.day,
    // Загруженная из файла партия всё равно получит скорость из настроек
    // (см. startGame), а сетевому срезу она нужна: время у стола общее.
    speed: (b.speed ?? 0) as GameState['speed'],
    player: b.player,
    // Старые сейвы не знают о сетевых партиях: игрок в них ровно один.
    humans: b.humans ?? [b.player],
    // Сейвы до системы отношений: считаем, что война уже идёт у всех со всеми.
    relations: b.relations ?? legacyRelations(),
    swarmAwake: b.swarmAwake ?? true,
    subjugated: b.subjugated ?? {},
    puppets: b.puppets ?? {},
    trophies: b.trophies ?? {},
    focusVariants: b.focusVariants ?? {},
    selectedPlanet: null,
    selectedFleet: null,
    log: b.log,
    superFederationRisen: b.superFederationRisen,
    winner: b.winner,
    spires: b.spires,
    gloomSeeds: b.gloomSeeds ?? [],
    lastConqueror: b.lastConqueror ?? {},
    playerDefeated: b.playerDefeated ?? false,
    terminidsCapitulated: b.terminidsCapitulated ?? false,
    firedEvents: b.firedEvents ?? [],
    attackPlans: b.attackPlans ?? [],
    truces: b.truces ?? [],
    // Старые сохранения хранили цели простыми id — они принадлежали одному
    // игроку партии. Дописываем ему фракцию, иначе награда выдастся заново.
    doneObjectives: (b.doneObjectives ?? []).map((id) => (id.includes(':') ? id : `${b.player}:${id}`)),
    // Старое сохранение знало одну развилку — она принадлежала игроку сейва.
    pendingChoices: b.pendingChoices
      ?? (b.pendingChoice ? { [b.player]: b.pendingChoice } : {}),
    recons: b.recons ?? [],
    chronicle: b.chronicle ?? [],
    history: b.history ?? [],
    modifiers: b.modifiers ?? [],
  };
}

export function saveGame(state: GameState, slot: string, name: string): boolean {
  const st = storage();
  if (!st) return false;
  try {
    st.setItem(PREFIX + slot, serializeState(state, slot, name));
    return true;
  } catch {
    return false;
  }
}

export function readSave(slot: string): string | null {
  return storage()?.getItem(PREFIX + slot) ?? null;
}

export function saveMeta(slot: string): SaveMeta | null {
  const raw = readSave(slot);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as SaveBlob).meta;
  } catch {
    return null;
  }
}

/** Автосейв — каждый игровой год. */
/** Интервал автосейва в игровых днях (настраивается в меню). */
let autosaveDays = 365;
export function setAutosaveDays(days: number): void {
  autosaveDays = Math.max(30, days);
}
export function getAutosaveDays(): number {
  return autosaveDays;
}

export function autosaveTick(state: GameState): void {
  if (state.day > 1 && state.day % autosaveDays === 0) {
    saveGame(state, AUTOSAVE_SLOT, 'Автосейв');
  }
}

/** Запросить загрузку слота: применится после перезапуска сцены (reload). */
export function requestLoad(slot: string): void {
  storage()?.setItem(PENDING_KEY, slot);
}

export function takePendingLoad(): string | null {
  const st = storage();
  if (!st) return null;
  const slot = st.getItem(PENDING_KEY);
  if (slot) st.removeItem(PENDING_KEY);
  return slot;
}
