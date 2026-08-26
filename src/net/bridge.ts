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

/** Сетевой адаптер хоста: адрес, имя в системе и вид, если он виртуальный. */
export interface NetAdapter {
  address: string;
  name: string;
  /** 'Radmin VPN', 'Docker', … либо null для обычной сети. */
  kind: string | null;
  /** 0 — обычная сеть, 2 — виртуальный адаптер, 3 — без связи. */
  rank: number;
}

/** Партия, найденная в локальной сети. */
export interface FoundParty {
  address: string;
  port: number;
  host: string;
  faction: string | null;
  players: number;
}

interface NetBridge {
  host(port?: number): Promise<{ ok: boolean; port?: number; addresses?: NetAdapter[]; error?: string }>;
  join(host: string, port?: number): Promise<{ ok: boolean; error?: string }>;
  send(msg: NetMessage): Promise<boolean>;
  sendTo(peer: string, msg: NetMessage): Promise<boolean>;
  broadcast(msg: NetMessage): Promise<number>;
  /** Срезы мира: клиенту с забитым каналом кадр не ставится в очередь. */
  broadcastVolatile?(msg: NetMessage): Promise<{ sent: number; skipped: number; bytes: number }>;
  /** Сколько байт ждёт отправки каждому клиенту — диагностика затора. */
  backlog?(): Promise<Record<string, number>>;
  /** Хост исключает клиента: причина уходит ему, затем канал закрывается. */
  drop(peer: string, reason: string): Promise<boolean>;
  close(): Promise<boolean>;
  addresses(): Promise<NetAdapter[]>;
  /** Хост: включить (info) или выключить (null) отклик на поиск. */
  beacon(info: { host: string; faction: string | null; players: number } | null): Promise<boolean>;
  /** Клиент: разослать запрос и собрать найденные партии. */
  discover(ms?: number): Promise<FoundParty[]>;
  onEvent(fn: (e: NetEvent) => void): () => void;
}

export function netBridge(): NetBridge | null {
  return (window as unknown as { netBridge?: NetBridge }).netBridge ?? null;
}

/** Доступна ли сетевая игра (только десктопная сборка). */
export function netAvailable(): boolean {
  return !!netBridge();
}
