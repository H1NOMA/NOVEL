import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { FactionId } from '../core/types';
import { shipAsset, stationAsset } from './shipAssets';

// ---------------------------------------------------------------------------
// Процедурные low-poly модели кораблей. Супер-эсминец собран по каноничному
// силуэту Helldivers 2: вытянутый корпус с широкой средней частью (грузовые
// отсеки), мостик в передней части, нос из трёх пилонов (центральный длиннее,
// с антенной) и корма с блоком двигателей в двух скобообразных панелях.
// Нос модели смотрит в +Z.
//
// У каждой фракции — три класса с различимым силуэтом:
//   • эсминец — базовый корпус;
//   • дредноут — шире, тяжелее, дополнительное вооружение (×1.3);
//   • линкор-флагман — самый крупный, с уникальными деталями (×1.6).
//
// Всё это — ФОЛБЭК: сначала спрашивается модель из Blender, и только если её
// нет, силуэт собирается здесь из примитивов. Поэтому пропорции ниже
// перенесены с прежнего движка до последней цифры.
// ---------------------------------------------------------------------------

export type ShipClass = 'destroyer' | 'dreadnought' | 'battleship';

/**
 * Узел с методом add().
 *
 * У Babylon дерево сцены строится присваиванием child.parent, а не вызовом
 * parent.add(child). Тонкая надстройка над TransformNode позволяет оставить
 * двести пятьдесят строк выверенной геометрии кораблей ровно такими, какими
 * они были: при переносе силуэты не должны «поплыть» из-за перестановки строк.
 */
class Node3D extends TransformNode {
  constructor() {
    super('ship', activeScene());
  }
  add(...children: TransformNode[]): void {
    for (const c of children) c.parent = this;
  }
}

// Сцена, в которой лепятся модели. Ставится один раз при старте рендера:
// таскать её параметром через полсотни вложенных функций-сборщиков — шум,
// который ничего не даёт, сцена в игре всегда одна.
let scene: Scene | null = null;
export function useScene(s: Scene): void {
  scene = s;
  mats = null;
}
function activeScene(): Scene {
  if (!scene) throw new Error('ships: сцена не задана, вызовите useScene()');
  return scene;
}

// --- Материалы --------------------------------------------------------------
// Заводятся лениво и живут до конца партии: у корпусов свои константы, у
// акцентов — кэш по цвету, иначе каждое соединение компилировало бы шейдер
// заново.

interface Mats { hull: PBRMaterial; dark: PBRMaterial; organic: PBRMaterial; organicDark: PBRMaterial }
let mats: Mats | null = null;

function pbr(name: string, r: number, g: number, b: number, metal: number, rough: number): PBRMaterial {
  const m = new PBRMaterial(name, activeScene());
  m.albedoColor = new Color3(r, g, b);
  m.metallic = metal;
  m.roughness = rough;
  // Без карты окружения металл чернеет: подмешиваем ровный отражённый свет,
  // иначе корпуса на чёрном космосе превращаются в силуэты.
  m.environmentIntensity = 0.55;
  return m;
}

function base(): Mats {
  if (!mats) {
    mats = {
      hull: pbr('pHull', 0.60, 0.64, 0.69, 0.30, 0.55),
      dark: pbr('pDark', 0.32, 0.35, 0.40, 0.35, 0.60),
      organic: pbr('pOrganic', 0.71, 0.60, 0.29, 0.05, 0.85),
      organicDark: pbr('pOrganicDark', 0.43, 0.35, 0.13, 0.05, 0.75),
    };
  }
  return mats;
}

const HULL = { get m() { return base().hull } };
const HULL_DARK = { get m() { return base().dark } };
const ORGANIC = { get m() { return base().organic } };
const ORGANIC_DARK = { get m() { return base().organicDark } };

const accentCache = new Map<string, PBRMaterial>();
function accentMat(color: Color3): PBRMaterial {
  const key = color.toHexString();
  let m = accentCache.get(key);
  if (!m) {
    m = pbr(`pAcc_${key}`, color.r, color.g, color.b, 0.30, 0.50);
    // Ярче нуля намеренно: акцент подхватывает слой свечения и делает
    // фракционную полосу видимой с общего плана.
    m.emissiveColor = color.scale(0.45);
    accentCache.set(key, m);
    m.metadata = { glow: true };
  }
  return m;
}

/** Материал из ленивой обёртки или напрямую. */
type MatRef = Material | { m: Material };
function matOf(m: MatRef): Material {
  return 'm' in m ? m.m : m;
}

function mesh(m: Mesh, mat: MatRef): Mesh {
  m.material = matOf(mat);
  m.isPickable = false;
  m.alwaysSelectAsActiveMesh = true;
  return m;
}

function box(w: number, h: number, d: number, mat: MatRef, x = 0, y = 0, z = 0): Mesh {
  const m = mesh(CreateBox('b', { width: w, height: h, depth: d }, activeScene()), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(r1: number, r2: number, h: number, mat: MatRef, x = 0, y = 0, z = 0, rx = 0): Mesh {
  const m = mesh(CreateCylinder('c', {
    diameterTop: r1 * 2, diameterBottom: r2 * 2, height: h, tessellation: 8,
  }, activeScene()), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  return m;
}

function sphere(r: number, mat: MatRef): Mesh {
  return mesh(CreateSphere('s', { diameter: r * 2, segments: 12 }, activeScene()), mat);
}

function torus(r: number, tube: number, mat: MatRef): Mesh {
  return mesh(CreateTorus('t', {
    diameter: r * 2, thickness: tube * 2, tessellation: 26,
  }, activeScene()), mat);
}

function cone(r: number, h: number, mat: MatRef): Mesh {
  return mesh(CreateCylinder('n', {
    diameterTop: 0, diameterBottom: r * 2, height: h, tessellation: 6,
  }, activeScene()), mat);
}

function octa(r: number, mat: MatRef): Mesh {
  return mesh(CreatePolyhedron('o', { type: 1, size: r }, activeScene()), mat);
}

// --- Супер-Земля / Супер-Федерация -----------------------------------------

/** Супер-эсминец: канонический силуэт HD2. */
function superDestroyer(accent: Color3): Node3D {
  const g = new Node3D();
  const acc = accentMat(accent);
  // корпус + широкая средняя часть с отсеками
  g.add(box(0.07, 0.045, 0.3, HULL));
  g.add(box(0.115, 0.028, 0.13, HULL_DARK, 0, -0.004, -0.01));
  // мостик в передней части
  g.add(box(0.048, 0.032, 0.05, HULL, 0, 0.035, 0.075));
  // нос: три пилона, центральный длиннее и выше
  g.add(box(0.016, 0.016, 0.17, HULL, 0, 0.012, 0.2));
  g.add(box(0.013, 0.013, 0.12, HULL_DARK, 0.032, 0, 0.185));
  g.add(box(0.013, 0.013, 0.12, HULL_DARK, -0.032, 0, 0.185));
  // антенна на центральном пилоне
  g.add(cyl(0.0022, 0.0022, 0.045, HULL_DARK, 0, 0.04, 0.283));
  // корма: две скобообразные панели + сопла
  g.add(box(0.02, 0.062, 0.075, HULL_DARK, 0.055, 0, -0.135));
  g.add(box(0.02, 0.062, 0.075, HULL_DARK, -0.055, 0, -0.135));
  for (const x of [-0.028, 0, 0.028]) {
    g.add(cyl(0.011, 0.015, 0.035, acc, x, 0, -0.165, Math.PI / 2));
  }
  // фракционная полоса на корпусе
  g.add(box(0.072, 0.047, 0.028, acc, 0, 0, 0.03));
  return g;
}

/** Дредноут СЗ: шире эсминца, бортовые спонсоны с батареями. */
function superDreadnought(accent: Color3): Node3D {
  const g = superDestroyer(accent);
  const acc = accentMat(accent);
  // бортовые спонсоны с орудийными блоками
  for (const s of [-1, 1]) {
    g.add(box(0.03, 0.03, 0.16, HULL, s * 0.075, 0.008, -0.02));
    g.add(cyl(0.006, 0.006, 0.05, HULL_DARK, s * 0.075, 0.026, 0.05));
  }
  // второй ярус мостика
  g.add(box(0.034, 0.022, 0.034, HULL_DARK, 0, 0.06, 0.06));
  g.add(box(0.05, 0.012, 0.02, acc, 0, -0.03, -0.06));
  g.scaling.setAll(1.3);
  return g;
}

/** Линкор-флагман СЗ: таранный клюв, крылья-панели, тройной ряд двигателей. */
function superBattleship(accent: Color3): Node3D {
  const g = superDestroyer(accent);
  const acc = accentMat(accent);
  // таранный клюв под носом
  const beak = cone(0.024, 0.14, HULL);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.02, 0.26);
  g.add(beak);
  // крылья-панели по бортам
  for (const s of [-1, 1]) {
    const wing = box(0.11, 0.008, 0.14, HULL_DARK, s * 0.1, -0.01, -0.05);
    wing.rotation.z = s * 0.16;
    g.add(wing);
    g.add(box(0.02, 0.02, 0.1, acc, s * 0.145, 0.012, -0.06));
  }
  // усиленная корма — пять сопел
  for (const x of [-0.05, -0.025, 0, 0.025, 0.05]) {
    g.add(cyl(0.009, 0.013, 0.03, acc, x, -0.012, -0.168, Math.PI / 2));
  }
  g.scaling.setAll(1.6);
  return g;
}

// --- Автоматоны -------------------------------------------------------------

/** Угловатый корабль автоматонов. */
function automatonShip(accent: Color3): Node3D {
  const g = new Node3D();
  const acc = accentMat(accent);
  g.add(box(0.09, 0.055, 0.24, HULL_DARK));
  g.add(box(0.05, 0.05, 0.06, HULL_DARK, 0, 0.05, -0.05)); // башня
  g.add(box(0.02, 0.02, 0.13, HULL_DARK, 0.062, 0, 0.07)); // клешни
  g.add(box(0.02, 0.02, 0.13, HULL_DARK, -0.062, 0, 0.07));
  g.add(box(0.024, 0.024, 0.02, acc, 0, 0.05, -0.017)); // глаз
  for (const x of [-0.03, 0.03]) g.add(cyl(0.013, 0.017, 0.035, acc, x, 0, -0.135, Math.PI / 2));
  return g;
}

/** Дредноут машин: наплечные плиты брони и вторая башня. */
function automatonDreadnought(accent: Color3): Node3D {
  const g = automatonShip(accent);
  const acc = accentMat(accent);
  for (const s of [-1, 1]) {
    const plate = box(0.032, 0.07, 0.13, HULL_DARK, s * 0.068, 0.02, -0.03);
    plate.rotation.z = -s * 0.2;
    g.add(plate);
  }
  g.add(box(0.04, 0.04, 0.05, HULL_DARK, 0, 0.05, 0.045));
  g.add(box(0.018, 0.018, 0.016, acc, 0, 0.05, 0.075)); // второй глаз
  g.scaling.setAll(1.3);
  return g;
}

/** Крепость машин: четыре клешни и массивный корпус-башня. */
function automatonBattleship(accent: Color3): Node3D {
  const g = new Node3D();
  const acc = accentMat(accent);
  g.add(box(0.13, 0.075, 0.28, HULL_DARK));
  g.add(box(0.08, 0.07, 0.09, HULL_DARK, 0, 0.07, -0.05));
  g.add(box(0.035, 0.035, 0.024, acc, 0, 0.075, 0.0)); // главный глаз
  // четыре клешни-манипулятора
  for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const claw = box(0.022, 0.022, 0.17, HULL_DARK, sx * 0.085, sy * 0.028, 0.1);
    claw.rotation.y = sx * -0.12;
    g.add(claw);
    g.add(box(0.03, 0.014, 0.04, HULL_DARK, sx * 0.1, sy * 0.028, 0.19));
  }
  for (const x of [-0.045, 0, 0.045]) g.add(cyl(0.016, 0.02, 0.04, acc, x, 0, -0.16, Math.PI / 2));
  g.scaling.setAll(1.6);
  return g;
}

// --- Иллюминаты -------------------------------------------------------------

/** Блюдце иллюминатов со шпилем. */
function illuminateShip(accent: Color3): Node3D {
  const g = new Node3D();
  const acc = accentMat(accent);
  const saucer = sphere(0.09, HULL);
  saucer.scaling.set(1, 0.3, 1.2);
  g.add(saucer);
  const ringM = torus(0.105, 0.007, acc);
  ringM.rotation.x = Math.PI / 2;
  g.add(ringM);
  const spike = cone(0.018, 0.11, acc);
  spike.position.y = 0.07;
  g.add(spike);
  return g;
}

/** Дредноут культа: двухъярусное блюдце с подвесным кристаллом. */
function illuminateDreadnought(accent: Color3): Node3D {
  const g = illuminateShip(accent);
  const acc = accentMat(accent);
  const lower = sphere(0.065, HULL);
  lower.scaling.set(1, 0.28, 1.15);
  lower.position.y = -0.035;
  g.add(lower);
  const crystal = octa(0.03, acc);
  crystal.position.y = -0.075;
  g.add(crystal);
  g.scaling.setAll(1.3);
  return g;
}

/** Ковчег-собор культа: три шпиля и двойное кольцо. */
function illuminateBattleship(accent: Color3): Node3D {
  const g = new Node3D();
  const acc = accentMat(accent);
  const hull = sphere(0.11, HULL);
  hull.scaling.set(1, 0.36, 1.3);
  g.add(hull);
  for (const r of [0.13, 0.165]) {
    const ring = torus(r, 0.006, acc);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
  }
  // тройка шпилей: центральный выше
  for (const [x, h] of [[0, 0.16], [-0.055, 0.1], [0.055, 0.1]] as const) {
    const spike = cone(0.016, h, acc);
    spike.position.set(x, h / 2 + 0.02, -0.02);
    g.add(spike);
  }
  const keel = cone(0.02, 0.09, acc);
  keel.rotation.x = Math.PI;
  keel.position.y = -0.07;
  g.add(keel);
  g.scaling.setAll(1.6);
  return g;
}

// --- Терминиды --------------------------------------------------------------

/** Живой споровоз терминидов. */
function terminidShip(accent: Color3): Node3D {
  const g = new Node3D();
  const acc = accentMat(accent);
  const body = sphere(0.075, ORGANIC);
  body.scaling.set(1, 0.62, 1.55);
  g.add(body);
  const head = sphere(0.045, ORGANIC_DARK);
  head.position.z = 0.105;
  g.add(head);
  for (const s of [-1, 1]) {
    const wing = cone(0.045, 0.13, ORGANIC_DARK);
    wing.rotation.z = (s * Math.PI) / 2;
    wing.scaling.y = 1.2;
    wing.position.set(s * 0.1, 0, -0.02);
    g.add(wing);
  }
  const glowEye = sphere(0.014, acc);
  glowEye.position.set(0, 0.02, 0.14);
  g.add(glowEye);
  return g;
}

/** Тяжёлый рой-носитель: четыре крыла и спинные шипы. */
function terminidDreadnought(accent: Color3): Node3D {
  const g = terminidShip(accent);
  for (const s of [-1, 1]) {
    const wing = cone(0.04, 0.11, ORGANIC_DARK);
    wing.rotation.z = (s * Math.PI) / 2;
    wing.rotation.y = s * 0.5;
    wing.position.set(s * 0.085, 0.01, -0.09);
    g.add(wing);
  }
  for (const z of [0.02, -0.04]) {
    const spine = cone(0.012, 0.06, ORGANIC_DARK);
    spine.position.set(0, 0.055, z);
    g.add(spine);
  }
  g.scaling.setAll(1.3);
  return g;
}

/** Матка роя: раздутое брюхо со свечением и гребень шипов. */
function terminidBattleship(accent: Color3): Node3D {
  const g = new Node3D();
  const acc = accentMat(accent);
  const body = sphere(0.1, ORGANIC);
  body.scaling.set(1.1, 0.7, 1.6);
  g.add(body);
  // светящееся брюхо — выводковые камеры
  const belly = sphere(0.075, acc);
  belly.scaling.set(0.9, 0.45, 1.2);
  belly.position.y = -0.045;
  g.add(belly);
  const head = sphere(0.055, ORGANIC_DARK);
  head.position.z = 0.15;
  g.add(head);
  // гребень шипов вдоль спины
  for (let i = 0; i < 4; i++) {
    const spine = cone(0.016, 0.08 - i * 0.012, ORGANIC_DARK);
    spine.position.set(0, 0.075 - i * 0.008, 0.06 - i * 0.06);
    g.add(spine);
  }
  for (const s of [-1, 1]) {
    const wing = cone(0.055, 0.16, ORGANIC_DARK);
    wing.rotation.z = (s * Math.PI) / 2;
    wing.scaling.y = 1.3;
    wing.position.set(s * 0.13, 0, -0.03);
    g.add(wing);
  }
  g.scaling.setAll(1.55);
  return g;
}

// --- Сборка -----------------------------------------------------------------

/** Особая техника: орбитальная станция (сфера с экваториальным кольцом). */
export function stationModel(accent: Color3): TransformNode {
  const asset = stationAsset(activeScene(), accent);
  if (asset) return asset;
  const g = new Node3D();
  const acc = accentMat(accent);
  g.add(sphere(0.13, HULL_DARK));
  const eq = torus(0.165, 0.014, acc);
  eq.rotation.x = Math.PI / 2;
  g.add(eq);
  const dish = sphere(0.045, acc);
  dish.position.z = 0.115;
  g.add(dish);
  return g;
}

const BUILDERS: Record<'se' | 'aut' | 'ill' | 'trm', Record<ShipClass, (c: Color3) => Node3D>> = {
  se: { destroyer: superDestroyer, dreadnought: superDreadnought, battleship: superBattleship },
  aut: { destroyer: automatonShip, dreadnought: automatonDreadnought, battleship: automatonBattleship },
  ill: { destroyer: illuminateShip, dreadnought: illuminateDreadnought, battleship: illuminateBattleship },
  trm: { destroyer: terminidShip, dreadnought: terminidDreadnought, battleship: terminidBattleship },
};

/** Модель по фракции и классу тяжелейшего корпуса соединения. */
export function shipModel(faction: FactionId, color: Color3, cls: ShipClass = 'destroyer'): TransformNode {
  // Blender-модель (GLB), если загружена; иначе процедурный силуэт.
  const asset = shipAsset(activeScene(), faction, color, cls);
  if (asset) return asset;
  switch (faction) {
    case 'superEarth':
    case 'superFederation':
      return BUILDERS.se[cls](color);
    case 'automatons':
      return BUILDERS.aut[cls](color);
    case 'illuminate':
      return BUILDERS.ill[cls](color);
    case 'terminids':
      return BUILDERS.trm[cls](color);
  }
}
