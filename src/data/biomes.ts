import type { BiomeId } from '../core/types';

export interface BiomeDef {
  id: BiomeId;
  label: string;
  /** Base surface colours for the procedural planet shader (hex). */
  land: string;
  sea: string;
  /** Atmosphere rim colour. */
  atmo: string;
  /** How much sea vs land: 0 = all land, 1 = ocean world. */
  water: number;
  /** Surface roughness for terrain fbm. */
  rough: number;
  /** Cloud coverage 0..1. */
  clouds: number;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  terran: { id: 'terran', label: 'Земной', land: '#4a7a3a', sea: '#1d4e7a', atmo: '#7fc4ff', water: 0.55, rough: 0.5, clouds: 0.45 },
  ocean: { id: 'ocean', label: 'Океанический', land: '#2e6b5a', sea: '#123f6e', atmo: '#6fd0ff', water: 0.82, rough: 0.3, clouds: 0.5 },
  desert: { id: 'desert', label: 'Пустынный', land: '#c19a5b', sea: '#8a6b34', atmo: '#ffd9a0', water: 0.0, rough: 0.6, clouds: 0.12 },
  ice: { id: 'ice', label: 'Ледяной', land: '#cfe6f5', sea: '#8fb8d8', atmo: '#dff2ff', water: 0.4, rough: 0.45, clouds: 0.55 },
  volcanic: { id: 'volcanic', label: 'Вулканический', land: '#5a2320', sea: '#c0341a', atmo: '#ff7a3c', water: 0.2, rough: 0.8, clouds: 0.3 },
  jungle: { id: 'jungle', label: 'Джунгли', land: '#2f6a2a', sea: '#1f5a52', atmo: '#9dffb0', water: 0.4, rough: 0.55, clouds: 0.6 },
  gloom: { id: 'gloom', label: 'Мрак', land: '#6b5a1e', sea: '#3f3410', atmo: '#e8c74a', water: 0.15, rough: 0.7, clouds: 0.7 },
  barren: { id: 'barren', label: 'Бесплодный', land: '#8a8378', sea: '#5a534a', atmo: '#c9c2b6', water: 0.02, rough: 0.65, clouds: 0.05 },
  toxic: { id: 'toxic', label: 'Токсичный', land: '#5c6b2a', sea: '#3a5a1e', atmo: '#c6ff4a', water: 0.3, rough: 0.6, clouds: 0.5 },
  gas: { id: 'gas', label: 'Газовый гигант', land: '#8a6bb0', sea: '#5a3f8a', atmo: '#c39bff', water: 0.0, rough: 0.25, clouds: 0.9 },
  magma: { id: 'magma', label: 'Магмовый', land: '#241512', sea: '#ff5a1a', atmo: '#ff9c3c', water: 0.52, rough: 0.8, clouds: 0.15 },
};

export const BIOME_LIST = Object.values(BIOMES);
