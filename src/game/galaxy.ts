import type { BiomeId, FactionId, Planet, SupplyLine, Vec2 } from '../core/types';
import { RNG } from '../core/rng';
import { FACTIONS } from '../data/factions';
import { planetName, sectorName } from './names';

export interface Sector {
  id: string;
  name: string;
  ring: number;
  bucket: number;
  planets: string[];
  /** Annulus-sector geometry for map rendering (world units / radians). */
  r0: number;
  r1: number;
  a0: number;
  a1: number;
}

export interface Galaxy {
  planets: Map<string, Planet>;
  order: string[]; // stable planet id ordering
  lines: SupplyLine[];
  sectors: Map<string, Sector>;
  radiusMax: number;
}

const RING_COUNT = 6;
const RING_SPACING = 95;
const PLANETS_PER_RING = [8, 12, 16, 20, 24, 28];
// Angular home wedges (radians). Center is Super Earth; enemies own outer wedges.
const WEDGES: { faction: FactionId; from: number; to: number }[] = [
  { faction: 'automatons', from: deg(105), to: deg(165) },
  { faction: 'terminids', from: deg(-35), to: deg(35) },
  { faction: 'illuminate', from: deg(215), to: deg(300) },
];

function deg(d: number): number {
  return (d * Math.PI) / 180;
}

function norm(a: number): number {
  let x = a % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x;
}

function inWedge(angle: number, from: number, to: number): boolean {
  const a = norm(angle);
  const f = norm(from);
  const t = norm(to);
  if (f <= t) return a >= f && a <= t;
  return a >= f || a <= t;
}

function biomeFor(faction: FactionId, rng: RNG): BiomeId {
  const home = FACTIONS[faction].homeBiomes;
  // Mostly home biomes, with occasional variety.
  if (rng.chance(0.7)) return rng.pick(home);
  const all: BiomeId[] = ['terran', 'ocean', 'desert', 'ice', 'volcanic', 'jungle', 'gloom', 'barren', 'toxic', 'gas'];
  return rng.pick(all);
}

export function generateGalaxy(seed: number): Galaxy {
  const rng = new RNG(seed);
  const planets = new Map<string, Planet>();
  const order: string[] = [];
  const sectors = new Map<string, Sector>();
  const used = new Set<string>();
  let idCounter = 0;

  const addPlanet = (p: Planet) => {
    planets.set(p.id, p);
    order.push(p.id);
  };

  // --- Center: Super Earth capital ---
  addPlanet({
    id: 'p_super_earth',
    name: 'Супер-Земля',
    biome: 'terran',
    sector: 'Сектор Сол',
    radius: 0,
    angle: 0,
    pos: { x: 0, y: 0 },
    scale: 1.6,
    seed: rng.int(0, 999_999),
    owner: 'superEarth',
    origin: 'superEarth',
    isCapital: true,
    links: [],
    garrison: 120,
    fortification: 5,
    value: 10,
  });
  sectors.set('sector_core', {
    id: 'sector_core',
    name: 'Сектор Сол',
    ring: 0,
    bucket: 0,
    planets: ['p_super_earth'],
    r0: 0,
    r1: RING_SPACING * 0.55,
    a0: 0,
    a1: Math.PI * 2,
  });

  // --- Rings ---
  for (let ring = 1; ring <= RING_COUNT; ring++) {
    const count = PLANETS_PER_RING[ring - 1]!;
    const baseR = ring * RING_SPACING;
    const buckets = Math.max(3, Math.round(count / 3));
    for (let j = 0; j < count; j++) {
      const angle = (Math.PI * 2 * j) / count + rng.range(-0.1, 0.1);
      const r = baseR + rng.range(-18, 18);
      const pos: Vec2 = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };

      // Ownership: inner rings mostly Super Earth; outer rings by wedge.
      let owner: FactionId = 'superEarth';
      if (ring >= 2) {
        for (const w of WEDGES) {
          if (inWedge(angle, w.from, w.to)) {
            owner = w.faction;
            break;
          }
        }
      }

      const bucket = Math.min(buckets - 1, Math.floor((norm(angle) / (Math.PI * 2)) * buckets));
      const sectorId = `sector_${ring}_${bucket}`;
      if (!sectors.has(sectorId)) {
        sectors.set(sectorId, {
          id: sectorId,
          name: sectorName(rng),
          ring,
          bucket,
          planets: [],
          r0: baseR - RING_SPACING / 2 + 8,
          r1: baseR + RING_SPACING / 2 - 8,
          a0: (Math.PI * 2 * bucket) / buckets,
          a1: (Math.PI * 2 * (bucket + 1)) / buckets,
        });
      }
      const sector = sectors.get(sectorId)!;

      const id = `p_${idCounter++}`;
      addPlanet({
        id,
        name: planetName(rng, used),
        biome: biomeFor(owner, rng),
        sector: sector.name,
        radius: r,
        angle,
        pos,
        scale: rng.range(0.7, 1.25),
        seed: rng.int(0, 999_999),
        owner,
        origin: owner,
        isCapital: false,
        links: [],
        garrison: owner === 'superEarth' ? rng.int(15, 35) : rng.int(25, 55),
        fortification: rng.int(0, 2),
        value: rng.int(1, 5),
      });
      sector.planets.push(id);
    }
  }

  // --- Faction capitals ---
  // Super Earth sits at the galactic centre. Automatons (Cyberstan) and the
  // Illuminate (Squ'bai Shrine) hold true capitals in their FAR outer sectors —
  // capturing one breaks the faction. The Terminids have no capital: Kepler
  // Prime is merely the strongest hive, and the swarm must be exterminated
  // world by world.
  const capitalNames: Partial<Record<FactionId, string>> = {
    automatons: 'Киберстан',
    illuminate: "Святилище Скв'бай",
  };
  for (const w of WEDGES) {
    const candidates = order
      .map((id) => planets.get(id)!)
      .filter((p) => p.owner === w.faction && p.radius > RING_SPACING * 2.5);
    if (!candidates.length) continue;
    const strongest = candidates.reduce((a, b) => (b.radius > a.radius ? b : a));
    if (w.faction === 'terminids') {
      // Hive heart — powerful, but NOT a capital. No head to cut off.
      strongest.name = 'Кеплер Прайм';
      strongest.scale = 1.3;
      strongest.garrison = 90;
      strongest.fortification = 4;
      strongest.value = 8;
    } else {
      strongest.isCapital = true;
      strongest.name = capitalNames[w.faction] ?? strongest.name;
      strongest.scale = 1.4;
      strongest.garrison = 100;
      strongest.fortification = 5;
      strongest.value = 10;
    }
  }

  // --- Supply lines: relative neighbourhood graph (true neighbours only) ---
  buildSupplyLines(planets, order);

  const radiusMax = RING_COUNT * RING_SPACING + 30;
  return { planets, order, lines: collectLines(planets, order), sectors, radiusMax };
}

function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Relative neighbourhood graph: planets A and B are linked only when no third
 * planet C sits "between" them (closer to both than they are to each other).
 * This removes exactly the A—C shortcut when B lies on the way, so every line
 * connects true neighbours. The RNG always contains the minimum spanning tree,
 * so the map stays fully connected by construction.
 */
function buildSupplyLines(planets: Map<string, Planet>, order: string[]): void {
  const arr = order.map((id) => planets.get(id)!);
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i]!;
      const b = arr[j]!;
      const dab = dist2(a.pos, b.pos);
      let blocked = false;
      for (let k = 0; k < arr.length; k++) {
        if (k === i || k === j) continue;
        const c = arr[k]!;
        if (dist2(a.pos, c.pos) < dab && dist2(b.pos, c.pos) < dab) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        a.links.push(b.id);
        b.links.push(a.id);
      }
    }
  }
}

function collectLines(planets: Map<string, Planet>, order: string[]): SupplyLine[] {
  const seen = new Set<string>();
  const lines: SupplyLine[] = [];
  for (const id of order) {
    const p = planets.get(id)!;
    for (const l of p.links) {
      const key = id < l ? `${id}|${l}` : `${l}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({ a: id, b: l });
    }
  }
  return lines;
}

/** Breadth-first shortest path along supply lines (returns list of planet ids). */
export function findPath(galaxy: Galaxy, from: string, to: string, passable?: (p: Planet) => boolean): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>();
  const q: string[] = [from];
  const seen = new Set<string>([from]);
  while (q.length) {
    const cur = q.shift()!;
    for (const n of galaxy.planets.get(cur)!.links) {
      if (seen.has(n)) continue;
      const np = galaxy.planets.get(n)!;
      if (n !== to && passable && !passable(np)) continue;
      seen.add(n);
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        let c = to;
        while (c !== from) {
          c = prev.get(c)!;
          path.unshift(c);
        }
        return path;
      }
      q.push(n);
    }
  }
  return null;
}
