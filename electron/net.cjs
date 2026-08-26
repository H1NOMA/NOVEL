// ---------------------------------------------------------------------------
// Сетевой слой десктопной сборки: партия «через хоста».
//
// Сокеты живут ТОЛЬКО здесь, в главном процессе. Рендерер запущен в песочнице
// (sandbox: true, contextIsolation: true) и серверный сокет открыть не может
// в принципе, поэтому preload пробрасывает наружу лишь IPC-канал.
//
// Кадрирование БИНАРНОЕ: четыре байта длины, байт признака сжатия, тело.
//
// Раньше кадр был строкой JSON с переводом строки на конце, и срез мира в
// 140 КиБ уходил как есть. При трёх с лишним срезах в секунду это под сотню
// килобайт в секунду на клиента — узкий канал (Wi-Fi, VPN) такого не держит,
// а TCP честно копит неотправленное в буфере. Клиент получал всё более
// СТАРЫЕ срезы и отставал тем сильнее, чем дольше шла партия.
//
// Лечится двумя вещами, обе здесь: deflate (срез ужимается примерно впятеро)
// и сброс устаревших срезов при заторе — см. broadcastVolatile.
// ---------------------------------------------------------------------------
const net = require('node:net');
const os = require('node:os');
const dgram = require('node:dgram');
const zlib = require('node:zlib');

const PORT = 47624;
/** Порт объявлений: по нему хосты откликаются на поиск в локальной сети. */
const DISCOVERY_PORT = 47625;
const DISCOVERY_MAGIC = 'SGW2';
/** Сколько ждать соединения, прежде чем признать хост недоступным. */
const CONNECT_TIMEOUT_MS = 6000;
/** Кадр больше этого — обрыв связи: защита от мусора из открытого порта. */
const MAX_FRAME = 8 * 1024 * 1024;
/** Мельче этого сжимать незачем: заголовок deflate съест всю выгоду. */
const COMPRESS_OVER = 1024;
/**
 * Сколько байт уже ждёт отправки, чтобы считать канал забитым.
 *
 * Порог намеренно невелик: срез мира самодостаточен, и пропустить один при
 * заторе не стоит ничего — следующий придёт целым и более свежим. А вот
 * копить их в очереди означает показывать клиенту прошлое.
 */
const BACKLOG_LIMIT = 192 * 1024;

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

/** Собрать кадр: длина, признак сжатия, тело. */
function frame(msg) {
  const json = Buffer.from(JSON.stringify(msg), 'utf8');
  const packed = json.length >= COMPRESS_OVER;
  const body = packed ? zlib.deflateSync(json) : json;
  const head = Buffer.allocUnsafe(5);
  head.writeUInt32BE(body.length, 0);
  head.writeUInt8(packed ? 1 : 0, 4);
  return Buffer.concat([head, body]);
}

/** Разбор потока кадров с ограничением длины. */
function attachReader(socket, onMessage, onFail) {
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 5) return;
      const len = buf.readUInt32BE(0);
      if (len > MAX_FRAME) {
        onFail(new Error('кадр превысил лимит'));
        socket.destroy();
        buf = Buffer.alloc(0);
        return;
      }
      if (buf.length < 5 + len) return;
      const packed = buf.readUInt8(4) === 1;
      const body = buf.subarray(5, 5 + len);
      // Копия, а не срез: subarray держит ссылку на весь накопленный буфер,
      // и без копии он не освободится, пока живёт последний кадр.
      buf = Buffer.from(buf.subarray(5 + len));
      try {
        const json = packed ? zlib.inflateSync(body) : body;
        onMessage(JSON.parse(json.toString('utf8')));
      } catch (e) {
        onFail(e);
      }
    }
  });
}

function writeTo(socket, msg) {
  if (!socket || socket.destroyed) return false;
  try {
    socket.write(frame(msg));
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
    if (!socket.destroyed) socket.end(frame({ k: 'bye', reason }));
  } catch { /* канал уже мёртв — достаточно снять его с учёта */ }
  peers.delete(id);
  setTimeout(() => socket.destroy(), 200);
  return true;
}

function broadcast(msg) {
  const f = frame(msg);
  let sent = 0;
  for (const s of peers.values()) {
    if (s.destroyed) continue;
    try {
      s.write(f);
      sent++;
    } catch { /* соединение уже мертво — уберётся по close */ }
  }
  return sent;
}

/**
 * Рассылка того, что не жалко потерять, — срезов мира.
 *
 * Клиенту с забитым каналом кадр НЕ отправляется вовсе. Это не потеря данных:
 * каждый срез самодостаточен и описывает мир целиком, поэтому пропуск просто
 * означает, что этот клиент увидит следующее состояние вместо промежуточного.
 * Альтернатива — та самая очередь, из-за которой отставание росло без предела.
 */
function broadcastVolatile(msg) {
  const f = frame(msg);
  let sent = 0;
  let skipped = 0;
  for (const s of peers.values()) {
    if (s.destroyed) continue;
    if (s.writableLength > BACKLOG_LIMIT) {
      skipped++;
      continue;
    }
    try {
      s.write(f);
      sent++;
    } catch { /* соединение уже мертво — уберётся по close */ }
  }
  return { sent, skipped, bytes: f.length };
}

/** Сколько байт ждёт отправки каждому — диагностика затора. */
function peerBacklog() {
  const out = {};
  for (const [id, s] of peers) out[id] = s.destroyed ? -1 : s.writableLength;
  return out;
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
  PORT, startHost, joinHost, sendToPeer, sendToHost, broadcast, broadcastVolatile,
  peerBacklog, stopAll, localAddresses, addressList, setDeliver, dropPeer,
  startBeacon, stopBeacon, discoverHosts,
};
