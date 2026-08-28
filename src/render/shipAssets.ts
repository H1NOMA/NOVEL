import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { FactionId } from '../core/types';
import type { ShipClass } from './ships';
import { loadVertexData, type ShapePart } from './gltf';
import { mixColor } from './engine';

// ---------------------------------------------------------------------------
// Настоящие 3D-модели флота, собранные в Blender (tools/blender/shipforge.py)
// и встроенные в бандл как GLB. Загружаются один раз на старте; каждый флот
// получает свои меши с фракционными материалами. Если модель по какой-то
// причине не загрузилась — рендер откатывается на процедурные силуэты.
//
// Материалы теперь PBR, а не приблизительный Standard: у корпусов появились
// честная металличность и шероховатость, поэтому свет ложится на броню как на
// металл, а не как на крашеный картон.
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
// glow / organic / organicDark. Базовые общие, акцентные кэшируются по цвету:
// иначе каждое соединение заводило бы свой материал и шейдер компилировался бы
// заново на каждый новый флот.

let baseMats: Record<string, PBRMaterial> | null = null;

function pbr(scene: Scene, name: string, color: Color3, metallic: number, rough: number): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = color;
  m.metallic = metallic;
  m.roughness = rough;
  // Без карты окружения металл чернеет: подмешиваем ровный отражённый свет,
  // иначе корпуса на чёрном космосе превращаются в силуэты.
  m.ambientColor = new Color3(0.16, 0.18, 0.22);
  m.environmentIntensity = 0.55;
  return m;
}

function bases(scene: Scene): Record<string, PBRMaterial> {
  if (baseMats) return baseMats;
  baseMats = {
    hull: pbr(scene, 'shipHull', new Color3(0.68, 0.72, 0.76), 0.30, 0.50),
    dark: pbr(scene, 'shipDark', new Color3(0.35, 0.38, 0.43), 0.35, 0.60),
    organic: pbr(scene, 'shipOrganic', new Color3(0.71, 0.60, 0.29), 0.05, 0.85),
    organicDark: pbr(scene, 'shipOrganicDark', new Color3(0.43, 0.35, 0.13), 0.05, 0.75),
  };
  return baseMats;
}

const accentCache = new Map<string, PBRMaterial>();
const glowCache = new Map<string, PBRMaterial>();

function accentFor(scene: Scene, color: Color3): PBRMaterial {
  const key = color.toHexString();
  let m = accentCache.get(key);
  if (!m) {
    m = pbr(scene, `accent_${key}`, color, 0.30, 0.50);
    m.emissiveColor = color.scale(0.55);
    accentCache.set(key, m);
  }
  return m;
}

function glowFor(scene: Scene, color: Color3): PBRMaterial {
  const key = color.toHexString();
  let m = glowCache.get(key);
  if (!m) {
    const c = mixColor(color, new Color3(1, 1, 1), 0.35);
    m = pbr(scene, `glow_${key}`, c, 0, 0.40);
    // Ярче единицы намеренно: именно это подхватывает слой свечения и делает
    // ходовые огни видимыми с общего плана.
    m.emissiveColor = c.scale(1.6);
    glowCache.set(key, m);
  }
  return m;
}

function materialFor(scene: Scene, name: string, color: Color3): PBRMaterial {
  const b = bases(scene);
  if (name.startsWith('accent')) return accentFor(scene, color);
  if (name.startsWith('glow')) return glowFor(scene, color);
  if (name.startsWith('organicDark')) return b.organicDark!;
  if (name.startsWith('organic')) return b.organic!;
  if (name.startsWith('dark')) return b.dark!;
  return b.hull!;
}

/** Собрать узел модели из заготовки в цветах фракции. */
function build(scene: Scene, parts: ShapePart[], color: Color3, tag: string): TransformNode {
  const root = new TransformNode(tag, scene);
  for (const part of parts) {
    const mesh = new Mesh(`${tag}_${part.name}`, scene);
    part.data.applyToMesh(mesh);
    mesh.material = materialFor(scene, part.name, color);
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
