import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Scene } from '@babylonjs/core/scene';
import type { Planet } from '../core/types';
import { BIOMES } from '../data/biomes';
import { factionColor } from '../data/factions';
import { moonShape, reliefShape, ringShape } from './planetAssets';
import { hexColor, mixColor, offsetHSL, SUN_DIR } from './engine';
import { ATMO_UNIFORMS, SURFACE_ATTRS, SURFACE_UNIFORMS } from './planetShaders';
import { HULL_ATTRS, HULL_UNIFORMS } from './hullShader';

// ---------------------------------------------------------------------------
// Один мир на карте: поверхность, атмосфера, кольца, луна, оболочки состояний
// (Мрак, Бездна, обломки, щит) и орбитальная станция.
//
// Шейдеры живут отдельно, в planetShaders.ts, и перенесены дословно. Здесь —
// сборка узлов и вся логика состояний, которую дёргает сцена.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Геометрия миров: три уровня детализации на общих данных.
//
// Одна сфера на все двести миров была компромиссом не в ту сторону: на общем
// плане её сегментов заведомо больше, чем нужно, а вблизи лимб планеты
// оставался заметным многоугольником — сфера в 48 сегментов на полэкрана
// показывает грани. Теперь их три, и переключаются они по дистанции (см.
// setDetail): вблизи силуэт гладкий, издали не тратится ни одного лишнего
// треугольника.
//
// Данные общие: меши клонируют одни и те же VertexData, поэтому три уровня
// стоят ровно столько же памяти, сколько раньше стоил один.
// ---------------------------------------------------------------------------

/** Сегменты сферы по уровням: общий план → средний → вплотную. */
export const SPHERE_LOD = [32, 64, 112] as const;

const sphereVD: (VertexData | null)[] = [null, null, null];
let shellVD: VertexData | null = null;

function sphereData(level: number): VertexData {
  const i = Math.max(0, Math.min(SPHERE_LOD.length - 1, level));
  if (!sphereVD[i]) sphereVD[i] = CreateSphereVertexData({ segments: SPHERE_LOD[i]!, diameter: 2 });
  return sphereVD[i]!;
}
function shellData(): VertexData {
  if (!shellVD) shellVD = CreateSphereVertexData({ segments: 20, diameter: 2 });
  return shellVD;
}

/** Меш из готовых вершинных данных — общий приём для всех оболочек мира. */
function meshFrom(name: string, vd: VertexData, scene: Scene): Mesh {
  const m = new Mesh(name, scene);
  vd.applyToMesh(m, false);
  m.isPickable = false;
  return m;
}

/** Простая непросвечивающая оболочка (Мрак, Бездна, щит). */
function shellMaterial(
  name: string, scene: Scene, color: Color3, alpha: number, additive: boolean,
): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.emissiveColor = color;
  m.diffuseColor = new Color3(0, 0, 0);
  m.specularColor = new Color3(0, 0, 0);
  m.disableLighting = true;
  m.alpha = alpha;
  m.disableDepthWrite = true;
  if (additive) m.alphaMode = Constants.ALPHA_ADD;
  return m;
}

/**
 * Материал планетарного сооружения — тот же процедурный корпус, что у флота.
 *
 * Станция и верфь на орбите стоят рядом с кораблями и рядом с самой планетой:
 * если у флота обшивка со швами и потёртостями, а у станции ровная заливка,
 * она выглядит заглушкой. Параметры чуть другие: сооружения крупнее, плиты у
 * них шире, а износ сильнее — они висят на орбите годами и их никто не моет.
 */
function structureMaterial(
  name: string, scene: Scene, base: Color3, accent: Color3,
  opts: { metal?: number; rough?: number; emissive?: number; panel?: number; wear?: number } = {},
): ShaderMaterial {
  const m = new ShaderMaterial(name, scene, 'hull', {
    attributes: HULL_ATTRS,
    uniforms: HULL_UNIFORMS,
  });
  m.setColor3('uBase', base);
  m.setColor3('uAccent', accent);
  m.setVector3('uSun', SUN_DIR);
  m.setFloat('uMetal', opts.metal ?? 0.55);
  m.setFloat('uRough', opts.rough ?? 0.45);
  m.setFloat('uEmissive', opts.emissive ?? 0);
  m.setFloat('uPanel', opts.panel ?? 0.03);
  m.setFloat('uWear', opts.wear ?? 0.9);
  m.setFloat('uOrganic', 0);
  return m;
}

// Кольцо наведения: три дуги с тремя квадратными вырезами, равномерно
// распределёнными по окружности. Вращается вокруг оси планеты.
const HOVER_ARC = (Math.PI * 2) / 3 - 0.38; // дуга ~101°, вырез ~22°

/** Плоское кольцо-дуга в плоскости XZ: внутренний и внешний радиус, сектор. */
function arcVertexData(r0: number, r1: number, start: number, span: number, seg = 20): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = start + (span * i) / seg;
    const c = Math.cos(a), s = Math.sin(a);
    positions.push(c * r0, 0, s * r0, c * r1, 0, s * r1);
    normals.push(0, 1, 0, 0, 1, 0);
  }
  for (let i = 0; i < seg; i++) {
    const b = i * 2;
    indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.indices = indices;
  return vd;
}

/** Облако точек — поле обломков и орбитальный мусор. */
function pointCloud(name: string, pts: Float32Array, scene: Scene): Mesh {
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pts;
  vd.indices = new Uint32Array(pts.length / 3).map((_, i) => i);
  vd.applyToMesh(mesh, false);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

export interface PlanetVisual {
  root: TransformNode;
  surface: Mesh;
  material: ShaderMaterial;
  planetId: string;
  baseRadius: number;
  update(t: number, dt: number): void;
  setOwner(hex: string): void;
  setSelected(on: boolean): void;
  setHovered(on: boolean): void;
  setGloom(on: boolean): void;
  setAbyss(on: boolean): void;
  setShattered(on: boolean): void;
  /** Пожары войны на поверхности сражающейся планеты. */
  setBattle(on: boolean): void;
  /** Затемнение осаждённого мира (1 — норма, <1 — меркнет). */
  setDim(v: number): void;
  /** Шрамы долгих битв на поверхности (перманентные). */
  setScar(on: boolean): void;
  /** Обломки погибших флотов на орбите (0 — чисто). */
  setWreckage(amount: number): void;
  /** Уровень детализации шейдера: октавы шума (5 — вблизи, 9 — рядом). */
  setLod(octaves: number): void;
  /** Плотность сетки сферы: 0 — общий план, 2 — вплотную. */
  setDetail(level: number): void;
  /** Вблизи — рельефная геометрия из Blender, издали — гладкая сфера. */
  setRelief(on: boolean): void;
  /** Планетарный щит: голубая сфера; active — под ударом (ярче, пульс). */
  setShield(on: boolean, active: boolean): void;
  /** Орбитальная боевая станция, кружащая над планетой. */
  setStation(on: boolean): void;
  /** Орбитальный док верфи: видно, где фракция строит флот. */
  setYard(on: boolean): void;
}

// ---------------------------------------------------------------------------
// Карта Земли для Супер-Земли: узнаваемые очертания континентов рисуются на
// канве (эквидистантная проекция) и подаются в шейдер маской суши.
// ---------------------------------------------------------------------------

let earthMaskTex: Texture | null = null;
let dummyMaskTex: Texture | null = null;

type LL = [number, number]; // [долгота, широта] в градусах

const CONTINENTS: LL[][] = [
  // Северная Америка (с Аляской и Мексикой)
  [[-168, 66], [-152, 71], [-130, 70], [-110, 72], [-95, 73], [-82, 74], [-74, 66], [-60, 55], [-52, 47], [-65, 44], [-70, 41], [-75, 35], [-81, 30], [-80, 25], [-90, 29], [-97, 26], [-97, 20], [-95, 16], [-84, 10], [-79, 8], [-83, 14], [-92, 15], [-105, 22], [-114, 30], [-121, 34], [-124, 42], [-128, 50], [-135, 57], [-152, 58], [-165, 55], [-168, 60]],
  // Гренландия
  [[-58, 76], [-45, 82], [-25, 83], [-20, 76], [-25, 70], [-40, 60], [-50, 62], [-55, 68]],
  // Южная Америка
  [[-79, 9], [-70, 12], [-62, 10], [-52, 5], [-44, -3], [-35, -6], [-37, -13], [-40, -22], [-48, -28], [-58, -34], [-62, -41], [-66, -48], [-69, -54], [-72, -50], [-71, -38], [-72, -30], [-70, -18], [-76, -10], [-80, -3], [-78, 3]],
  // Африка
  [[-17, 21], [-10, 32], [0, 36], [10, 37], [20, 32], [32, 31], [35, 27], [34, 15], [43, 12], [51, 10], [48, 2], [41, -4], [40, -13], [35, -22], [30, -30], [20, -35], [17, -32], [14, -22], [12, -14], [8, -1], [9, 4], [4, 6], [-5, 5], [-13, 9], [-17, 15]],
  // Европа + Азия
  [[-10, 44], [-9, 52], [-2, 58], [5, 62], [12, 65], [20, 70], [35, 68], [45, 68], [60, 70], [75, 73], [90, 76], [105, 77], [120, 73], [140, 72], [160, 70], [178, 66], [178, 62], [162, 60], [155, 53], [142, 47], [132, 43], [122, 38], [121, 30], [110, 20], [106, 10], [103, 2], [99, 7], [95, 16], [88, 22], [80, 8], [76, 15], [70, 22], [62, 25], [56, 26], [48, 30], [35, 36], [26, 38], [15, 40], [3, 43]],
  // Австралия
  [[113, -22], [115, -35], [125, -33], [130, -32], [137, -35], [140, -38], [147, -38], [153, -30], [151, -24], [145, -15], [140, -12], [135, -12], [130, -13], [122, -14], [114, -20]],
  // Антарктида (сплошной пояс)
  [[-180, -70], [180, -70], [180, -90], [-180, -90]],
];

function buildEarthMask(scene: Scene): Texture {
  const w = 512, h = 256;
  const tex = new DynamicTexture('earthMask', { width: w, height: h }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  const X = (lon: number) => ((lon + 180) / 360) * w;
  const Y = (lat: number) => ((90 - lat) / 180) * h;
  for (const poly of CONTINENTS) {
    ctx.beginPath();
    poly.forEach(([lon, lat], i) => (i === 0 ? ctx.moveTo(X(lon), Y(lat)) : ctx.lineTo(X(lon), Y(lat))));
    ctx.closePath();
    ctx.fill();
  }
  // Крупные острова: Великобритания, Мадагаскар, Япония, Новая Зеландия, Борнео.
  const isle = (lon: number, lat: number, rx: number, ry: number, rot = 0) => {
    ctx.save(); ctx.translate(X(lon), Y(lat)); ctx.rotate(rot);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  };
  isle(-3, 54, 4, 7);
  isle(47, -19, 4, 9);
  isle(139, 37, 4, 10, 0.5);
  isle(172, -42, 3, 8, 0.3);
  isle(114, 0, 8, 6);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  return tex;
}

function maskFor(planetId: string, scene: Scene): { tex: Texture; use: number } {
  if (planetId === 'p_super_earth') {
    if (!earthMaskTex) earthMaskTex = buildEarthMask(scene);
    return { tex: earthMaskTex, use: 1 };
  }
  if (!dummyMaskTex) {
    dummyMaskTex = new DynamicTexture('noMask', { width: 2, height: 2 }, scene, false);
    (dummyMaskTex as DynamicTexture).update();
  }
  return { tex: dummyMaskTex, use: 0 };
}

/** Deterministic 0..1 stream from a planet seed — drives per-planet variety. */
function seededStream(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPlanetVisual(planet: Planet, scene: Scene): PlanetVisual {
  const biome = BIOMES[planet.biome];
  const baseRadius = 0.42 * planet.scale;
  const rand = seededStream(planet.seed);

  // Every planet gets its own surface: jittered colours, water level,
  // terrain frequency, spin and axial tilt — all derived from planet.seed.
  const land = offsetHSL(hexColor(biome.land), rand() * 0.08 - 0.04, rand() * 0.2 - 0.1, rand() * 0.16 - 0.08);
  const sea = offsetHSL(hexColor(biome.sea), rand() * 0.06 - 0.03, rand() * 0.2 - 0.1, rand() * 0.12 - 0.06);
  const water = Math.min(0.95, Math.max(0.02, biome.water + rand() * 0.26 - 0.13));
  // Разброс базовой частоты широкий: иначе все миры одного биома лепятся из
  // шума почти одного масштаба и на общем плане выглядят однояйцевыми.
  const freq = 0.75 + rand() * 4.1;
  const clouds = Math.min(1, Math.max(0, biome.clouds + rand() * 0.25 - 0.12));
  const spinSpeed = (0.0012 + rand() * 0.003) * (rand() < 0.15 ? -1 : 1);
  const tilt = (rand() * 2 - 1) * 0.35;
  // Дополнительная уникальность поверхности.
  const warp = 0.35 + rand() * 0.85;                       // рваность континентов
  const bands = planet.biome === 'gas' ? 6 + rand() * 10 : 0; // полосы гигантов
  // Полярные шапки — только на землеподобных и ледяных мирах.
  const hasCaps = planet.biome === 'terran' || planet.biome === 'ice';
  const capSize = hasCaps ? 0.72 + rand() * 0.2 : 2.0;
  const city = planet.cities.length > 0 ? 1 : 0;           // ночные огни городов
  // Стиль суши: архипелаги / материки / пангея — треть миров каждого типа.
  // Магма всегда тяготеет к крупным лавовым океанам и цельным материкам.
  const styleRoll = rand();
  const continent = planet.biome === 'magma'
    ? 0.75 + rand() * 0.15
    : styleRoll < 0.3 ? 0.12 + rand() * 0.2   // архипелаг: россыпь островов
    : styleRoll < 0.72 ? 0.45 + rand() * 0.25 // классические континенты
    : 0.78 + rand() * 0.17;                    // пангея: единый сверхматерик
  // Горные хребты вместо воды на пустынных/бесплодных мирах.
  const ridges = planet.biome === 'desert' || planet.biome === 'barren' ? 1 : 0;
  // Кратерные поля: бесплодные — всегда, ледяные/пустынные — через раз.
  const craters = planet.biome === 'barren' || ((planet.biome === 'ice' || planet.biome === 'desert') && rand() < 0.45) ? 1 : 0;
  const mask = maskFor(planet.id, scene);

  const material = new ShaderMaterial(`planet_${planet.id}`, scene, 'planetSurface', {
    attributes: SURFACE_ATTRS,
    uniforms: SURFACE_UNIFORMS,
    samplers: ['uMask'],
  });
  const ownerColor = hexColor(factionColor(planet.owner));
  material.setColor3('uLand', land);
  material.setColor3('uSea', sea);
  material.setColor3('uAtmo', hexColor(biome.atmo));
  material.setColor3('uTint', ownerColor);
  material.setFloat('uWater', water);
  material.setFloat('uRough', biome.rough);
  material.setFloat('uClouds', clouds);
  material.setFloat('uTime', 0);
  material.setFloat('uSeed', (planet.seed % 8933) * 0.017);
  material.setFloat('uFreq', freq);
  material.setFloat('uWarp', warp);
  material.setFloat('uBands', bands);
  material.setFloat('uCity', city);
  material.setFloat('uCapSize', capSize);
  material.setFloat('uContinent', continent);
  material.setFloat('uRidges', ridges);
  material.setFloat('uCraters', craters);
  material.setFloat('uBattle', 0);
  material.setFloat('uDim', 1);
  material.setFloat('uScar', 0);
  material.setFloat('uOct', 7);
  material.setFloat('uLava', planet.biome === 'magma' || planet.biome === 'volcanic' ? 1 : 0);
  material.setFloat('uIce', planet.biome === 'ice' ? 1 : 0);
  material.setFloat('uToxic', planet.biome === 'toxic' ? 1 : 0);
  material.setTexture('uMask', mask.tex);
  material.setFloat('uUseMask', mask.use);
  material.setVector3('uSun', SUN_DIR);
  material.setFloat('uRadius', baseRadius);

  const root = new TransformNode(`p_${planet.id}`, scene);

  // Наклон оси вынесен на родителя: если крутить сам меш по Y поверх поворота
  // по Z, полюс уходит конусом (прецессия) вместо честного вращения.
  // Дополнительный поворот по Y разворачивает рельеф — миры одного семейства
  // показывают разные свои стороны и не выглядят копиями.
  const axis = new TransformNode(`axis_${planet.id}`, scene);
  axis.parent = root;
  axis.rotation.set(0, rand() * Math.PI * 2, tilt);

  // Гладкие сферы трёх плотностей: видна всегда ровно одна.
  const shells = SPHERE_LOD.map((_, i) => {
    const m = meshFrom(`surf${i}_${planet.id}`, sphereData(i), scene);
    m.material = material;
    m.scaling.setAll(baseRadius);
    m.parent = axis;
    m.setEnabled(i === 0);
    return m;
  });
  // Пикинг идёт по самой грубой сфере: она есть всегда, у неё простая
  // геометрия и ровно тот силуэт, по которому игрок целится. Дальше по коду
  // именно она считается «поверхностью» мира.
  const surface = shells[0]!;
  surface.isPickable = true;
  surface.metadata = { planetId: planet.id };

  // Рельефная геометрия из Blender: у мира появляется настоящий силуэт гор,
  // кратеров и разломов. Держится отдельным мешем и включается на подлёте —
  // на общем плане рельеф не читается, зато его нормали дают мерцание на
  // планетах размером в десяток пикселей.
  const reliefVD = reliefShape(planet.biome, planet.seed);
  let relief: Mesh | null = null;
  if (reliefVD) {
    relief = meshFrom(`relief_${planet.id}`, reliefVD, scene);
    relief.material = material;
    relief.scaling.setAll(baseRadius);
    relief.parent = axis;
    relief.setEnabled(false);
  }

  // Кольца: у газовых гигантов почти всегда, у прочих крупных миров изредка.
  // Геометрия — набор концентрических полос из Blender (щели видны на просвет).
  const wantsRing = planet.biome === 'gas' ? rand() < 0.8 : rand() < 0.07;
  const ringVD = wantsRing ? ringShape() : null;
  let ringMesh: Mesh | null = null;
  if (ringVD) {
    ringMesh = meshFrom(`ring_${planet.id}`, ringVD, scene);
    const ringMat = new PBRMaterial(`ringMat_${planet.id}`, scene);
    ringMat.albedoColor = mixColor(land, new Color3(1, 1, 1), 0.35);
    ringMat.metallic = 0;
    ringMat.roughness = 0.9;
    ringMat.alpha = 0.5;
    ringMat.backFaceCulling = false;
    ringMat.disableDepthWrite = true;
    ringMesh.material = ringMat;
    ringMesh.scaling.setAll(baseRadius);
    ringMesh.parent = root;
    // В glTF кольцо уже лежит горизонтально — нужен только лёгкий наклон.
    ringMesh.rotation.x = rand() * 0.44 - 0.22;
    ringMesh.rotation.z = rand() * 0.44 - 0.22;
    // Нормаль плоскости кольца в системе планеты — по ней шейдер поверхности
    // считает, куда ложится теневая полоса.
    const rn = new Vector3(0, 1, 0);
    const cx = Math.cos(ringMesh.rotation.x), sx = Math.sin(ringMesh.rotation.x);
    const cz = Math.cos(ringMesh.rotation.z), sz = Math.sin(ringMesh.rotation.z);
    rn.set(-sz * cx, cz * cx, sx);
    material.setVector3('uRingN', rn.normalize());
    material.setFloat('uRingIn', 1.32);
    material.setFloat('uRingOut', 2.18);
    material.setFloat('uHasRing', 1);
  } else {
    material.setVector3('uRingN', new Vector3(0, 1, 0));
    material.setFloat('uRingIn', 1.32);
    material.setFloat('uRingOut', 2.18);
    material.setFloat('uHasRing', 0);
  }

  // Луна: спутник-обломок у части крупных миров.
  const moonVD = planet.scale > 0.9 && rand() < 0.3 ? moonShape() : null;
  let moonMesh: Mesh | null = null;
  const moonOrbit = {
    r: baseRadius * (2.4 + rand() * 0.9), phase: rand() * Math.PI * 2,
    speed: 0.12 + rand() * 0.16, y: (rand() * 2 - 1) * baseRadius * 0.5,
  };
  if (moonVD) {
    moonMesh = meshFrom(`moon_${planet.id}`, moonVD, scene);
    const mm = new PBRMaterial(`moonMat_${planet.id}`, scene);
    mm.albedoColor = new Color3(0.55, 0.52, 0.47);
    mm.metallic = 0;
    mm.roughness = 0.95;
    moonMesh.material = mm;
    moonMesh.scaling.setAll(baseRadius * (0.16 + rand() * 0.1));
    moonMesh.parent = root;
  }

  // Faction-coloured halo — ownership is always read from this one colour.
  const atmoMat = new ShaderMaterial(`atmo_${planet.id}`, scene, 'planetAtmo', {
    attributes: SURFACE_ATTRS,
    uniforms: ATMO_UNIFORMS,
    needAlphaBlending: true,
  });
  atmoMat.setColor3('uColor', ownerColor);
  atmoMat.setVector3('uSun', SUN_DIR);
  atmoMat.alphaMode = Constants.ALPHA_ADD;
  atmoMat.disableDepthWrite = true;
  const atmo = meshFrom(`atmoM_${planet.id}`, shellData(), scene);
  atmo.material = atmoMat;
  atmo.scaling.setAll(baseRadius * 1.045);
  atmo.parent = root;
  // Рисуется ТОЛЬКО ДАЛЬНЯЯ полусфера оболочки, и это принципиально.
  //
  // Френель на дальних гранях равен единице по всей их площади, так что нимб
  // получается не из него, а из перекрытия: непрозрачная планета закрывает
  // почти всю оболочку, и наружу торчит лишь узкое кольцо шириной в 4,5%
  // радиуса. Если оставить и ближнюю полусферу, она добавит поверх свой
  // френелевый ореол — аддитивно, вдвое ярче, — и вместо тонкой каймы у мира
  // появляется молочный пузырь. Переворот обхода граней (нормали при этом
  // не трогаются) отсекает именно ближнюю половину.
  atmo.flipFaces(false);

  // Кольцо наведения (появляется только при hover/выборе, крутится вокруг оси).
  const hoverRing = new TransformNode(`hover_${planet.id}`, scene);
  hoverRing.parent = root;
  const hoverMat = shellMaterial(`hoverMat_${planet.id}`, scene, new Color3(1, 0.82, 0.29), 0.95, false);
  hoverMat.backFaceCulling = false;
  const hoverArcs: Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const start = (i * Math.PI * 2) / 3 + 0.19;
    const arc = meshFrom(`arc_${planet.id}_${i}`, arcVertexData(1.42, 1.58, start, HOVER_ARC), scene);
    arc.material = hoverMat;
    arc.parent = hoverRing;
    hoverArcs.push(arc);
  }
  hoverRing.scaling.setAll(baseRadius);
  hoverRing.setEnabled(false);

  // Мрак: плотный клуб спорового дыма, скрывающий планету целиком,
  // плюс внешняя рваная дымка.
  const gloomShell = meshFrom(`gloom_${planet.id}`, shellData(), scene);
  gloomShell.material = shellMaterial(`gloomMat_${planet.id}`, scene, new Color3(0.54, 0.45, 0.17), 0.9, false);
  gloomShell.scaling.setAll(baseRadius * 1.28);
  gloomShell.parent = root;
  gloomShell.setEnabled(false);

  const gloomHaze = meshFrom(`haze_${planet.id}`, shellData(), scene);
  gloomHaze.material = shellMaterial(`hazeMat_${planet.id}`, scene, new Color3(0.85, 0.70, 0.16), 0.22, true);
  gloomHaze.scaling.set(baseRadius * 1.75, baseRadius * 1.45, baseRadius * 1.75);
  gloomHaze.parent = root;
  gloomHaze.setEnabled(false);

  // Пелена Бездны: почти чёрная воронка на месте исчезнувшей планеты.
  const abyssShell = meshFrom(`abyss_${planet.id}`, shellData(), scene);
  abyssShell.material = shellMaterial(`abyssMat_${planet.id}`, scene, new Color3(0.10, 0.02, 0.19), 0.85, false);
  abyssShell.scaling.setAll(baseRadius * 1.1);
  abyssShell.parent = root;
  abyssShell.setEnabled(false);

  // Поле обломков — кольцо каменной крошки на месте уничтоженной планеты.
  const debrisCount = 70;
  const debrisPos = new Float32Array(debrisCount * 3);
  for (let i = 0; i < debrisCount; i++) {
    const a = (i / debrisCount) * Math.PI * 2 + rand() * 0.3;
    const r = 0.7 + rand() * 0.75;
    debrisPos[i * 3] = Math.cos(a) * r;
    debrisPos[i * 3 + 1] = (rand() - 0.5) * 0.16;
    debrisPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const debris = pointCloud(`debris_${planet.id}`, debrisPos, scene);
  const debrisMat = shellMaterial(`debrisMat_${planet.id}`, scene, new Color3(0.60, 0.58, 0.54), 1, false);
  debrisMat.pointsCloud = true;
  debrisMat.pointSize = 3;
  debris.material = debrisMat;
  debris.scaling.setAll(baseRadius);
  debris.parent = root;
  debris.setEnabled(false);

  // Обломки погибших флотов: редкое тёмное кольцо крошки над орбитой.
  // Появляется после сражений и тает вместе с запасом обломков в состоянии.
  const wreckCount = 34;
  const wreckPos = new Float32Array(wreckCount * 3);
  for (let i = 0; i < wreckCount; i++) {
    const a = (i / wreckCount) * Math.PI * 2 + rand() * 0.4;
    const r = 1.7 + rand() * 0.7;
    wreckPos[i * 3] = Math.cos(a) * r;
    wreckPos[i * 3 + 1] = (rand() - 0.5) * 0.3;
    wreckPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const wreck = pointCloud(`wreck_${planet.id}`, wreckPos, scene);
  const wreckMat = shellMaterial(`wreckMat_${planet.id}`, scene, new Color3(0.54, 0.51, 0.48), 0, false);
  wreckMat.pointsCloud = true;
  wreckMat.pointSize = 2;
  wreck.material = wreckMat;
  wreck.scaling.setAll(baseRadius);
  wreck.parent = root;
  wreck.setEnabled(false);

  // Планетарный щит: полупрозрачная голубая сфера, при штурме — ярче и пульсирует.
  const shieldMat = shellMaterial(`shieldMat_${planet.id}`, scene, new Color3(0.40, 0.78, 1), 0.07, true);
  shieldMat.backFaceCulling = false;
  const shield = meshFrom(`shield_${planet.id}`, shellData(), scene);
  shield.material = shieldMat;
  shield.scaling.setAll(baseRadius * 1.34);
  shield.parent = root;
  shield.setEnabled(false);

  // Орбитальная боевая станция: корпус-октаэдр с кольцом, кружит над миром.
  const stationGrp = new TransformNode(`station_${planet.id}`, scene);
  stationGrp.parent = root;
  // Корпус: гранёный блок с обшивкой и потёртостями.
  const stBody = CreatePolyhedron(`stBody_${planet.id}`, { type: 1, size: 0.06 }, scene);
  stBody.material = structureMaterial(`stBodyMat_${planet.id}`, scene,
    new Color3(0.52, 0.56, 0.62), ownerColor, { metal: 0.6, rough: 0.5, panel: 0.022 });
  stBody.parent = stationGrp;
  stBody.isPickable = false;
  // Опорное кольцо — жилой обод станции, а не светящийся ободок.
  const stRing = CreateTorus(`stRing_${planet.id}`, { diameter: 0.19, thickness: 0.018, tessellation: 24 }, scene);
  stRing.material = structureMaterial(`stRingMat_${planet.id}`, scene,
    new Color3(0.46, 0.50, 0.56), ownerColor, { metal: 0.55, rough: 0.55, panel: 0.014 });
  stRing.parent = stationGrp;
  stRing.isPickable = false;
  // Солнечные панели: две плоскости на штангах — по ним станция и читается
  // станцией, а не просто гранёным камнем на орбите.
  for (const side of [-1, 1]) {
    const wing = CreateBox(`stWing${side}_${planet.id}`,
      { width: 0.115, height: 0.006, depth: 0.055 }, scene);
    wing.material = structureMaterial(`stWingMat${side}_${planet.id}`, scene,
      new Color3(0.14, 0.19, 0.32), ownerColor, { metal: 0.35, rough: 0.3, panel: 0.008, wear: 0.4 });
    wing.position.set(side * 0.125, 0, 0);
    wing.parent = stationGrp;
    wing.isPickable = false;
    const boom = CreateBox(`stBoom${side}_${planet.id}`,
      { width: 0.07, height: 0.008, depth: 0.008 }, scene);
    boom.material = stBody.material;
    boom.position.set(side * 0.062, 0, 0);
    boom.parent = stationGrp;
    boom.isPickable = false;
  }
  // Маяк: единственная светящаяся деталь — её и подхватывает слой свечения.
  const stLight = meshFrom(`stLight_${planet.id}`, shellData(), scene);
  stLight.material = shellMaterial(`stLightMat_${planet.id}`, scene, ownerColor, 0.95, true);
  stLight.scaling.setAll(0.016);
  stLight.position.y = 0.062;
  stLight.parent = stationGrp;
  stationGrp.setEnabled(false);

  // --- Верфь: орбитальный док ------------------------------------------------
  //
  // До этого верфь жила только в интерфейсе: на карте мир с верфью ничем не
  // отличался от мира без неё, хотя это главное производственное сооружение
  // партии. Теперь над планетой висит ферма дока — две балки, стапель между
  // ними и сигнальные огни.
  const yardGrp = new TransformNode(`yard_${planet.id}`, scene);
  yardGrp.parent = root;
  const yardMat = structureMaterial(`yardMat_${planet.id}`, scene,
    new Color3(0.48, 0.51, 0.56), ownerColor, { metal: 0.6, rough: 0.55, panel: 0.018 });
  for (const side of [-1, 1]) {
    const beam = CreateBox(`yardBeam${side}_${planet.id}`,
      { width: 0.028, height: 0.028, depth: 0.24 }, scene);
    beam.material = yardMat;
    beam.position.set(side * 0.075, 0, 0);
    beam.parent = yardGrp;
    beam.isPickable = false;
  }
  // Поперечины стапеля: между балками собирают корпус.
  for (const z of [-0.08, 0, 0.08]) {
    const rib = CreateBox(`yardRib${z}_${planet.id}`,
      { width: 0.155, height: 0.016, depth: 0.018 }, scene);
    rib.material = yardMat;
    rib.position.set(0, 0, z);
    rib.parent = yardGrp;
    rib.isPickable = false;
  }
  // Сигнальные огни по углам фермы — их подхватывает слой свечения.
  for (const [lx, lz] of [[-0.075, 0.12], [0.075, 0.12], [-0.075, -0.12], [0.075, -0.12]] as const) {
    const lamp = meshFrom(`yardLamp${lx}${lz}_${planet.id}`, shellData(), scene);
    lamp.material = shellMaterial(`yardLampMat${lx}${lz}_${planet.id}`, scene, ownerColor, 0.9, true);
    lamp.scaling.setAll(0.012);
    lamp.position.set(lx, 0, lz);
    lamp.parent = yardGrp;
  }
  yardGrp.setEnabled(false);

  let spin = rand() * Math.PI * 2;
  let hovered = false;
  let selected = false;
  let inAbyss = false;
  let shieldActive = false;
  let reliefOn = false;
  let surfaceShown = true;
  let detailLevel = 0;
  const stationPhase = rand() * Math.PI * 2;

  /** Поверхность — это либо одна из сфер, либо рельеф: видна ровно одна. */
  const syncSurface = (): void => {
    for (let i = 0; i < shells.length; i++) {
      shells[i]!.setEnabled(surfaceShown && !reliefOn && i === detailLevel);
    }
    relief?.setEnabled(surfaceShown && reliefOn);
  };

  const syncRing = (): void => {
    hoverRing.setEnabled((hovered || selected) && !inAbyss);
    hoverMat.emissiveColor = selected ? new Color3(1, 0.82, 0.29) : new Color3(0.86, 0.90, 0.96);
  };

  return {
    root,
    surface,
    material,
    planetId: planet.id,
    baseRadius,
    update(t: number, dt: number) {
      material.setFloat('uTime', t);
      // Скорость вращения задана «на кадр при 60 Гц» — приводим к времени,
      // иначе на 144-герцовом мониторе миры крутятся вдвое быстрее.
      spin += spinSpeed * dt * 60;
      for (const sh of shells) sh.rotation.y = spin;
      if (relief) relief.rotation.y = spin;
      if (hoverRing.isEnabled()) hoverRing.rotation.y += dt * 0.9;
      if (gloomShell.isEnabled()) {
        gloomShell.rotation.y += dt * 0.15;
        gloomHaze.rotation.y -= dt * 0.1;
        // дым «дышит»
        const puff = 1 + Math.sin(t * 0.7) * 0.04;
        gloomShell.scaling.setAll(baseRadius * 1.28 * puff);
      }
      if (abyssShell.isEnabled()) abyssShell.rotation.y -= dt * 0.4;
      if (moonMesh) {
        const a = t * moonOrbit.speed + moonOrbit.phase;
        moonMesh.position.set(Math.cos(a) * moonOrbit.r, moonOrbit.y, Math.sin(a) * moonOrbit.r);
        moonMesh.rotation.y += dt * 0.25;
      }
      if (debris.isEnabled()) debris.rotation.y += dt * 0.08;
      if (wreck.isEnabled()) wreck.rotation.y += dt * 0.05;
      if (shield.isEnabled()) {
        shieldMat.alpha = shieldActive ? 0.16 + Math.sin(t * 6) * 0.07 : 0.07;
        shield.rotation.y += dt * 0.2;
      }
      if (yardGrp.isEnabled()) {
        // Верфь идёт по своей орбите — ниже станции и в другую сторону, иначе
        // два сооружения над одним миром слипаются в одну кляксу.
        const a = -t * 0.22 + stationPhase + 2.1;
        const r = baseRadius * 1.75;
        yardGrp.position.set(Math.cos(a) * r, -baseRadius * 0.3, Math.sin(a) * r);
        yardGrp.rotation.y = -a + Math.PI / 2;
      }
      if (stationGrp.isEnabled()) {
        const a = t * 0.35 + stationPhase;
        const r = baseRadius * 2.1;
        stationGrp.position.set(Math.cos(a) * r, baseRadius * 0.45, Math.sin(a) * r);
        stationGrp.rotation.y = -a;
        stRing.rotation.z += dt * 0.8;
      }
    },
    setOwner(hex: string) {
      const c = hexColor(hex);
      material.setColor3('uTint', c);
      atmoMat.setColor3('uColor', c);
    },
    setSelected(on: boolean) {
      selected = on;
      syncRing();
    },
    setHovered(on: boolean) {
      hovered = on;
      syncRing();
    },
    setGloom(on: boolean) {
      gloomShell.setEnabled(on && !inAbyss);
      gloomHaze.setEnabled(on && !inAbyss);
      // Дым скрывает саму планету.
      surfaceShown = !on && !inAbyss;
      atmo.setEnabled(surfaceShown);
      syncSurface();
    },
    setAbyss(on: boolean) {
      inAbyss = on;
      // Планета исчезает из реального пространства: видна лишь тёмная воронка.
      surfaceShown = !on;
      atmo.setEnabled(!on);
      abyssShell.setEnabled(on);
      if (on) {
        gloomShell.setEnabled(false);
        gloomHaze.setEnabled(false);
      }
      syncSurface();
      syncRing();
    },
    setShattered(on: boolean) {
      surfaceShown = !on;
      atmo.setEnabled(!on);
      debris.setEnabled(on);
      if (on) {
        gloomShell.setEnabled(false);
        gloomHaze.setEnabled(false);
        abyssShell.setEnabled(false);
      }
      syncSurface();
    },
    setBattle(on: boolean) {
      material.setFloat('uBattle', on ? 1 : 0);
    },
    setDim(v: number) {
      material.setFloat('uDim', v);
    },
    setScar(on: boolean) {
      material.setFloat('uScar', on ? 1 : 0);
    },
    setWreckage(amount: number) {
      const on = amount > 0.5 && surfaceShown;
      wreck.setEnabled(on);
      wreckMat.alpha = on ? Math.min(0.85, 0.25 + amount / 30) : 0;
    },
    setLod(octaves: number) {
      material.setFloat('uOct', octaves);
    },
    setDetail(level: number) {
      const want = Math.max(0, Math.min(SPHERE_LOD.length - 1, Math.round(level)));
      if (want === detailLevel) return;
      detailLevel = want;
      syncSurface();
    },
    setRelief(on: boolean) {
      if (!relief) return;
      reliefOn = on;
      syncSurface();
    },
    setShield(on: boolean, active: boolean) {
      shield.setEnabled(on && surfaceShown);
      shieldActive = active;
    },
    setStation(on: boolean) {
      stationGrp.setEnabled(on && surfaceShown);
    },
    setYard(on: boolean) {
      yardGrp.setEnabled(on && surfaceShown);
    },
  };
}
