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

/**
 * Как часто хост рассылает состояние (реальные миллисекунды).
 *
 * Клиент больше ничего не считает сам, поэтому срез — единственный источник
 * движения мира на его экране: на прежних 900 мс война шла заметными скачками
 * раз в секунду. Замер на партии 200-го дня: срез 139 КиБ, сборка 1.4 мс,
 * применение 1.0 мс — при 300 мс это меньше процента процессорного времени и
 * порядка 0.5 МБ/с на клиента, что локальная сеть не замечает.
 */
const SNAPSHOT_INTERVAL_MS = 300;

/**
 * На паузе мир не меняется, гнать по три среза в секунду незачем — держим
 * редкий пульс, чтобы чужие приказы всё же доезжали за секунду.
 */
const PAUSED_SNAPSHOT_EVERY = 4;

export type Role = 'single' | 'host' | 'client';

let role: Role = 'single';
let state: GameState | null = null;
let unsubscribe: (() => void) | null = null;
let snapshotTimer: number | null = null;

/** Как часто хост замеряет задержку до каждого клиента. */
const PING_INTERVAL_MS = 2000;

/** Хост: peerId → занятая фракция. Источник правды о том, кто чем командует. */
const peerFaction = new Map<string, FactionId>();
const peerName = new Map<string, string>();
/** Замеренная задержка до каждого клиента (мс). */
const peerPing = new Map<string, number>();
let pingTimer: number | null = null;
let hostFaction: FactionId = 'superEarth';
/** Своя задержка до хоста — её клиент узнаёт из списка игроков. */
let myPing: number | null = null;
/** Как хост назвал этого клиента: по этому идентификатору он ищет себя в списке. */
let myPeer: string | null = null;

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
    // До себя ходить некуда: у хоста задержки нет по определению.
    { peer: 'host', name: 'Хост', faction: hostFaction, isHost: true, ping: 0 },
  ];
  for (const [peer, name] of peerName) {
    out.push({
      peer, name, faction: peerFaction.get(peer) ?? null, isHost: false,
      ping: peerPing.get(peer) ?? null,
    });
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

/**
 * Хост замеряет задержку до каждого клиента.
 *
 * Штамп времени уходит клиенту и возвращается обратно неизменным — разница и
 * есть round-trip. Обновление задержек НЕ рассылает лобби целиком: список
 * игроков и так уезжает при каждом изменении состава, а цифры подхватываются
 * следующим таким сообщением. Иначе на каждый замер шёл бы лишний пакет.
 */
function startPingLoop(): void {
  if (pingTimer !== null) return;
  pingTimer = window.setInterval(() => {
    if (role !== 'host') return;
    const net = netBridge();
    if (!net) return;
    const t = Date.now();
    for (const peer of peerName.keys()) net.sendTo(peer, { k: 'ping', t });
    // Список игроков обновляется вместе с задержками, но редко — раз в замер.
    partyMembers = buildMembers();
    net.broadcast({ k: 'lobby', slots: lobbySlots, members: partyMembers, code: partyCodeValue });
    onLobby?.(lobbySlots);
  }, PING_INTERVAL_MS);
}

function stopPingLoop(): void {
  if (pingTimer === null) return;
  clearInterval(pingTimer);
  pingTimer = null;
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
  peerPing.delete(peer);
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
  startPingLoop();
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
        return;
      }
      // На паузе очередной срез ждать до секунды: отдав приказ, игрок должен
      // увидеть результат сразу, а не после того, как кто-то снимет паузу.
      if (state.speed === 0) {
        const snap = { k: 'snapshot', snapshot: encodeSnapshot(state) } as const;
        if (net.broadcastVolatile) void net.broadcastVolatile(snap);
        else net.broadcast(snap);
      }
      return;
    }
    case 'pong': {
      // Разница между отправкой и возвратом штампа — round-trip до клиента.
      const rtt = Date.now() - msg.t;
      if (rtt >= 0 && rtt < 60000) peerPing.set(from, rtt);
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
  let tick = 0;
  snapshotTimer = window.setInterval(() => {
    if (role !== 'host' || !state || peerFaction.size === 0) return;
    tick++;
    if (state.speed === 0 && tick % PAUSED_SNAPSHOT_EVERY !== 0) return;
    const net = netBridge();
    const msg = { k: 'snapshot', snapshot: encodeSnapshot(state) } as const;
    // Срез мира самодостаточен: при заторе его лучше пропустить, чем поставить
    // в очередь и показать клиенту прошлое.
    if (net?.broadcastVolatile) void net.broadcastVolatile(msg);
    else net?.broadcast(msg);
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
    case 'ping':
      // Эхо без задержки: любая обработка исказила бы замер.
      netBridge()?.send({ k: 'pong', t: msg.t });
      return;
    case 'welcome':
      myPeer = msg.peer;
      lobbySlots = msg.slots;
      partyMembers = msg.members ?? [];
      myPing = partyMembers.find((m) => m.peer === msg.peer)?.ping ?? myPing;
      partyCodeValue = msg.code ?? null;
      onLobby?.(msg.slots);
      return;
    case 'lobby':
      lobbySlots = msg.slots;
      partyMembers = msg.members ?? partyMembers;
      // Своя строка в списке — оттуда клиент и узнаёт собственный пинг.
      myPing = partyMembers.find((m) => m.peer === myPeer)?.ping ?? myPing;
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
      peerPing.delete(e.id);
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
  stopPingLoop();
  unsubscribe?.();
  unsubscribe = null;
  if (role === 'host') void netBridge()?.beacon(null);
  peerFaction.clear();
  peerName.clear();
  peerPing.clear();
  myPing = null;
  myPeer = null;
  lobbySlots = [];
  partyMembers = [];
  partyCodeValue = null;
  hostAdapters = [];
  hostAddress = null;
  role = 'single';
  state = null;
  netBridge()?.close();
}
