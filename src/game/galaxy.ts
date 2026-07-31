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
}

export interface Galaxy {
  planets: Map<string, Planet>;
  order: string[]; // stable planet id ordering
  lines: SupplyLine[];
  sectors: Map<string, Sector>;
  radiusMax: number;
}

const RING_COUNT = 5;
const RING_SPACING = 95;
const PLANETS_PER_RING = [7, 11, 14, 16, 18];
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
    name: 'Super Earth',
    biome: 'terran',
    sector: 'Sol Sector',
    radius: 0,
    angle: 0,
    pos: { x: 0, y: 0 },
    scale: 1.6,
    owner: 'superEarth',
    origin: 'superEarth',
    isCapital: true,
    links: [],
    garrison: 120,
    fortification: 5,
    value: 10,
  });
  sectors.set('sector_core', { id: 'sector_core', name: 'Sol Sector', ring: 0, bucket: 0, planets: ['p_super_earth'] });
  planets.get('p_super_earth')!.sector = 'Sol Sector';

  // --- Rings ---
  for (let ring = 1; ring <= RING_COUNT; ring++) {
    const count = PLANETS_PER_RING[ring - 1]!;
    const baseR = ring * RING_SPACING;
    const buckets = Math.max(3, Math.round(count / 2));
    for (let j = 0; j < count; j++) {
      const angle = (Math.PI * 2 * j) / count + rng.range(-0.12, 0.12);
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
      // The deep frontier (outer ring) belongs firmly to the enemy wedges;
      // a slice of neutral-ish Super Earth space remains between them.

      const bucket = Math.floor((norm(angle) / (Math.PI * 2)) * buckets);
      const sectorId = `sector_${ring}_${bucket}`;
      if (!sectors.has(sectorId)) {
        sectors.set(sectorId, { id: sectorId, name: sectorName(rng), ring, bucket, planets: [] });
      }
      const sector = sectors.get(sectorId)!;

      const id = `p_${idCounter++}`;
      const isCap = false;
      addPlanet({
        id,
        name: planetName(rng, used),
        biome: biomeFor(owner, rng),
        sector: sector.name,
        radius: r,
        angle,
        pos,
        scale: rng.range(0.7, 1.25),
        owner,
        origin: owner,
        isCapital: isCap,
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
    automatons: 'Cyberstan',
    illuminate: "Squ'bai Shrine",
  };
  for (const w of WEDGES) {
    const candidates = order
      .map((id) => planets.get(id)!)
      .filter((p) => p.owner === w.faction && p.radius > RING_SPACING * 2.5);
    if (!candidates.length) continue;
    const strongest = candidates.reduce((a, b) => (b.radius > a.radius ? b : a));
    if (w.faction === 'terminids') {
      // Hive heart — powerful, but NOT a capital. No head to cut off.
      strongest.name = 'Kepler Prime';
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

  // --- Supply lines: connect neighbours (k-nearest + radial spokes) ---
  buildSupplyLines(planets, order);

  const radiusMax = RING_COUNT * RING_SPACING + 30;
  return { planets, order, lines: collectLines(planets, order), sectors, radiusMax };
}

function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function buildSupplyLines(planets: Map<string, Planet>, order: string[]): void {
  const arr = order.map((id) => planets.get(id)!);
  const K = 3;
  for (const p of arr) {
    const others = arr
      .filter((o) => o.id !== p.id)
      .map((o) => ({ o, d: dist2(p.pos, o.pos) }))
      .sort((a, b) => a.d - b.d);
    let linked = 0;
    for (const { o } of others) {
      if (linked >= K) break;
      if (!p.links.includes(o.id)) {
        p.links.push(o.id);
        if (!o.links.includes(p.id)) o.links.push(p.id);
        linked++;
      }
    }
  }
  // Ensure the graph is connected via a simple BFS + bridge pass.
  ensureConnected(planets, order);
}

function ensureConnected(planets: Map<string, Planet>, order: string[]): void {
  const seen = new Set<string>();
  const stack = [order[0]!];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const l of planets.get(id)!.links) stack.push(l);
  }
  // Any unreached planet gets bridged to its nearest reached planet.
  for (const id of order) {
    if (seen.has(id)) continue;
    const p = planets.get(id)!;
    let best: Planet | null = null;
    let bestD = Infinity;
    for (const rid of seen) {
      const r = planets.get(rid)!;
      const d = dist2(p.pos, r.pos);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (best) {
      p.links.push(best.id);
      best.links.push(p.id);
      // re-run reachability from this newly attached node
      const st = [id];
      while (st.length) {
        const n = st.pop()!;
        if (seen.has(n)) continue;
        seen.add(n);
        for (const l of planets.get(n)!.links) st.push(l);
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
