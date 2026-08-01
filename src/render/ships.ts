import * as THREE from 'three';
import type { FactionId } from '../core/types';

// ---------------------------------------------------------------------------
// Процедурные low-poly модели кораблей. Супер-эсминец собран по каноничному
// силуэту Helldivers 2: вытянутый корпус с широкой средней частью (грузовые
// отсеки), мостик в передней части, нос из трёх пилонов (центральный длиннее,
// с антенной) и корма с блоком двигателей в двух скобообразных панелях.
// Нос модели смотрит в +Z.
// ---------------------------------------------------------------------------

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

/** Супер-эсминец Супер-Земли (и дредноут Федерации — в своём цвете). */
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

/** Особая техника: орбитальная станция (сфера с экваториальным кольцом). */
export function stationModel(accent: THREE.Color): THREE.Group {
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

export function shipModel(faction: FactionId, color: THREE.Color): THREE.Group {
  switch (faction) {
    case 'superEarth':
    case 'superFederation':
      return superDestroyer(color);
    case 'automatons':
      return automatonShip(color);
    case 'illuminate':
      return illuminateShip(color);
    case 'terminids':
      return terminidShip(color);
  }
}
