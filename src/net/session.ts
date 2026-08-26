import type { FactionId } from '../core/types';
import { FACTIONS, FACTION_IDS } from '../data/factions';
import type { GameState } from '../game/state';
import { applyCommand } from './commands';
import { netBridge, type FoundParty, type NetAdapter, type NetEvent } from './bridge';
import { PROTOCOL_VERSION, type Cmd, type LobbySlot, type NetMessage, type PartyMember } from './protocol';
import { partyCodeFor, resolveJoinTarget } from './partyCode';
import { applySnapshot, encodeSnapshot } from './snapshot';

// ---------------------------------------------------------------------------
// Сетевая партия «через хоста».
//
// Хост крутит симуляцию у себя и рассылает срезы состояния. Клиенты ничего не
// считают: они рисуют присланное и шлют приказы. Отсюда следует главное
// свойство — рассинхрона в привычном смысле не бывает, потеря пакета лечится
// следующим снапшотом.
// ---------------------------------------------------------------------------

/** Как часто хост рассылает состояние (реальные миллисекунды). */
const SNAPSHOT_INTERVAL_MS = 900;

export type Role = 'single' | 'host' | 'client';

let role: Role = 'single';
let state: GameState | null = null;
let unsubscribe: (() => void) | null = null;
let snapshotTimer: number | null = null;

/** Хост: peerId → занятая фракция. Источник правды о том, кто чем командует. */
const peerFaction = new Map<string, FactionId>();
const peerName = new Map<string, string>();
let hostFaction: FactionId = 'superEarth';

/** Клиент: что показывать в лобби и есть ли связь. */
let lobbySlots: LobbySlot[] = [];
/** Список людей в партии — виден и в лобби, и в меню паузы. */
let partyMembers: PartyMember[] = [];
/** Код партии: у хоста считается из адреса, клиенту приходит с welcome. */
let partyCodeValue: string | null = null;
/** Адаптеры хоста и выбранный из них: код партии считается по выбранному. */
let hostAdapters: NetAdapter[] = [];
let hostAddress: string | null = null;
let hostPort = 0;
let onLobby: ((slots: LobbySlot[]) => void) | null = null;
let onStart: ((faction: FactionId, snapshot: string) => void) | null = null;
let onDropped: (() => void) | null = null;
let onReject: ((reason: string) => void) | null = null;

export function currentRole(): Role {
  return role;
}

export function isClient(): boolean {
  return role === 'client';
}

/** Привязать живое состояние: с этого момента снапшоты уходят и приходят. */
export function attachState(s: GameState): void {
  state = s;
  if (role === 'host') startSnapshotLoop();
}

// --- Лобби ------------------------------------------------------------------

function buildSlots(): LobbySlot[] {
  return FACTION_IDS.filter((f) => FACTIONS[f].playable).map((f) => {
    if (f === hostFaction) return { faction: f, takenBy: 'host', name: 'Хост' };
    for (const [peer, fac] of peerFaction) {
      if (fac === f) return { faction: f, takenBy: peer, name: peerName.get(peer) ?? peer };
    }
    return { faction: f, takenBy: null, name: 'ИИ' };
  });
}

/** Кто сейчас в партии: хост плюс все подключённые, с их сторонами. */
function buildMembers(): PartyMember[] {
  const out: PartyMember[] = [
    { peer: 'host', name: 'Хост', faction: hostFaction, isHost: true },
  ];
  for (const [peer, name] of peerName) {
    out.push({ peer, name, faction: peerFaction.get(peer) ?? null, isHost: false });
  }
  return out;
}

function pushLobby(): void {
  const slots = buildSlots();
  lobbySlots = slots;
  partyMembers = buildMembers();
  const net = netBridge();
  net?.broadcast({ k: 'lobby', slots, members: partyMembers, code: partyCodeValue });
  // Маяк объявляет актуальное число игроков — в списке поиска видно, куда
  // ещё есть смысл стучаться.
  if (role === 'host') {
    void net?.beacon({ host: 'Партия', faction: hostFaction, players: partyMembers.length });
  }
  onLobby?.(slots);
}

export function getLobbySlots(): LobbySlot[] {
  return lobbySlots;
}

/** Список игроков партии. Пуст в одиночной игре. */
export function getPartyMembers(): PartyMember[] {
  return partyMembers;
}

/** Код партии для показа. null — партия не сетевая или адрес не IPv4. */
export function getPartyCode(): string | null {
  return partyCodeValue;
}

/** Сетевые адаптеры хоста — из них он выбирает, по какой сети играть. */
export function getHostAdapters(): NetAdapter[] {
  return hostAdapters;
}

export function getHostAddress(): string | null {
  return hostAddress;
}

/**
 * Переключить сеть партии. Код пересчитывается под выбранный адаптер:
 * на машине с Radmin VPN или Docker «правильный» адрес знает только хост.
 */
export function setHostAddress(address: string): void {
  if (role !== 'host') return;
  if (!hostAdapters.some((a) => a.address === address)) return;
  hostAddress = address;
  partyCodeValue = partyCodeFor([address], hostPort || undefined);
  pushLobby();
}

/** Найти партии в локальной сети (без ввода кода). */
export async function findParties(ms = 1400): Promise<FoundParty[]> {
  const net = netBridge();
  if (!net) return [];
  try {
    return await net.discover(ms);
  } catch {
    return [];
  }
}

/**
 * Хост исключает игрока. Клиенту уходит причина, затем канал закрывается;
 * освободившуюся фракцию подхватывает ИИ — как при обычном отвале.
 */
export function kickPeer(peer: string): boolean {
  if (role !== 'host' || peer === 'host') return false;
  const net = netBridge();
  if (!net) return false;
  const faction = peerFaction.get(peer);
  peerFaction.delete(peer);
  peerName.delete(peer);
  if (faction && state) state.humans = state.humans.filter((f) => f !== faction);
  void net.drop(peer, 'Вас исключил хост');
  pushLobby();
  return true;
}

export function setLobbyHandlers(h: {
  onLobby?: (slots: LobbySlot[]) => void;
  onStart?: (faction: FactionId, snapshot: string) => void;
  onDropped?: () => void;
  onReject?: (reason: string) => void;
}): void {
  onLobby = h.onLobby ?? null;
  onStart = h.onStart ?? null;
  onDropped = h.onDropped ?? null;
  onReject = h.onReject ?? null;
}

// --- Хост -------------------------------------------------------------------

export async function startHosting(faction: FactionId): Promise<{ ok: boolean; adapters?: NetAdapter[]; port?: number; code?: string | null; error?: string }> {
  const net = netBridge();
  if (!net) return { ok: false, error: 'Сетевая игра доступна только в десктопной сборке' };
  const res = await net.host();
  if (!res.ok) return { ok: false, error: res.error ?? 'не удалось открыть порт' };
  role = 'host';
  hostFaction = faction;
  peerFaction.clear();
  peerName.clear();
  // Код партии — это упакованный адрес хоста, поэтому считается один раз
  // здесь и дальше только раздаётся.
  hostAdapters = res.addresses ?? [];
  hostPort = res.port ?? 0;
  // Адаптеры уже отсортированы по пригодности: обычная сеть впереди,
  // виртуальные позади. Первый и берём — но хост может переключить.
  hostAddress = hostAdapters[0]?.address ?? null;
  partyCodeValue = hostAddress ? partyCodeFor([hostAddress], hostPort || undefined) : null;
  listen();
  // Маяк: игроки в той же сети найдут партию, не вводя вообще ничего.
  void net.beacon({ host: 'Партия', faction, players: 1 });
  pushLobby();
  return { ok: true, adapters: hostAdapters, port: res.port, code: partyCodeValue };
}

function handleHostMessage(from: string, msg: NetMessage): void {
  const net = netBridge();
  if (!net) return;
  switch (msg.k) {
    case 'hello': {
      if (msg.version !== PROTOCOL_VERSION) {
        net.sendTo(from, { k: 'bye', reason: 'Версии игры не совпадают' });
        return;
      }
      peerName.set(from, (msg.name || 'Игрок').slice(0, 24));
      net.sendTo(from, {
        k: 'welcome', version: PROTOCOL_VERSION, peer: from,
        slots: buildSlots(), members: buildMembers(), code: partyCodeValue,
      });
      pushLobby();
      return;
    }
    case 'claim': {
      const wanted = msg.faction;
      const busy = wanted === hostFaction ||
        [...peerFaction.entries()].some(([p, f]) => f === wanted && p !== from);
      if (busy || !FACTIONS[wanted]?.playable) {
        net.sendTo(from, { k: 'nak', reason: 'Фракция уже занята' });
        return;
      }
      peerFaction.set(from, wanted);
      pushLobby();
      return;
    }
    case 'cmd': {
      // Исполнитель берётся ИЗ РЕЕСТРА, а не из сообщения.
      const actor = peerFaction.get(from);
      if (!actor || !state) {
        net.sendTo(from, { k: 'nak', reason: 'Место не занято' });
        return;
      }
      if (!applyCommand(state, actor, msg.cmd)) {
        net.sendTo(from, { k: 'nak', reason: 'Приказ отклонён' });
      }
      return;
    }
    case 'resync': {
      if (state) net.sendTo(from, { k: 'snapshot', snapshot: encodeSnapshot(state) });
      return;
    }
    default:
      return;
  }
}

/** Начать партию: разослать состояние и роли. */
export function hostStartGame(s: GameState): void {
  const net = netBridge();
  state = s;
  // Занятые места — люди; остальные фракции остаются за ИИ.
  s.humans = [hostFaction, ...peerFaction.values()];
  s.player = hostFaction;
  const snapshot = encodeSnapshot(s);
  for (const [peer, faction] of peerFaction) {
    net?.sendTo(peer, { k: 'start', faction, snapshot });
  }
  startSnapshotLoop();
}

function startSnapshotLoop(): void {
  if (snapshotTimer !== null) return;
  snapshotTimer = window.setInterval(() => {
    if (role !== 'host' || !state || peerFaction.size === 0) return;
    netBridge()?.broadcast({ k: 'snapshot', snapshot: encodeSnapshot(state) });
  }, SNAPSHOT_INTERVAL_MS);
}

// --- Клиент -----------------------------------------------------------------

/**
 * Подключиться по коду партии или по обычному адресу — разбираем и то и
 * другое, чтобы не заставлять игрока выбирать формат.
 */
export async function joinGame(input: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const net = netBridge();
  if (!net) return { ok: false, error: 'Сетевая игра доступна только в десктопной сборке' };
  const target = resolveJoinTarget(input);
  if (!target) return { ok: false, error: 'Не разобрать код партии' };
  const res = await net.join(target.host, target.port);
  if (!res.ok) return { ok: false, error: res.error ?? 'не удалось подключиться' };
  role = 'client';
  listen();
  net.send({ k: 'hello', version: PROTOCOL_VERSION, name });
  return { ok: true };
}

export function claimFaction(faction: FactionId): void {
  netBridge()?.send({ k: 'claim', faction });
}

function handleClientMessage(msg: NetMessage): void {
  switch (msg.k) {
    case 'welcome':
      lobbySlots = msg.slots;
      partyMembers = msg.members ?? [];
      partyCodeValue = msg.code ?? null;
      onLobby?.(msg.slots);
      return;
    case 'lobby':
      lobbySlots = msg.slots;
      partyMembers = msg.members ?? partyMembers;
      if (msg.code !== undefined) partyCodeValue = msg.code;
      onLobby?.(msg.slots);
      return;
    case 'start':
      onStart?.(msg.faction, msg.snapshot);
      return;
    case 'snapshot':
      if (state) applySnapshot(state, msg.snapshot);
      return;
    case 'nak':
      onReject?.(msg.reason);
      return;
    case 'bye':
      onReject?.(msg.reason);
      leave();
      return;
    default:
      return;
  }
}

/** Клиент: отправить приказ хосту. Локально ничего не меняется — ждём снапшот. */
export function sendCommand(cmd: Cmd): void {
  netBridge()?.send({ k: 'cmd', cmd });
}

// --- Общее ------------------------------------------------------------------

function listen(): void {
  unsubscribe?.();
  unsubscribe = netBridge()?.onEvent((e: NetEvent) => {
    if (e.kind === 'message' && e.msg) {
      if (role === 'host' && e.from) handleHostMessage(e.from, e.msg);
      else if (role === 'client') handleClientMessage(e.msg);
      return;
    }
    if (e.kind === 'peer-left' && e.id) {
      // Хост никогда не ждёт отвалившегося: его фракцию подхватывает ИИ.
      const faction = peerFaction.get(e.id);
      peerFaction.delete(e.id);
      peerName.delete(e.id);
      if (faction && state) state.humans = state.humans.filter((f) => f !== faction);
      pushLobby();
      return;
    }
    if (e.kind === 'disconnected') {
      onDropped?.();
      leave();
    }
  }) ?? null;
}

export function leave(): void {
  if (snapshotTimer !== null) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
  unsubscribe?.();
  unsubscribe = null;
  if (role === 'host') void netBridge()?.beacon(null);
  peerFaction.clear();
  peerName.clear();
  lobbySlots = [];
  partyMembers = [];
  partyCodeValue = null;
  hostAdapters = [];
  hostAddress = null;
  role = 'single';
  state = null;
  netBridge()?.close();
}
