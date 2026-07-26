/**
 * Сериализация сейвов. Ядро не знает, где сейвы хранятся (localStorage,
 * файлы, Steam Cloud) — оно только превращает состояние в JSON и обратно
 * с проверкой совместимости.
 */
import type { GameState, Scenario } from './types';

export interface SaveFile {
  format: 1;
  savedAt: string; // ISO-время — проставляет вызывающая сторона
  scenarioId: string;
  scenarioVersion: number;
  /** Короткое описание для UI списка сейвов. */
  caption: string;
  state: GameState;
}

export function makeSave(state: GameState, savedAt: string): SaveFile {
  const lastLine = state.history[state.history.length - 1];
  return {
    format: 1,
    savedAt,
    scenarioId: state.scenarioId,
    scenarioVersion: state.scenarioVersion,
    caption: lastLine ? lastLine.text.slice(0, 80) : '—',
    state
  };
}

export function serializeSave(save: SaveFile): string {
  return JSON.stringify(save);
}

export type LoadResult =
  | { ok: true; save: SaveFile }
  | { ok: false; reason: 'corrupt' | 'wrong-scenario' | 'newer-version' };

export function parseSave(json: string, sc: Scenario): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  const save = raw as SaveFile;
  if (!save || save.format !== 1 || typeof save.scenarioId !== 'string' || !save.state) {
    return { ok: false, reason: 'corrupt' };
  }
  if (save.scenarioId !== sc.meta.id) return { ok: false, reason: 'wrong-scenario' };
  // Сейв из более новой версии сценария не грузим; из старой — грузим
  // (миграции переменных — задача следующего этапа, см. ROADMAP).
  if (save.scenarioVersion > sc.meta.version) return { ok: false, reason: 'newer-version' };
  return { ok: true, save };
}
