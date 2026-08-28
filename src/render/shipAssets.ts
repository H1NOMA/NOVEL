import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { FactionId } from '../core/types';
import type { ShipClass } from './ships';
import { loadVertexData, type ShapePart } from './gltf';
import { mixColor, SUN_DIR } from './engine';
import { HULL_ATTRS, HULL_UNIFORMS } from './hullShader';

// ---------------------------------------------------------------------------
// Настоящие 3D-модели флота, собранные в Blender (tools/blender/shipforge.py)
// и встроенные в бандл как GLB. Загружаются один раз на старте; каждый флот
// получает свои меши с фракционными материалами. Если модель по какой-то
// причине не загрузилась — рендер откатывается на процедурные силуэты.
//
// Поверхность корпуса считает процедурный шейдер (см. hullShader.ts): обшивка
// из панелей со швами, заклёпки, потёртости на кромках и копоть в углублениях.
// До этого корабль был ровно закрашенным куском металла — рядом с планетой, у
// которой девять октав шума и разворот нормали по высоте, он выглядел игрушкой.
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

const templates = new Map<string, ShapePart[]>();

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
export async function preloadShipModels(): Promise<void> {
  const jobs: Promise<void>[] = [];
  const put = (key: string, url: string): void => {
    jobs.push(loadVertexData(url)
      .then((parts) => { templates.set(key, parts); })
      .catch((e) => {
        console.warn(`Модель ${key} не загрузилась, останется процедурный силуэт:`, e);
      }));
  };
  for (const kind of Object.keys(URLS) as ShipKind[]) {
    for (const cls of Object.keys(URLS[kind]) as ShipClass[]) {
      put(`${kind}_${cls}`, URLS[kind][cls]);
    }
  }
  put('station', stationGlb);
  await Promise.all(jobs);
}

// --- Фракционные материалы --------------------------------------------------
// Имена материалов в GLB — контракт с shipforge.py: hull / dark / accent /
// glow / organic / organicDark. Материалы кэшируются по «роль + цвет»: иначе
// каждое соединение заводило бы свой, и шейдер компилировался бы заново на
// каждый новый флот.

interface HullLook {
  base: Color3;
  metal: number;
  rough: number;
  emissive: number;
  /** Масштаб обшивки: у эсминца плиты мельче, у флагмана крупнее. */
  panel: number;
  wear: number;
  organic: number;
}

const LOOKS: Record<string, HullLook> = {
  // Обшивка: светлый крашеный металл, плиты среднего размера, заметный износ.
  hull: { base: new Color3(0.62, 0.66, 0.71), metal: 0.55, rough: 0.42, emissive: 0, panel: 0.085, wear: 0.75, organic: 0 },
  // Тёмные узлы: надстройки, скобы двигателей — грязнее и матовее.
  dark: { base: new Color3(0.26, 0.29, 0.34), metal: 0.62, rough: 0.55, emissive: 0, panel: 0.05, wear: 0.95, organic: 0 },
  // Акцентные панели фракции: чище, полоса шире, немного светятся.
  accent: { base: new Color3(0.45, 0.48, 0.52), metal: 0.5, rough: 0.38, emissive: 0.35, panel: 0.07, wear: 0.45, organic: 0 },
  // Ходовые огни и сопла: светятся сильно, это их и подхватывает слой свечения.
  glow: { base: new Color3(0.8, 0.85, 0.95), metal: 0, rough: 0.25, emissive: 1.7, panel: 0.05, wear: 0, organic: 0 },
  // Хитин роя: не металл, а панцирь с сегментами и порами.
  organic: { base: new Color3(0.58, 0.49, 0.24), metal: 0.05, rough: 0.85, emissive: 0, panel: 0.09, wear: 0.5, organic: 1 },
  organicDark: { base: new Color3(0.33, 0.27, 0.11), metal: 0.05, rough: 0.9, emissive: 0, panel: 0.06, wear: 0.6, organic: 1 },
};

const hullCache = new Map<string, ShaderMaterial>();

function hullMaterial(scene: Scene, role: string, accent: Color3): ShaderMaterial {
  const key = `${role}_${accent.toHexString()}`;
  let m = hullCache.get(key);
  if (m) return m;
  const look = LOOKS[role] ?? LOOKS.hull!;
  m = new ShaderMaterial(`hull_${key}`, scene, 'hull', {
    attributes: HULL_ATTRS,
    uniforms: HULL_UNIFORMS,
  });
  // Акцентные и светящиеся детали красятся в цвет фракции целиком; обшивка
  // держит свой металл, а фракционный цвет получает только полосой по борту.
  const base = role === 'accent' ? mixColor(look.base, accent, 0.75)
    : role === 'glow' ? mixColor(accent, new Color3(1, 1, 1), 0.35)
    : look.base;
  m.setColor3('uBase', base);
  m.setColor3('uAccent', accent);
  m.setVector3('uSun', SUN_DIR);
  m.setFloat('uMetal', look.metal);
  m.setFloat('uRough', look.rough);
  m.setFloat('uEmissive', look.emissive);
  m.setFloat('uPanel', look.panel);
  m.setFloat('uWear', look.wear);
  m.setFloat('uOrganic', look.organic);
  hullCache.set(key, m);
  return m;
}

/** Какая роль у детали по имени её материала в GLB. */
function roleOf(name: string): string {
  if (name.startsWith('accent')) return 'accent';
  if (name.startsWith('glow')) return 'glow';
  if (name.startsWith('organicDark')) return 'organicDark';
  if (name.startsWith('organic')) return 'organic';
  if (name.startsWith('dark')) return 'dark';
  return 'hull';
}

/** Собрать узел модели из заготовки в цветах фракции. */
function build(scene: Scene, parts: ShapePart[], color: Color3, tag: string): TransformNode {
  const root = new TransformNode(tag, scene);
  for (const part of parts) {
    const mesh = new Mesh(`${tag}_${part.name}`, scene);
    part.data.applyToMesh(mesh);
    mesh.material = hullMaterial(scene, roleOf(part.name), color);
    mesh.parent = root;
    // Корабли мелкие и их много: отсечение по частям кадра стоит дороже, чем
    // сама отрисовка.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    // Ходовые огни должны попадать в слой свечения, корпуса — нет.
    if (part.name.startsWith('glow')) mesh.metadata = { glow: true };
  }
  return root;
}

/** Модель корабля в цветах фракции; null — модели нет (фолбэк). */
export function shipAsset(
  scene: Scene, faction: FactionId, color: Color3, cls: ShipClass,
): TransformNode | null {
  const parts = templates.get(`${factionKind(faction)}_${cls}`);
  return parts ? build(scene, parts, color, `ship_${cls}`) : null;
}

/** Модель станции в цветах фракции; null — фолбэк на процедурную. */
export function stationAsset(scene: Scene, color: Color3): TransformNode | null {
  const parts = templates.get('station');
  return parts ? build(scene, parts, color, 'station') : null;
}
