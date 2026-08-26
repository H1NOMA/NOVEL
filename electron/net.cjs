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
const dgram = require('node:dgram');

const PORT = 47624;
/** Порт объявлений: по нему хосты откликаются на поиск в локальной сети. */
const DISCOVERY_PORT = 47625;
const DISCOVERY_MAGIC = 'SGW2';
/** Сколько ждать соединения, прежде чем признать хост недоступным. */
const CONNECT_TIMEOUT_MS = 6000;
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

/**
 * Человекочитаемая причина отказа.
 *
 * Системные коды игроку ничего не говорят, а разница между ними существенная:
 * ETIMEDOUT почти всегда означает брандмауэр или не ту сеть, а ECONNREFUSED —
 * что машина отвечает, но партии на ней нет.
 */
function joinError(code, host) {
  switch (code) {
    case 'ETIMEDOUT':
      return `Хост ${host} не отвечает. Обычно это брандмауэр на его стороне или разные сети: проверьте, что игра пропущена в брандмауэре и оба в одной сети.`;
    case 'ECONNREFUSED':
      return `Машина ${host} отвечает, но партия на ней не открыта.`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `До ${host} нет маршрута: вы в разных сетях.`;
    case 'ENOTFOUND':
      return `Адрес ${host} не найден.`;
    default:
      return null;
  }
}

function joinHost(host, port = PORT) {
  stopAll();
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    const socket = net.createConnection({ host, port }, () => {
      clientSocket = socket;
      socket.setNoDelay(true);
      // Таймаут снимается только с УСТАНОВЛЕННОГО соединения: дальше молчание
      // в канале нормально — снапшоты идут не каждую секунду.
      socket.setTimeout(0);
      done({ ok: true });
    });
    // Без явного таймаута Windows держит попытку около минуты, и всё это время
    // окно просто висит без единого признака жизни.
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      if (clientSocket === socket) return;
      socket.destroy();
      done({ ok: false, error: joinError('ETIMEDOUT', host) });
    });
    attachReader(
      socket,
      (msg) => deliver('message', { from: 'host', msg }),
      () => socket.destroy(),
    );
    socket.on('error', (e) => {
      if (!clientSocket) {
        done({ ok: false, error: joinError(e && e.code, host) ?? String(e && e.message) });
      }
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
// ---------------------------------------------------------------------------
// Выбор адреса хоста.
//
// os.networkInterfaces() отдаёт адаптеры в произвольном порядке, и на машине
// с Radmin VPN, Hamachi, Docker или VirtualBox первым запросто оказывается
// виртуальный. Код партии тогда указывает на сеть, в которой второго игрока
// нет, и подключение молча висит до таймаута.
//
// Поэтому адреса РАНЖИРУЮТСЯ, а не берутся как попало: обычная локальная сеть
// впереди, виртуальные адаптеры позади. Но список отдаётся целиком с именами —
// угадать, по какой именно сети игроки собрались играть, программа не может,
// и последнее слово остаётся за хостом.
// ---------------------------------------------------------------------------

/** Известные диапазоны виртуальных адаптеров: имя сети → что это. */
function virtualKind(addr, ifname) {
  const n = (ifname || '').toLowerCase();
  if (/^26\./.test(addr)) return 'Radmin VPN';
  if (/^25\./.test(addr)) return 'Hamachi';
  if (/^172\.(17|18|19|20|21|22)\./.test(addr)) return 'Docker';
  if (/^192\.168\.56\./.test(addr)) return 'VirtualBox';
  if (/^169\.254\./.test(addr)) return 'без связи';
  if (n.includes('radmin')) return 'Radmin VPN';
  if (n.includes('hamachi')) return 'Hamachi';
  if (n.includes('docker')) return 'Docker';
  if (n.includes('vmware')) return 'VMware';
  if (n.includes('virtualbox') || n.includes('vbox')) return 'VirtualBox';
  if (n.includes('wsl')) return 'WSL';
  if (n.includes('hyper-v') || n.includes('vethernet')) return 'Hyper-V';
  if (n.includes('tap') || n.includes('tun') || n.includes('vpn')) return 'VPN';
  return null;
}

/** Обычная домашняя сеть — такие адреса и нужны в большинстве партий. */
function isLan(addr) {
  return /^192\.168\./.test(addr) || /^10\./.test(addr)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(addr);
}

function localAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      const kind = virtualKind(ni.address, name);
      // 0 — обычная сеть, 1 — прочее, 2 — виртуальный адаптер, 3 — без связи.
      let rank = 1;
      if (kind === 'без связи') rank = 3;
      else if (kind) rank = 2;
      else if (isLan(ni.address)) rank = 0;
      out.push({ address: ni.address, name, kind, rank });
    }
  }
  out.sort((a, b) => a.rank - b.rank || a.address.localeCompare(b.address));
  return out;
}

/** Только адреса, в порядке пригодности — для старого кода и кодов партии. */
function addressList() {
  return localAddresses().map((a) => a.address);
}

// ---------------------------------------------------------------------------
// Поиск партий в локальной сети.
//
// Самый надёжный способ соединиться — вообще не диктовать адрес. Хост слушает
// UDP-порт и откликается на широковещательный запрос, клиент рассылает такой
// запрос и показывает найденное списком. Работает без сервера, без настроек и
// без угадывания, какой из адаптеров нужный.
// ---------------------------------------------------------------------------

let beacon = null;

/** Хост: начать откликаться на поиск. */
function startBeacon(info) {
  stopBeacon();
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', () => stopBeacon());
  sock.on('message', (buf, rinfo) => {
    if (buf.length > 256) return;
    let msg;
    try {
      msg = JSON.parse(buf.toString('utf8'));
    } catch { return; }
    if (msg?.m !== DISCOVERY_MAGIC || msg.k !== 'who') return;
    const reply = Buffer.from(JSON.stringify({
      m: DISCOVERY_MAGIC, k: 'here', port: PORT,
      host: String(info?.host ?? 'Партия').slice(0, 32),
      faction: info?.faction ?? null,
      players: Number(info?.players ?? 1),
    }));
    try {
      sock.send(reply, rinfo.port, rinfo.address);
    } catch { /* ответ не ушёл — клиент просто не увидит эту партию */ }
  });
  try {
    sock.bind(DISCOVERY_PORT, () => {
      try {
        sock.setBroadcast(true);
      } catch { /* без широковещания отклик всё равно уйдёт адресно */ }
    });
  } catch {
    return false;
  }
  beacon = sock;
  return true;
}

function stopBeacon() {
  if (!beacon) return;
  try {
    beacon.close();
  } catch { /* уже закрыт */ }
  beacon = null;
}

/** Клиент: разослать запрос и собрать отклики. */
function discoverHosts(waitMs = 1400) {
  return new Promise((resolve) => {
    const found = new Map();
    let sock;
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch {
      resolve([]);
      return;
    }
    const finish = () => {
      try {
        sock.close();
      } catch { /* уже закрыт */ }
      resolve([...found.values()]);
    };
    sock.on('error', finish);
    sock.on('message', (buf, rinfo) => {
      if (buf.length > 256) return;
      let msg;
      try {
        msg = JSON.parse(buf.toString('utf8'));
      } catch { return; }
      if (msg?.m !== DISCOVERY_MAGIC || msg.k !== 'here') return;
      found.set(rinfo.address, {
        address: rinfo.address,
        port: Number(msg.port) || PORT,
        host: String(msg.host ?? 'Партия').slice(0, 32),
        faction: msg.faction ?? null,
        players: Number(msg.players) || 1,
      });
    });
    sock.bind(() => {
      try {
        sock.setBroadcast(true);
      } catch { /* без широковещания отправим только по подсетям */ }
      const probe = Buffer.from(JSON.stringify({ m: DISCOVERY_MAGIC, k: 'who' }));
      // Общий широковещательный адрес плюс адрес каждой своей подсети:
      // в некоторых сетях 255.255.255.255 фильтруется, а /24 проходит.
      const targets = new Set(['255.255.255.255']);
      for (const a of localAddresses()) {
        const m = /^(\d+\.\d+\.\d+)\./.exec(a.address);
        if (m) targets.add(`${m[1]}.255`);
      }
      for (const t of targets) {
        try {
          sock.send(probe, DISCOVERY_PORT, t);
        } catch { /* эта подсеть недоступна — остальные попробуем */ }
      }
      setTimeout(finish, waitMs);
    });
  });
}

module.exports = {
  PORT, startHost, joinHost, sendToPeer, sendToHost, broadcast, stopAll,
  localAddresses, addressList, setDeliver, dropPeer,
  startBeacon, stopBeacon, discoverHosts,
};
