import type { FactionId, FactionState, Fleet, LogEntry, Planet, SupplyLine } from '../core/types';
import { RNG } from '../core/rng';
import type { Sector } from './galaxy';
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
  gloomTarget: string | null;
  gloomSeeds?: { planet: string; daysLeft: number }[];
  lastConqueror?: Partial<Record<FactionId, FactionId>>;
  playerDefeated?: boolean;
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
    gloomTarget: state.gloomTarget,
    gloomSeeds: state.gloomSeeds,
    lastConqueror: state.lastConqueror,
    playerDefeated: state.playerDefeated,
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
    speed: 0,
    player: b.player,
    selectedPlanet: null,
    selectedFleet: null,
    log: b.log,
    superFederationRisen: b.superFederationRisen,
    winner: b.winner,
    spires: b.spires,
    gloomTarget: b.gloomTarget,
    gloomSeeds: b.gloomSeeds ?? [],
    lastConqueror: b.lastConqueror ?? {},
    playerDefeated: b.playerDefeated ?? false,
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
export function autosaveTick(state: GameState): void {
  if (state.day > 1 && state.day % 365 === 0) {
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
