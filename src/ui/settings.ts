// ---------------------------------------------------------------------------
// Настройки игры — одно хранилище на всё.
//
// Раньше они лежали в трёх местах: громкость в sgw2_sound, эффекты в sgw2_fx,
// масштаб в sgw2_ui_scale. Из-за этого главное меню и меню паузы показывали
// разные наборы, а часть настроек была доступна только из одного экрана.
// Теперь модель одна, экран один, а старые ключи подхватываются при первом
// запуске, чтобы ничего не потерялось.
// ---------------------------------------------------------------------------

import { applyUiScale, UI_SCALE_DEFAULT, UI_SCALE_MAX, UI_SCALE_MIN } from './uiScale';
import { COLORBLIND_PALETTE, setFactionPalette } from '../data/factions';

const KEY = 'sgw2_settings';

/** Пресет качества картинки: тянет за собой плотность пикселей и эффекты. */
export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  // изображение
  quality: Quality;
  bloom: boolean;
  scan: boolean;
  vignette: boolean;
  grain: boolean;
  // звук
  master: number;
  ambient: number;
  effects: number;
  // интерфейс
  uiScale: number;
  panelOpacity: number;
  colorblind: boolean;
  // партия
  autosaveDays: number;
  startSpeed: 0 | 1 | 2 | 3;
}

export const DEFAULTS: Settings = {
  quality: 'high',
  bloom: true,
  scan: true,
  vignette: true,
  grain: true,
  master: 0.8,
  ambient: 0.5,
  effects: 0.8,
  uiScale: UI_SCALE_DEFAULT,
  panelOpacity: 0.92,
  colorblind: false,
  autosaveDays: 365,
  startSpeed: 1,
};

/** Что даёт каждый пресет качества. Один источник правды для сцены и экрана. */
export const QUALITY_PRESETS: Record<Quality, {
  label: string;
  pixelRatio: number;
  stars: number;
  comets: boolean;
  bloomStrength: number;
  /**
   * Потолок октав шума поверхности планет. Детализация стоит дорого именно
   * здесь: каждая октава — ещё один вызов симплекс-шума на каждый пиксель
   * каждой планеты. На слабой машине потолок ниже, и мир снова становится
   * мягче — зато держит кадры.
   */
  planetOct: number;
}> = {
  low: { label: 'Низкое', pixelRatio: 1.0, stars: 1200, comets: false, bloomStrength: 0.0, planetOct: 4 },
  medium: { label: 'Среднее', pixelRatio: 1.5, stars: 2200, comets: true, bloomStrength: 0.14, planetOct: 6 },
  high: { label: 'Высокое', pixelRatio: 2.0, stars: 3200, comets: true, bloomStrength: 0.2, planetOct: 7 },
};

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

/** Подтянуть значения из ключей прошлых версий — настройки не должны сбрасываться. */
function migrate(into: Settings): Settings {
  const s = storage();
  if (!s) return into;
  try {
    const sound = s.getItem('sgw2_sound');
    if (sound) {
      const v = JSON.parse(sound) as Partial<Settings>;
      if (typeof v.master === 'number') into.master = clamp(v.master, 0, 1);
      if (typeof v.ambient === 'number') into.ambient = clamp(v.ambient, 0, 1);
      if (typeof v.effects === 'number') into.effects = clamp(v.effects, 0, 1);
    }
    const fx = s.getItem('sgw2_fx');
    if (fx) {
      const v = JSON.parse(fx) as Partial<Settings>;
      if (typeof v.bloom === 'boolean') into.bloom = v.bloom;
      if (typeof v.scan === 'boolean') into.scan = v.scan;
      if (typeof v.vignette === 'boolean') into.vignette = v.vignette;
      if (typeof v.autosaveDays === 'number') into.autosaveDays = v.autosaveDays;
    }
    const scale = Number(s.getItem('sgw2_ui_scale'));
    if (Number.isFinite(scale) && scale > 0) into.uiScale = clamp(scale, UI_SCALE_MIN, UI_SCALE_MAX);
  } catch { /* мусор в старых ключах — просто игнорируем */ }
  return into;
}

function sanitize(v: Partial<Settings>): Settings {
  const q = v.quality;
  return {
    quality: q === 'low' || q === 'medium' || q === 'high' ? q : DEFAULTS.quality,
    bloom: v.bloom ?? DEFAULTS.bloom,
    scan: v.scan ?? DEFAULTS.scan,
    vignette: v.vignette ?? DEFAULTS.vignette,
    grain: v.grain ?? DEFAULTS.grain,
    master: clamp(v.master ?? DEFAULTS.master, 0, 1),
    ambient: clamp(v.ambient ?? DEFAULTS.ambient, 0, 1),
    effects: clamp(v.effects ?? DEFAULTS.effects, 0, 1),
    uiScale: clamp(v.uiScale ?? DEFAULTS.uiScale, UI_SCALE_MIN, UI_SCALE_MAX),
    panelOpacity: clamp(v.panelOpacity ?? DEFAULTS.panelOpacity, 0.5, 1),
    colorblind: v.colorblind ?? DEFAULTS.colorblind,
    autosaveDays: clamp(v.autosaveDays ?? DEFAULTS.autosaveDays, 30, 3650),
    startSpeed: ([0, 1, 2, 3] as const).includes(v.startSpeed as 0) ? v.startSpeed! : DEFAULTS.startSpeed,
  };
}

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  const raw = storage()?.getItem(KEY);
  if (!raw) {
    cache = migrate({ ...DEFAULTS });
    return cache;
  }
  try {
    cache = sanitize(JSON.parse(raw) as Partial<Settings>);
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

/** Подписка на изменения: сцена и звук слушают её и перестраиваются на лету. */
export function onSettings(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function patchSettings(p: Partial<Settings>): Settings {
  const next = sanitize({ ...getSettings(), ...p });
  cache = next;
  try {
    storage()?.setItem(KEY, JSON.stringify(next));
  } catch { /* приватный режим — настройки живут до перезапуска */ }
  applyDom(next);
  for (const fn of listeners) fn(next);
  return next;
}

export function resetSettings(): Settings {
  try {
    storage()?.removeItem(KEY);
  } catch { /* нечего чистить */ }
  cache = null;
  return patchSettings({ ...DEFAULTS });
}

/**
 * Разложить настройки по документу: масштаб, классы-выключатели эффектов и
 * прозрачность панелей. Сцена и звук подхватывают своё через подписку.
 */
export function applyDom(s: Settings = getSettings()): void {
  // Палитра фракций — не про документ, но её точно так же надо разложить до
  // первой отрисовки, иначе карта успеет нарисоваться каноничными цветами.
  setFactionPalette(s.colorblind ? COLORBLIND_PALETTE : {});
  if (typeof document === 'undefined') return;
  applyUiScale(s.uiScale);
  const b = document.body;
  b.classList.toggle('no-scan', !s.scan);
  b.classList.toggle('no-vignette', !s.vignette);
  b.classList.toggle('no-grain', !s.grain);
  b.classList.toggle('cb-safe', s.colorblind);
  document.documentElement.style.setProperty('--panel-alpha', String(s.panelOpacity));
}
