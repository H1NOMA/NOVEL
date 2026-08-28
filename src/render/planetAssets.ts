import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { BiomeId } from '../core/types';
import { loadVertexData } from './gltf';

// ---------------------------------------------------------------------------
// Рельефная геометрия миров, вытесненная в Blender (tools/blender/planetforge.py).
//
// Раньше планета была идеальной сферой и весь рельеф жил только в цвете —
// на лимбе мир оставался ровным кругом. Теперь у поверхности настоящая
// геометрия: горные пояса, кратерные чаши, дюны, ледяные плиты, лавовые
// борозды. Свет ложится по честным нормалям, силуэт изрезан.
//
// Вариативность не страдает: цвет по-прежнему считает шейдер из seed планеты
// (он берёт направление normalize(vObj), поэтому не зависит от вытеснения),
// а семейство рельефа подбирается по биому и seed'у.
//
// Хранятся именно VertexData, а не готовые меши: одна и та же горная порода
// достаётся десяткам миров, и каждый лепит из неё свой меш со своим материалом.
// ---------------------------------------------------------------------------

import mountainUrl from '../assets/planets/mountain.glb?url';
import craterUrl from '../assets/planets/crater.glb?url';
import duneUrl from '../assets/planets/dune.glb?url';
import fractureUrl from '../assets/planets/fracture.glb?url';
import volcanicUrl from '../assets/planets/volcanic.glb?url';
import smoothUrl from '../assets/planets/smooth.glb?url';
import ringUrl from '../assets/planets/ring.glb?url';
import moonUrl from '../assets/planets/moon.glb?url';
import asteroidUrl from '../assets/planets/asteroid.glb?url';
import canyonUrl from '../assets/planets/canyon.glb?url';
import archipelagoUrl from '../assets/planets/archipelago.glb?url';
import shardUrl from '../assets/planets/shard.glb?url';
import mesaUrl from '../assets/planets/mesa.glb?url';
import basinUrl from '../assets/planets/basin.glb?url';
import stormUrl from '../assets/planets/storm.glb?url';

export type ReliefId =
  | 'mountain' | 'crater' | 'dune' | 'fracture' | 'volcanic' | 'smooth'
  | 'canyon' | 'archipelago' | 'shard' | 'mesa' | 'basin' | 'storm';

const URLS: Record<string, string> = {
  mountain: mountainUrl,
  crater: craterUrl,
  dune: duneUrl,
  fracture: fractureUrl,
  volcanic: volcanicUrl,
  smooth: smoothUrl,
  ring: ringUrl,
  moon: moonUrl,
  asteroid: asteroidUrl,
  canyon: canyonUrl,
  archipelago: archipelagoUrl,
  shard: shardUrl,
  mesa: mesaUrl,
  basin: basinUrl,
  storm: stormUrl,
};

const shapes = new Map<string, VertexData>();

/** Загрузка всех мешей миров; вызывается на экране загрузки до старта сцены. */
export async function preloadPlanetModels(): Promise<void> {
  await Promise.all(Object.entries(URLS).map(async ([key, url]) => {
    try {
      const parts = await loadVertexData(url);
      // В glb мира одна оболочка: берём первую и считаем нормали — в файл они
      // не пишутся ради веса.
      const vd = parts[0]?.data;
      if (vd?.positions && vd.indices) {
        // Нормали в GLB не пишутся ради веса — считаем их здесь.
        const normals: number[] = [];
        VertexData.ComputeNormals(vd.positions, vd.indices, normals);
        vd.normals = normals;
        shapes.set(key, vd);
      }
    } catch (e) {
      console.warn(`Меш мира ${key} не загрузился, останется гладкая сфера:`, e);
    }
  }));
}

/** Какое семейство рельефа носит биом. Часть биомов делит два варианта —
 *  выбор закреплён за seed'ом мира, поэтому одинаковые планеты не рождаются. */
const BIOME_RELIEF: Record<BiomeId, ReliefId[]> = {
  terran: ['mountain', 'canyon', 'mesa', 'crater', 'archipelago'],
  ocean: ['archipelago', 'smooth', 'archipelago', 'basin'],
  desert: ['dune', 'mesa', 'canyon', 'dune', 'crater'],
  ice: ['fracture', 'shard', 'basin', 'crater'],
  volcanic: ['volcanic', 'canyon', 'shard', 'mesa'],
  jungle: ['mountain', 'archipelago', 'canyon'],
  gloom: ['mountain', 'dune', 'basin', 'mesa'],
  barren: ['crater', 'basin', 'shard', 'fracture', 'mesa'],
  toxic: ['mountain', 'dune', 'canyon', 'basin'],
  gas: ['storm', 'smooth', 'storm'],
  magma: ['volcanic', 'canyon', 'shard', 'crater'],
};

/** Геометрия рельефа мира; null — модели нет (откат на гладкую сферу). */
export function reliefShape(biome: BiomeId, seed: number): VertexData | null {
  const pool = BIOME_RELIEF[biome] ?? ['mountain'];
  const id = pool[Math.abs(seed) % pool.length]!;
  return shapes.get(id) ?? null;
}

export function ringShape(): VertexData | null {
  return shapes.get('ring') ?? null;
}

export function moonShape(): VertexData | null {
  return shapes.get('moon') ?? null;
}
