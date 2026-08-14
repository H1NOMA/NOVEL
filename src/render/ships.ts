import * as THREE from 'three';
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
// ---------------------------------------------------------------------------

export type ShipClass = 'destroyer' | 'dreadnought' | 'battleship';

const HULL = new THREE.MeshLambertMaterial({ color: 0x9aa4b0 });
const HULL_DARK = new THREE.MeshLambertMaterial({ color: 0x525a66 });
const ORGANIC = new THREE.MeshLambertMaterial({ color: 0xb59a4a });
const ORGANIC_DARK = new THREE.MeshLambertMaterial({ color: 0x6e5a22 });

function accentMat(color: THREE.Color): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45 });
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(r1: number, r2: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 8), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  return m;
}

// --- Супер-Земля / Супер-Федерация -----------------------------------------

/** Супер-эсминец: канонический силуэт HD2. */
function superDestroyer(accent: THREE.Color): THREE.Group {
  const g = new THREE.Group();
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
function superDreadnought(accent: THREE.Color): THREE.Group {
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
  g.scale.setScalar(1.3);
  return g;
}

/** Линкор-флагман СЗ: таранный клюв, крылья-панели, тройной ряд двигателей. */
function superBattleship(accent: THREE.Color): THREE.Group {
  const g = superDestroyer(accent);
  const acc = accentMat(accent);
  // таранный клюв под носом
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.14, 4), HULL);
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
  g.scale.setScalar(1.6);
  return g;
}

// --- Автоматоны -------------------------------------------------------------

/** Угловатый корабль автоматонов. */
function automatonShip(accent: THREE.Color): THREE.Group {
  const g = new THREE.Group();
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
function automatonDreadnought(accent: THREE.Color): THREE.Group {
  const g = automatonShip(accent);
  const acc = accentMat(accent);
  for (const s of [-1, 1]) {
    const plate = box(0.032, 0.07, 0.13, HULL_DARK, s * 0.068, 0.02, -0.03);
    plate.rotation.z = -s * 0.2;
    g.add(plate);
  }
  g.add(box(0.04, 0.04, 0.05, HULL_DARK, 0, 0.05, 0.045));
  g.add(box(0.018, 0.018, 0.016, acc, 0, 0.05, 0.075)); // второй глаз
  g.scale.setScalar(1.3);
  return g;
}

/** Крепость машин: четыре клешни и массивный корпус-башня. */
function automatonBattleship(accent: THREE.Color): THREE.Group {
  const g = new THREE.Group();
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
  g.scale.setScalar(1.6);
  return g;
}

// --- Иллюминаты -------------------------------------------------------------

/** Блюдце иллюминатов со шпилем. */
function illuminateShip(accent: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const acc = accentMat(accent);
  const saucer = new THREE.Mesh(new THREE.SphereGeometry(0.09, 18, 12), HULL);
  saucer.scale.set(1, 0.3, 1.2);
  g.add(saucer);
  const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.007, 8, 26), acc);
  ringM.rotation.x = Math.PI / 2;
  g.add(ringM);
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.11, 6), acc);
  spike.position.y = 0.07;
  g.add(spike);
  return g;
}

/** Дредноут культа: двухъярусное блюдце с подвесным кристаллом. */
function illuminateDreadnought(accent: THREE.Color): THREE.Group {
  const g = illuminateShip(accent);
  const acc = accentMat(accent);
  const lower = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 10), HULL);
  lower.scale.set(1, 0.28, 1.15);
  lower.position.y = -0.035;
  g.add(lower);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.03), acc);
  crystal.position.y = -0.075;
  g.add(crystal);
  g.scale.setScalar(1.3);
  return g;
}

/** Ковчег-собор культа: три шпиля и двойное кольцо. */
function illuminateBattleship(accent: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const acc = accentMat(accent);
  const hull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), HULL);
  hull.scale.set(1, 0.36, 1.3);
  g.add(hull);
  for (const r of [0.13, 0.165]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 8, 30), acc);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
  }
  // тройка шпилей: центральный выше
  for (const [x, h] of [[0, 0.16], [-0.055, 0.1], [0.055, 0.1]] as const) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.016, h, 6), acc);
    spike.position.set(x, h / 2 + 0.02, -0.02);
    g.add(spike);
  }
  const keel = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.09, 6), acc);
  keel.rotation.x = Math.PI;
  keel.position.y = -0.07;
  g.add(keel);
  g.scale.setScalar(1.6);
  return g;
}

// --- Терминиды --------------------------------------------------------------

/** Живой споровоз терминидов. */
function terminidShip(accent: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const acc = accentMat(accent);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), ORGANIC);
  body.scale.set(1, 0.62, 1.55);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), ORGANIC_DARK);
  head.position.z = 0.105;
  g.add(head);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 4), ORGANIC_DARK);
    wing.rotation.z = (s * Math.PI) / 2;
    wing.scale.y = 1.2;
    wing.position.set(s * 0.1, 0, -0.02);
    g.add(wing);
  }
  const glowEye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), acc);
  glowEye.position.set(0, 0.02, 0.14);
  g.add(glowEye);
  return g;
}

/** Тяжёлый рой-носитель: четыре крыла и спинные шипы. */
function terminidDreadnought(accent: THREE.Color): THREE.Group {
  const g = terminidShip(accent);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.11, 4), ORGANIC_DARK);
    wing.rotation.z = (s * Math.PI) / 2;
    wing.rotation.y = s * 0.5;
    wing.position.set(s * 0.085, 0.01, -0.09);
    g.add(wing);
  }
  for (const z of [0.02, -0.04]) {
    const spine = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 5), ORGANIC_DARK);
    spine.position.set(0, 0.055, z);
    g.add(spine);
  }
  g.scale.setScalar(1.3);
  return g;
}

/** Матка роя: раздутое брюхо со свечением и гребень шипов. */
function terminidBattleship(accent: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const acc = accentMat(accent);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), ORGANIC);
  body.scale.set(1.1, 0.7, 1.6);
  g.add(body);
  // светящееся брюхо — выводковые камеры
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 9), acc);
  belly.scale.set(0.9, 0.45, 1.2);
  belly.position.y = -0.045;
  g.add(belly);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), ORGANIC_DARK);
  head.position.z = 0.15;
  g.add(head);
  // гребень шипов вдоль спины
  for (let i = 0; i < 4; i++) {
    const spine = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.08 - i * 0.012, 5), ORGANIC_DARK);
    spine.position.set(0, 0.075 - i * 0.008, 0.06 - i * 0.06);
    g.add(spine);
  }
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 4), ORGANIC_DARK);
    wing.rotation.z = (s * Math.PI) / 2;
    wing.scale.y = 1.3;
    wing.position.set(s * 0.13, 0, -0.03);
    g.add(wing);
  }
  g.scale.setScalar(1.55);
  return g;
}

// --- Сборка -----------------------------------------------------------------

/** Особая техника: орбитальная станция (сфера с экваториальным кольцом). */
export function stationModel(accent: THREE.Color): THREE.Group {
  const asset = stationAsset(accent);
  if (asset) return asset;
  const g = new THREE.Group();
  const acc = accentMat(accent);
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), HULL_DARK));
  const eq = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.014, 8, 30), acc);
  eq.rotation.x = Math.PI / 2;
  g.add(eq);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), acc);
  dish.position.z = 0.115;
  g.add(dish);
  return g;
}

const BUILDERS: Record<'se' | 'aut' | 'ill' | 'trm', Record<ShipClass, (c: THREE.Color) => THREE.Group>> = {
  se: { destroyer: superDestroyer, dreadnought: superDreadnought, battleship: superBattleship },
  aut: { destroyer: automatonShip, dreadnought: automatonDreadnought, battleship: automatonBattleship },
  ill: { destroyer: illuminateShip, dreadnought: illuminateDreadnought, battleship: illuminateBattleship },
  trm: { destroyer: terminidShip, dreadnought: terminidDreadnought, battleship: terminidBattleship },
};

/** Модель по фракции и классу тяжелейшего корпуса соединения. */
export function shipModel(faction: FactionId, color: THREE.Color, cls: ShipClass = 'destroyer'): THREE.Group {
  // Blender-модель (GLB), если загружена; иначе процедурный силуэт.
  const asset = shipAsset(faction, color, cls);
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
