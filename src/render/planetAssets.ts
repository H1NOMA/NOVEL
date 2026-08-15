import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BiomeId } from '../core/types';

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

export type ReliefId = 'mountain' | 'crater' | 'dune' | 'fracture' | 'volcanic' | 'smooth';

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
};

const geoms = new Map<string, THREE.BufferGeometry>();

/** Загрузка всех мешей миров; вызывается на экране загрузки до старта сцены. */
export function preloadPlanetModels(): Promise<void> {
  const loader = new GLTFLoader();
  const jobs = Object.entries(URLS).map(([key, url]) =>
    loader.loadAsync(url).then((g) => {
      let found: THREE.BufferGeometry | null = null;
      g.scene.traverse((o) => {
        if (!found && o instanceof THREE.Mesh) found = o.geometry as THREE.BufferGeometry;
      });
      if (found) {
        const geo = found as THREE.BufferGeometry;
        // Нормали в GLB не пишутся (экономия веса) — считаем их здесь.
        geo.computeVertexNormals();
        geoms.set(key, geo);
      }
    }).catch((e) => {
      console.warn(`Меш мира ${key} не загрузился, останется гладкая сфера:`, e);
    }));
  return Promise.all(jobs).then(() => undefined);
}

/** Какое семейство рельефа носит биом. Часть биомов делит два варианта —
 *  выбор закреплён за seed'ом мира, поэтому одинаковые планеты не рождаются. */
const BIOME_RELIEF: Record<BiomeId, ReliefId[]> = {
  terran: ['mountain', 'mountain', 'crater'],
  ocean: ['smooth', 'mountain'],
  desert: ['dune', 'dune', 'crater'],
  ice: ['fracture', 'crater'],
  volcanic: ['volcanic', 'mountain'],
  jungle: ['mountain'],
  gloom: ['mountain', 'dune'],
  barren: ['crater', 'crater', 'fracture'],
  toxic: ['mountain', 'dune'],
  gas: ['smooth'],
  magma: ['volcanic', 'volcanic', 'crater'],
};

/** Геометрия рельефа мира; null — модели нет (откат на гладкую сферу). */
export function reliefGeometry(biome: BiomeId, seed: number): THREE.BufferGeometry | null {
  const pool = BIOME_RELIEF[biome] ?? ['mountain'];
  const id = pool[Math.abs(seed) % pool.length]!;
  return geoms.get(id) ?? null;
}

export function ringGeometry(): THREE.BufferGeometry | null {
  return geoms.get('ring') ?? null;
}

export function moonGeometry(): THREE.BufferGeometry | null {
  return geoms.get('moon') ?? null;
}

export function asteroidGeometry(): THREE.BufferGeometry | null {
  return geoms.get('asteroid') ?? null;
}
