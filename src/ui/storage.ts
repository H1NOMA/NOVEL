/**
 * Хранилище сейвов для web-раннера — localStorage.
 * В десктоп-сборке (Tauri/Electron) этот модуль заменяется на файловый
 * бэкенд + Steam Cloud; интерфейс остаётся тем же.
 */
import type { Scenario } from '../engine/types';
import type { SaveFile } from '../engine/saves';
import { parseSave, serializeSave } from '../engine/saves';

export const AUTOSAVE_SLOT = 'auto';
export const MANUAL_SLOTS = ['1', '2', '3'] as const;

function key(sc: Scenario, slot: string): string {
  return `novel:${sc.meta.id}:save:${slot}`;
}

export function writeSlot(sc: Scenario, slot: string, save: SaveFile): void {
  try {
    localStorage.setItem(key(sc, slot), serializeSave(save));
  } catch {
    // Квота/приватный режим — сейв молча не записался; для прототипа достаточно
  }
}

export function readSlot(sc: Scenario, slot: string): SaveFile | null {
  const json = localStorage.getItem(key(sc, slot));
  if (json === null) return null;
  const res = parseSave(json, sc);
  return res.ok ? res.save : null;
}

export function clearSlot(sc: Scenario, slot: string): void {
  localStorage.removeItem(key(sc, slot));
}
