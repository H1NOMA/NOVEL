import type { NetMessage } from './protocol';

// ---------------------------------------------------------------------------
// Доступ к сетевому слою главного процесса Electron (electron/preload.cjs).
// В браузере моста нет — там сетевая партия просто недоступна, и меню это
// показывает вместо того, чтобы падать.
// ---------------------------------------------------------------------------

export interface NetEvent {
  kind: 'message' | 'peer-joined' | 'peer-left' | 'disconnected';
  from?: string;
  msg?: NetMessage;
  id?: string;
}

interface NetBridge {
  host(port?: number): Promise<{ ok: boolean; port?: number; addresses?: string[]; error?: string }>;
  join(host: string, port?: number): Promise<{ ok: boolean; error?: string }>;
  send(msg: NetMessage): Promise<boolean>;
  sendTo(peer: string, msg: NetMessage): Promise<boolean>;
  broadcast(msg: NetMessage): Promise<number>;
  close(): Promise<boolean>;
  addresses(): Promise<string[]>;
  onEvent(fn: (e: NetEvent) => void): () => void;
}

export function netBridge(): NetBridge | null {
  return (window as unknown as { netBridge?: NetBridge }).netBridge ?? null;
}

/** Доступна ли сетевая игра (только десктопная сборка). */
export function netAvailable(): boolean {
  return !!netBridge();
}
