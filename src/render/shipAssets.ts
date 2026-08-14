import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FactionId } from '../core/types';
import type { ShipClass } from './ships';

// ---------------------------------------------------------------------------
// Настоящие 3D-модели флота, собранные в Blender (tools/blender/shipforge.py)
// и встроенные в бандл как GLB. Загружаются один раз на старте; каждый флот
// получает клон шаблона с фракционными материалами. Если модель по какой-то
// причине не загрузилась — рендер откатывается на процедурные силуэты.
// ---------------------------------------------------------------------------

import seDestroyer from '../assets/ships/se_destroyer.glb?url';
import seDreadnought from '../assets/ships/se_dreadnought.glb?url';
import seBattleship from '../assets/ships/se_battleship.glb?url';
import autDestroyer from '../assets/ships/aut_destroyer.glb?url';
import autDreadnought from '../assets/ships/aut_dreadnought.glb?url';
import autBattleship from '../assets/ships/aut_battleship.glb?url';
import illDestroyer from '../assets/ships/ill_destroyer.glb?url';
import illDreadnought from '../assets/ships/ill_dreadnought.glb?url';
import illBattleship from '../assets/ships/ill_battleship.glb?url';
import trmDestroyer from '../assets/ships/trm_destroyer.glb?url';
import trmDreadnought from '../assets/ships/trm_dreadnought.glb?url';
import trmBattleship from '../assets/ships/trm_battleship.glb?url';
import stationGlb from '../assets/ships/station.glb?url';

export type ShipKind = 'se' | 'aut' | 'ill' | 'trm';

const URLS: Record<ShipKind, Record<ShipClass, string>> = {
  se: { destroyer: seDestroyer, dreadnought: seDreadnought, battleship: seBattleship },
  aut: { destroyer: autDestroyer, dreadnought: autDreadnought, battleship: autBattleship },
  ill: { destroyer: illDestroyer, dreadnought: illDreadnought, battleship: illBattleship },
  trm: { destroyer: trmDestroyer, dreadnought: trmDreadnought, battleship: trmBattleship },
};

const templates = new Map<string, THREE.Group>();

/**
 * Схлопнуть десятки деталей модели в ≤6 мешей — по одному на материал.
 * Иначе каждый флот стоил бы сотни draw-call'ов.
 */
function consolidate(scene: THREE.Group): THREE.Group {
  scene.updateMatrixWorld(true);
  const byMat = new Map<string, THREE.BufferGeometry[]>();
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const name = ((o.material as THREE.Material)?.name ?? 'hull').replace(/\.\d+$/, '');
    const g = (o.geometry as THREE.BufferGeometry).clone();
    g.applyMatrix4(o.matrixWorld);
    // Текстур нет — достаточно позиций и нормалей (и merge не споткнётся
    // о несовпадающие наборы атрибутов).
    for (const attr of Object.keys(g.attributes)) {
      if (attr !== 'position' && attr !== 'normal') g.deleteAttribute(attr);
    }
    if (!byMat.has(name)) byMat.set(name, []);
    byMat.get(name)!.push(g);
  });
  const root = new THREE.Group();
  for (const [name, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, HULL);
    mesh.userData.matName = name;
    root.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  return root;
}

export function factionKind(faction: FactionId): ShipKind {
  switch (faction) {
    case 'superEarth':
    case 'superFederation':
      return 'se';
    case 'automatons':
      return 'aut';
    case 'illuminate':
      return 'ill';
    case 'terminids':
      return 'trm';
  }
}

/** Однократная загрузка всех шаблонов (вызывается до старта сцены). */
export function preloadShipModels(): Promise<void> {
  const loader = new GLTFLoader();
  const jobs: Promise<void>[] = [];
  const put = (key: string, url: string): void => {
    jobs.push(loader.loadAsync(url).then((g) => {
      templates.set(key, consolidate(g.scene));
    }).catch((e) => {
      console.warn(`Модель ${key} не загрузилась, останется процедурный силуэт:`, e);
    }));
  };
  for (const kind of Object.keys(URLS) as ShipKind[]) {
    for (const cls of Object.keys(URLS[kind]) as ShipClass[]) {
      put(`${kind}_${cls}`, URLS[kind][cls]);
    }
  }
  put('station', stationGlb);
  return Promise.all(jobs).then(() => undefined);
}

// --- Фракционные материалы --------------------------------------------------
// Имена материалов в GLB — контракт с shipforge.py: hull / dark / accent /
// glow / organic / organicDark. Базовые общие, акцентные кэшируются по цвету.

// Без env-карты высокая металличность чернит корпуса — держим её умеренной.
const HULL = new THREE.MeshStandardMaterial({ color: 0xaeb7c2, metalness: 0.3, roughness: 0.5 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x59616d, metalness: 0.35, roughness: 0.6 });
const ORGANIC = new THREE.MeshStandardMaterial({ color: 0xb59a4a, metalness: 0.05, roughness: 0.85 });
const ORGANIC_DARK = new THREE.MeshStandardMaterial({ color: 0x6e5a22, metalness: 0.05, roughness: 0.75 });

const accentCache = new Map<string, THREE.MeshStandardMaterial>();
const glowCache = new Map<string, THREE.MeshStandardMaterial>();

function accentFor(color: THREE.Color): THREE.MeshStandardMaterial {
  const key = color.getHexString();
  let m = accentCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.5,
    });
    accentCache.set(key, m);
  }
  return m;
}

function glowFor(color: THREE.Color): THREE.MeshStandardMaterial {
  const key = color.getHexString();
  let m = glowCache.get(key);
  if (!m) {
    const c = color.clone().lerp(new THREE.Color(0xffffff), 0.35);
    m = new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 1.6, metalness: 0, roughness: 0.4,
    });
    glowCache.set(key, m);
  }
  return m;
}

function skin(root: THREE.Group, color: THREE.Color): void {
  const accent = accentFor(color);
  const glow = glowFor(color);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const name = (o.userData.matName as string | undefined)
      ?? (o.material as THREE.Material)?.name ?? '';
    if (name.startsWith('accent')) o.material = accent;
    else if (name.startsWith('glow')) o.material = glow;
    else if (name.startsWith('organicDark')) o.material = ORGANIC_DARK;
    else if (name.startsWith('organic')) o.material = ORGANIC;
    else if (name.startsWith('dark')) o.material = DARK;
    else o.material = HULL;
  });
}

/** Клон загруженного шаблона в цветах фракции; null — модели нет (фолбэк). */
export function shipAsset(faction: FactionId, color: THREE.Color, cls: ShipClass): THREE.Group | null {
  const tpl = templates.get(`${factionKind(faction)}_${cls}`);
  if (!tpl) return null;
  const clone = tpl.clone(true);
  skin(clone, color);
  return clone;
}

/** Клон станции в цветах фракции; null — фолбэк на процедурную. */
export function stationAsset(color: THREE.Color): THREE.Group | null {
  const tpl = templates.get('station');
  if (!tpl) return null;
  const clone = tpl.clone(true);
  skin(clone, color);
  return clone;
}
