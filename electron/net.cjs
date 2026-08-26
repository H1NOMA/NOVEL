// ---------------------------------------------------------------------------
// Сетевой слой десктопной сборки: партия «через хоста».
//
// Сокеты живут ТОЛЬКО здесь, в главном процессе. Рендерер запущен в песочнице
// (sandbox: true, contextIsolation: true) и серверный сокет открыть не может
// в принципе, поэтому preload пробрасывает наружу лишь IPC-канал.
//
// Кадрирование — построчный JSON: одно сообщение на строку. Партия идёт по
// локальной сети, поэтому хватает TCP без дополнительных протоколов и без
// единой сторонней зависимости.
// ---------------------------------------------------------------------------
const net = require('node:net');
const os = require('node:os');

const PORT = 47624;
/** Кадр больше этого — обрыв связи: защита от мусора из открытого порта. */
const MAX_FRAME = 8 * 1024 * 1024;

let server = null;
/** peerId -> socket */
const peers = new Map();
let peerCounter = 0;
let clientSocket = null;
/** Куда пересылать полученное: (channel, payload) => void */
let deliver = () => {};

function setDeliver(fn) {
  deliver = typeof fn === 'function' ? fn : () => {};
}

/** Разбор построчного потока с ограничением длины кадра. */
function attachReader(socket, onMessage, onFail) {
  let buf = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buf += chunk;
    if (buf.length > MAX_FRAME) {
      onFail(new Error('кадр превысил лимит'));
      socket.destroy();
      buf = '';
      return;
    }
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch (e) {
        onFail(e);
      }
    }
  });
}

function writeTo(socket, msg) {
  if (!socket || socket.destroyed) return false;
  try {
    socket.write(JSON.stringify(msg) + '\n');
    return true;
  } catch {
    return false;
  }
}

// --- Хост -------------------------------------------------------------------

function startHost(port = PORT) {
  stopAll();
  return new Promise((resolve) => {
    server = net.createServer((socket) => {
      const id = `p${++peerCounter}`;
      peers.set(id, socket);
      socket.setNoDelay(true);
      attachReader(
        socket,
        (msg) => deliver('message', { from: id, msg }),
        () => socket.destroy(),
      );
      socket.on('close', () => {
        peers.delete(id);
        deliver('peer-left', { id });
      });
      socket.on('error', () => socket.destroy());
      deliver('peer-joined', { id });
    });
    server.on('error', (e) => resolve({ ok: false, error: String(e && e.message) }));
    server.listen(port, () => resolve({ ok: true, port, addresses: localAddresses() }));
  });
}

function sendToPeer(id, msg) {
  return writeTo(peers.get(id), msg);
}

/**
 * Отключить одного клиента: хост исключает игрока из лобби.
 * Сообщение о причине шлётся до разрыва — flush успевает уйти, потому что
 * end() дописывает буфер и только потом закрывает канал.
 */
function dropPeer(id, reason) {
  const socket = peers.get(id);
  if (!socket) return false;
  try {
    if (!socket.destroyed) socket.end(JSON.stringify({ k: 'bye', reason }) + '\n');
  } catch { /* канал уже мёртв — достаточно снять его с учёта */ }
  peers.delete(id);
  setTimeout(() => socket.destroy(), 200);
  return true;
}

function broadcast(msg) {
  const line = JSON.stringify(msg) + '\n';
  let sent = 0;
  for (const s of peers.values()) {
    if (s.destroyed) continue;
    try {
      s.write(line);
      sent++;
    } catch { /* соединение уже мертво — уберётся по close */ }
  }
  return sent;
}

// --- Клиент -----------------------------------------------------------------

function joinHost(host, port = PORT) {
  stopAll();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      clientSocket = socket;
      socket.setNoDelay(true);
      resolve({ ok: true });
    });
    attachReader(
      socket,
      (msg) => deliver('message', { from: 'host', msg }),
      () => socket.destroy(),
    );
    socket.on('error', (e) => {
      if (!clientSocket) resolve({ ok: false, error: String(e && e.message) });
      socket.destroy();
    });
    socket.on('close', () => {
      if (clientSocket === socket) clientSocket = null;
      deliver('disconnected', {});
    });
  });
}

function sendToHost(msg) {
  return writeTo(clientSocket, msg);
}

// --- Общее ------------------------------------------------------------------

function stopAll() {
  for (const s of peers.values()) s.destroy();
  peers.clear();
  if (server) {
    try { server.close(); } catch { /* уже закрыт */ }
    server = null;
  }
  if (clientSocket) {
    clientSocket.destroy();
    clientSocket = null;
  }
}

/** Адреса машины, которые имеет смысл продиктовать соседу по сети. */
function localAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

module.exports = {
  PORT, startHost, joinHost, sendToPeer, sendToHost, broadcast, stopAll,
  localAddresses, setDeliver, dropPeer,
};
