import type { BiomeId, FactionId, Planet, SupplyLine, Vec2 } from '../core/types';
import { RNG } from '../core/rng';
import { FACTIONS } from '../data/factions';
import { cityName, nameSource, sectorName } from './names';
import { DEFAULT_SHAPE, normAngle, shapeDef, type GalaxyShape } from './galaxyShapes';

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

const RING_COUNT = 8;
const RING_SPACING = 95;
const PLANETS_PER_RING = [9, 14, 19, 23, 27, 30, 33, 36];
/** Отступ полосы кольца от соседей — в него укладывается разброс секторов. */
const RING_INSET = 15;
/** На сколько сектор может выпятиться внутрь или наружу своей полосы. */
const RING_BULGE = 9;
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

export function generateGalaxy(seed: number, shape: GalaxyShape = DEFAULT_SHAPE): Galaxy {
  const rng = new RNG(seed);
  const form = shapeDef(shape);
  const planets = new Map<string, Planet>();
  const order: string[] = [];
  const sectors = new Map<string, Sector>();
  const used = new Set<string>();
  const usedCities = new Set<string>();
  const usedSectors = new Set<string>();
  // Малевелон Крик раздаётся не случайно, а вручную — рядом с машинами.
  used.add('Малевелон Крик');
  const nextName = nameSource(rng, used);
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
    cities: [
      { name: 'Мегаполис Единства', holder: 'superEarth' },
      { name: 'Столица Свободы', holder: 'superEarth' },
      { name: 'Порт Демократии', holder: 'superEarth' },
    ],
    depot: true,
    supplied: true,
    gloom: false,
    abyss: false,
    minerals: 0,
    buildings: [],
    e711Rich: false,
    shattered: false,
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

  // --- Кольца ---
  //
  // Сектор — не одинаковая долька: угловая ширина в кольце разная, а полоса
  // радиусов у каждого своя, с выпуклостью внутрь или наружу. Форма гуляет,
  // но разбиение по-прежнему покрывает круг целиком: доли нормируются на
  // полный оборот, а выпуклость не выходит за отступ между кольцами.
  // Радиусы колец задаёт форма: в «кольце» внутренние отодвинуты наружу, и
  // вокруг Супер-Земли образуется настоящая пустота. Границы полос — середины
  // между соседними кольцами, поэтому полосы не наезжают друг на друга при
  // любом профиле.
  const centres = Array.from({ length: RING_COUNT }, (_, i) =>
    (i + 1) * RING_SPACING * form.radial(i + 1));
  const bandOf = (i: number): [number, number] => {
    const c = centres[i]!;
    const prev = i === 0 ? Math.max(RING_SPACING * 0.5, c - RING_SPACING) : centres[i - 1]!;
    const next = i === RING_COUNT - 1 ? c + RING_SPACING : centres[i + 1]!;
    // Полный отступ с каждой стороны: между полосами остаётся 2×RING_INSET,
    // и выпуклость секторов (RING_BULGE) в него укладывается с запасом.
    return [(prev + c) / 2 + RING_INSET, (c + next) / 2 - RING_INSET];
  };

  for (let ring = 1; ring <= RING_COUNT; ring++) {
    const count = Math.max(4, Math.round(PLANETS_PER_RING[ring - 1]! * form.density(ring)));
    const [bandR0, bandR1] = bandOf(ring - 1);

    // Неравные доли кольца: вес каждой от 0.6 до 1.4, затем нормировка.
    // Форма ещё и поворачивает кольцо — из накопленного поворота получается
    // закрутка рукавов, видимая и по плитам секторов.
    const buckets = Math.max(4, Math.min(12, Math.round(count / 2.6)));
    const weights = Array.from({ length: buckets }, () => rng.range(0.5, 1.6));
    const total = weights.reduce((a, b) => a + b, 0);
    const spin = ring * form.twist;
    const edges: number[] = [spin];
    for (const w of weights) edges.push(edges[edges.length - 1]! + (w / total) * Math.PI * 2);
    edges[buckets] = spin + Math.PI * 2; // хвост округления — строго на полный круг

    // Сколько планет достаётся сектору. Ширина — не единственный довод: форма
    // задаёт плотность по углу, и в рукаве спирали планет вдвое больше, чем в
    // пустоши той же ширины. Ноль недопустим — пустых секторов на карте нет.
    const dens = weights.map((w, b) => {
      const mid = (edges[b]! + edges[b + 1]!) / 2;
      return w * form.weight(normAngle(mid), ring);
    });
    const densTotal = dens.reduce((a, b) => a + b, 0);
    const shares = dens.map((d) => Math.max(1, Math.round((d / densTotal) * count)));

    for (let bucket = 0; bucket < buckets; bucket++) {
      const a0 = edges[bucket]!;
      const a1 = edges[bucket + 1]!;
      const sectorId = `sector_${ring}_${bucket}`;
      const r0 = bandR0 - rng.range(0, RING_BULGE);
      const r1 = bandR1 + rng.range(0, RING_BULGE);
      const sector: Sector = {
        id: sectorId,
        name: sectorName(rng, usedSectors),
        ring,
        bucket,
        planets: [],
        r0,
        r1,
        a0,
        a1,
      };
      sectors.set(sectorId, sector);

      const n = shares[bucket]!;
      for (let k = 0; k < n; k++) {
        // Планеты раскладываются по своей доле равномерно с лёгким разбросом,
        // поэтому и в узком, и в широком секторе они стоят не в линейку.
        const span = a1 - a0;
        const angle = a0 + (span * (k + 0.5)) / n + rng.range(-span / (n * 3), span / (n * 3));
        const r = r0 + (r1 - r0) * rng.range(0.2, 0.8);

        let owner: FactionId = 'superEarth';
        if (ring >= 2) {
          for (const w of WEDGES) {
            if (inWedge(angle, w.from, w.to)) {
              owner = w.faction;
              break;
            }
          }
        }

        // Каждая планета — строго внутри своего сектора: клампим радиус и угол
        // с запасом на видимый размер шара, чтобы не было «пограничных» планет.
        const scale = rng.range(0.7, 1.25);
        const pad = 14 * scale + 6; // видимый радиус планеты + зазор
        const rClamped = Math.max(r0 + pad, Math.min(r1 - pad, r));
        const aPad = pad / Math.max(1, rClamped);
        // Клампим САМ angle, а не его нормированную копию.
        //
        // angle строится строго внутри (a0, a1), и границы эти АБСОЛЮТНЫЕ: у
        // форм с закруткой (спираль, скопления) бакеты дальних колец целиком
        // уезжают за 2π. norm() возвращал угол в [0, 2π), сравнение шло с
        // ненормированными a0/a1, и для такого бакета срабатывал нижний кламп
        // — ВСЕ его планеты садились на a0 + aPad, выстраиваясь в радиальную
        // линейку у кромки сектора. Ровно то, чего не должно быть по замыслу
        // строкой выше.
        const aClamped = Math.max(a0 + aPad, Math.min(a1 - aPad, angle));
        const posC: Vec2 = { x: Math.cos(aClamped) * rClamped, y: Math.sin(aClamped) * rClamped };

        const id = `p_${idCounter++}`;
        addPlanet({
          id,
          name: nextName(),
          biome: biomeFor(owner, rng),
          sector: sector.name,
          radius: rClamped,
          angle: aClamped,
          pos: posC,
          scale,
          seed: rng.int(0, 999_999),
          owner,
          origin: owner,
          isCapital: false,
          links: [],
          garrison: owner === 'superEarth' ? rng.int(15, 35) : rng.int(25, 55),
          fortification: rng.int(0, 2),
          value: rng.int(1, 5),
          cities: rng.chance(0.42)
            ? Array.from({ length: rng.int(1, 3) }, () => ({ name: cityName(rng, usedCities), holder: owner, spec: rng.pick(['yard', 'academy', 'mine'] as const) }))
            : [],
          depot: false,
          supplied: true,
          gloom: false,
          abyss: false,
          minerals: 0,
          buildings: [],
          e711Rich: false,
          shattered: false,
        });
        sector.planets.push(id);
      }
    }
  }

  // --- Ископаемые: магмовые миры богаты, вулканические/бесплодные — иногда ---
  for (const id of order) {
    const p = planets.get(id)!;
    if (p.biome === 'magma') p.minerals = 2;
    else if ((p.biome === 'volcanic' || p.biome === 'barren') && rng.chance(0.5)) p.minerals = 1;
    else if (rng.chance(0.12)) p.minerals = 1;
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
      .filter((p) => p.owner === w.faction && p.radius > centres[2]!);
    // Запасной вариант: в спирали или скоплениях клин фракции может целиком
    // попасть в пустошь, и своих миров на окраине у неё не окажется вовсе.
    // Тогда престол берётся силой — ближайший к середине клина дальний мир
    // переходит фракции. Без этого фракция просто исчезала из партии.
    let strongest: Planet;
    if (candidates.length) {
      strongest = candidates.reduce((a, b) => (b.radius > a.radius ? b : a));
    } else {
      const mid = norm((norm(w.from) + norm(w.to)) / 2);
      const outer = order.map((id) => planets.get(id)!)
        .filter((p) => p.radius > centres[2]! && !p.isCapital);
      if (!outer.length) continue;
      const off = (p: Planet): number => {
        const d = Math.abs(norm(p.angle) - mid);
        return Math.min(d, Math.PI * 2 - d);
      };
      strongest = outer.reduce((a, b) => (off(b) < off(a) ? b : a));
      strongest.owner = w.faction;
      strongest.origin = w.faction;
    }
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

  // --- Компактный старт врагов -------------------------------------------
  //
  // Каждой фракции остаётся ТОЛЬКО сектор её престола (у терминидов —
  // сектор Кеплер Прайма), остальное — Супер-Земля, и войну враги начинают,
  // распространяясь из своего дома.
  //
  // Исключение — РОЙ. Терминиды не государство, а биомасса: у них нет столицы,
  // которую можно взять, чтобы всё кончилось, — их надо выжигать мир за миром.
  // С одним сектором рой на это просто не тянул: его сносили раньше, чем он
  // успевал расползтись. Поэтому улей начинается с ДВУХ смежных секторов.
  const sectorCentre = (sec: Sector): Vec2 => {
    const ps = sec.planets.map((id) => planets.get(id)!);
    if (!ps.length) return { x: 0, y: 0 };
    return {
      x: ps.reduce((s2, p) => s2 + p.pos.x, 0) / ps.length,
      y: ps.reduce((s2, p) => s2 + p.pos.y, 0) / ps.length,
    };
  };
  const sectorByName = new Map<string, Sector>();
  for (const sec of sectors.values()) sectorByName.set(sec.name, sec);

  /** Сколько секторов достаётся фракции на старте. */
  const HOME_SECTORS: Partial<Record<FactionId, number>> = { terminids: 2 };

  const sectorOwner = new Map<string, FactionId>();
  const homeSectors = new Map<FactionId, string[]>();
  // Сначала за КАЖДОЙ фракцией закрепляется сектор её престола, и только
  // потом раздаются довески. Иначе рой, идущий по списку вторым, успевал
  // забрать себе ещё не заявленный домашний сектор иллюминатов.
  const seats = new Map<FactionId, Planet>();
  for (const w of WEDGES) {
    const seat = order
      .map((id) => planets.get(id)!)
      .find((p) => p.owner === w.faction && (p.isCapital || p.name === 'Кеплер Прайм'));
    if (!seat) continue;
    seats.set(w.faction, seat);
    // Первая заявка на сектор побеждает.
    //
    // Между клиньями фракций есть узкий зазор (25° между иллюминатами и роем),
    // и один бакет внешнего кольца способен его перекрыть — тогда два престола
    // оказываются в ОДНОМ секторе. Раньше вторая фракция по списку молча
    // перезаписывала запись первой и отбирала у неё домашний сектор; теперь
    // ей достанется довесок рядом, а чужой престол останется чужим.
    if (!sectorOwner.has(seat.sector)) {
      sectorOwner.set(seat.sector, w.faction);
      homeSectors.set(w.faction, [seat.sector]);
    } else {
      homeSectors.set(w.faction, []);
    }
  }
  // Добираем смежные сектора по близости центров — соседний по кольцу или
  // через кольцо, но всегда рядом с престолом, а не на другом краю карты.
  for (const [faction, seat] of seats) {
    const want = HOME_SECTORS[faction] ?? 1;
    if (want <= 1) continue;
    const home = sectorByName.get(seat.sector);
    const from = home ? sectorCentre(home) : seat.pos;
    const near = [...sectors.values()]
      .filter((sec) => sec.id !== 'sector_core' && sec.planets.length > 0 && !sectorOwner.has(sec.name))
      .sort((a, b) => dist2(sectorCentre(a), from) - dist2(sectorCentre(b), from));
    // Из ближайших берём не первый попавшийся, а самый населённый: сектор в
    // полторы планеты не даёт рою ничего, а именно ради плацдарма всё и
    // затевалось.
    const pool = near.slice(0, 5).sort((a, b) => b.planets.length - a.planets.length);
    for (const sec of pool.slice(0, want - 1)) {
      homeSectors.get(faction)!.push(sec.name);
      sectorOwner.set(sec.name, faction);
    }
  }
  for (const id of order) {
    const p = planets.get(id)!;
    const homeFaction = sectorOwner.get(p.sector);
    if (homeFaction) {
      // Домашний сектор целиком принадлежит фракции — усиленный гарнизон.
      p.owner = homeFaction;
      p.origin = homeFaction;
      p.garrison = Math.max(p.garrison, 60);
      p.fortification = Math.max(p.fortification, 2);
    } else if (p.owner !== 'superEarth') {
      p.owner = 'superEarth';
      p.origin = 'superEarth';
      p.garrison = Math.min(p.garrison, 30);
    }
  }

  // --- Домашние приметы автоматонов ---------------------------------------
  //
  // Машинам нужна руда: без платины Киберстан не строит ни корпусов, ни
  // особой верфи. Поэтому в их секторе гарантированно есть хотя бы один
  // магмовый мир с богатыми залежами — если сид такого не дал, ближайший к
  // Киберстану мир переплавляется в лаву.
  const autoHome = homeSectors.get('automatons')?.[0];
  if (autoHome) {
    const homeWorlds = order.map((id) => planets.get(id)!).filter((p) => p.sector === autoHome);
    const cyberstan = homeWorlds.find((p) => p.isCapital) ?? homeWorlds[0];
    if (cyberstan && !homeWorlds.some((p) => p.biome === 'magma' && p.minerals >= 2)) {
      const forge = homeWorlds
        .filter((p) => !p.isCapital)
        .sort((a, b) => dist2(a.pos, cyberstan.pos) - dist2(b.pos, cyberstan.pos))[0]
        ?? cyberstan;
      forge.biome = 'magma';
      forge.minerals = 2;
      forge.value = Math.max(forge.value, 6);
    }

    // Малевелон Крик — не рядовой мир, а место, где машины перемололи целые
    // дивизии. Джунгли в СОСЕДНЕМ секторе: не в глубине владений машин, а на
    // расстоянии одного удара — как и было в той войне.
    const homeSec = sectorByName.get(autoHome);
    const from = homeSec ? sectorCentre(homeSec) : (cyberstan?.pos ?? { x: 0, y: 0 });
    const neighbour = [...sectors.values()]
      // Только ничейный сектор: Крик — форпост машин во владениях Супер-Земли,
      // а не отнятый у роя или у иллюминатов мир.
      .filter((sec) => sec.id !== 'sector_core' && sec.planets.length > 0 && !sectorOwner.has(sec.name))
      .sort((a, b) => dist2(sectorCentre(a), from) - dist2(sectorCentre(b), from))[0];
    if (neighbour) {
      const creek = neighbour.planets
        .map((id) => planets.get(id)!)
        .filter((p) => !p.isCapital && p.name !== 'Кеплер Прайм')
        .sort((a, b) => dist2(a.pos, from) - dist2(b.pos, from))[0];
      if (creek) {
        used.delete(creek.name);
        creek.name = 'Малевелон Крик';
        creek.biome = 'jungle';
        creek.owner = 'automatons';
        creek.origin = 'automatons';
        creek.scale = Math.max(creek.scale, 1.1);
        creek.garrison = Math.max(creek.garrison, 70);
        creek.fortification = Math.max(creek.fortification, 3);
        creek.value = Math.max(creek.value, 7);
        creek.scarred = true;
      }
    }
  }

  // --- Минимальный плацдарм ---
  //
  // Домашний сектор может оказаться крошечным: в спирали и скоплениях
  // плотность по углу гуляет, и фракции иногда доставался ровно один мир — её
  // сносили в первую неделю, и партия превращалась в игру втроём. Поэтому у
  // каждого врага гарантированно не меньше трёх миров: недостающие берутся
  // ближайшие к столице.
  // Рою полагается больше прочих: у него нет столицы, падение которой решает
  // войну, — его выжигают мир за миром, и на это нужна биомасса.
  const MIN_HOME: Partial<Record<FactionId, number>> = { terminids: 7 };
  const MIN_HOME_DEFAULT = 3;
  for (const w of WEDGES) {
    const seat = order.map((id) => planets.get(id)!)
      .find((p) => p.owner === w.faction && (p.isCapital || p.name === 'Кеплер Прайм'));
    if (!seat) continue;
    const need = MIN_HOME[w.faction] ?? MIN_HOME_DEFAULT;
    const own = order.map((id) => planets.get(id)!).filter((p) => p.owner === w.faction);
    if (own.length >= need) continue;
    const spare = order.map((id) => planets.get(id)!)
      .filter((p) => p.owner === 'superEarth' && !p.isCapital)
      .sort((a, b) => dist2(a.pos, seat.pos) - dist2(b.pos, seat.pos));
    for (const p of spare.slice(0, need - own.length)) {
      p.owner = w.faction;
      p.origin = w.faction;
      p.garrison = Math.max(p.garrison, 60);
      p.fortification = Math.max(p.fortification, 2);
    }
  }

  // --- ЯДРО ДЕРЖАВЫ: миры врагов богаче рядовых ---------------------------
  //
  // Супер-Земля начинает с двух сотен планет, остальные — с горсти. При равной
  // ценности мира это означало, что машины, иллюминаты и рой выходили на старт
  // с производством, которого не хватало ни на верфь, ни на щит: первые
  // полсотни дней они просто копили. Их немногочисленные миры должны быть
  // действительно ядром державы — вдвое ценнее рядового мира и с
  // гарантированными залежами.
  //
  // Проход идёт ПОСЛЕ всех раздач — минимального плацдарма и Малевелон Крика
  // тоже: иначе миры, доставшиеся фракции последними, оставались нищими.
  for (const id of order) {
    const p = planets.get(id)!;
    if (p.owner === 'superEarth') continue;
    p.value = Math.max(p.value, 6) + 2;
    p.minerals = Math.max(p.minerals, 1);
    if (p.isCapital) p.minerals = Math.max(p.minerals, 2);
  }

  // --- Supply lines: relative neighbourhood graph (true neighbours only) ---
  buildSupplyLines(planets, order);

  const radiusMax = centres[RING_COUNT - 1]! + RING_SPACING * 0.6 + 30;
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
