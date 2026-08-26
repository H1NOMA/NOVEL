// Масштаб интерфейса. Все размеры в style.css заданы в rem, поэтому одна
// переменная --ui-scale тянет за собой шрифты, панели и отступы разом.
// Значение переживает перезапуск.

const KEY = 'sgw2_ui_scale';
export const UI_SCALE_MIN = 0.9;
export const UI_SCALE_MAX = 1.6;
export const UI_SCALE_DEFAULT = 1.15;

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function getUiScale(): number {
  const raw = Number(storage()?.getItem(KEY));
  if (!Number.isFinite(raw) || raw <= 0) return UI_SCALE_DEFAULT;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, raw));
}


/** Прописать масштаб в корень документа (вызывается на старте и при правке). */
export function applyUiScale(v = getUiScale()): void {
  document.documentElement.style.setProperty('--ui-scale', String(v));
}
