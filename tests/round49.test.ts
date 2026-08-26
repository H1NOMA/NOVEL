// Раунд 49: выбор сети партии вместо случайного адаптера, поиск партий в
// локальной сети, понятные ошибки подключения и ночная сторона у планет.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, planetsOf } from '../src/game/state';
import { OBJECTIVES, objectivesFor } from '../src/game/objectives';
import { FACTIONS, FACTION_IDS } from '../src/data/factions';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');

// --- Ранжирование адаптеров ---------------------------------------------------
{
  const netjs = read('electron', 'net.cjs');
  ok(netjs.includes('function virtualKind('), 'виртуальные адаптеры распознаются');
  // Именно из-за него код партии указывал в пустоту: 26.x — это Radmin VPN.
  for (const [range, who] of [['^26\\.', 'Radmin VPN'], ['^25\\.', 'Hamachi'],
    ['^192\\.168\\.56\\.', 'VirtualBox'], ['^169\\.254\\.', 'без связи']] as const) {
    ok(netjs.includes(range), `диапазон распознаётся: ${who} (${range})`);
  }
  for (const name of ['radmin', 'hamachi', 'docker', 'vmware', 'wsl', 'hyper-v']) {
    ok(netjs.includes(`'${name}'`) || netjs.includes(`("${name}")`) || netjs.includes(name),
      `адаптер по имени: ${name}`);
  }
  ok(netjs.includes('function isLan('), 'обычная локальная сеть выделена отдельно');
  ok(netjs.includes('out.sort((a, b) => a.rank - b.rank'), 'адреса сортируются по пригодности');
  // Список отдаётся целиком с именами: угадать нужную сеть программа не может.
  ok(netjs.includes('kind') && netjs.includes('rank'), 'у адреса есть вид и ранг');
  console.log('ранжирование адаптеров: OK');
}

// --- Хост выбирает сеть -------------------------------------------------------
{
  const session = read('src', 'net', 'session.ts');
  ok(session.includes('export function setHostAddress('), 'сеть партии переключается');
  ok(session.includes('export function getHostAdapters('), 'список адаптеров доступен интерфейсу');
  const setter = session.slice(session.indexOf('export function setHostAddress('),
    session.indexOf('export function setHostAddress(') + 420);
  ok(setter.includes('partyCodeFor([address]'), 'код пересчитывается под выбранный адрес');
  ok(setter.includes('pushLobby()'), 'смена сети сразу расходится по лобби');
  ok(setter.includes("role !== 'host'"), 'переключать сеть может только хост');

  const party = read('src', 'ui', 'party.ts');
  ok(party.includes('export function adapterPicker('), 'выбор сети есть в интерфейсе');
  ok(party.includes('adapters.length < 2'), 'при единственном адресе выбор не показывается');
  const menu = read('src', 'ui', 'mainMenu.ts');
  ok(menu.includes('adapterPicker(getHostAdapters()'), 'выбор сети виден в лобби');
  ok(menu.includes('data-adapter'), 'переключение подключено');
  console.log('выбор сети партии: OK');
}

// --- Поиск партий в локальной сети ---------------------------------------------
{
  const netjs = read('electron', 'net.cjs');
  ok(netjs.includes("require('node:dgram')"), 'поиск идёт по UDP');
  ok(netjs.includes('function startBeacon('), 'хост откликается на поиск');
  ok(netjs.includes('function discoverHosts('), 'клиент умеет искать');
  ok(netjs.includes('setBroadcast(true)'), 'запрос широковещательный');
  // 255.255.255.255 в части сетей фильтруется — шлём и по своим подсетям.
  ok(netjs.includes("'255.255.255.255'") && netjs.includes('.255`'),
    'запрос идёт и в общий эфир, и по своим подсетям');
  ok(netjs.includes('buf.length > 256'), 'мусор из эфира отсекается по размеру');
  ok(netjs.includes('DISCOVERY_MAGIC'), 'чужие пакеты отсеиваются по метке');

  const session = read('src', 'net', 'session.ts');
  ok(session.includes('export async function findParties('), 'поиск проброшен в игру');
  ok(session.includes('net.beacon({'), 'хост включает маяк');
  ok(session.includes('beacon(null)'), 'и гасит его при выходе');
  const menu = read('src', 'ui', 'mainMenu.ts');
  ok(menu.includes('scanParties'), 'меню запускает поиск');
  ok(menu.includes('data-join-addr'), 'найденная партия кликабельна');
  ok(menu.includes('Партии рядом'), 'список найденного показан');
  console.log('поиск партий: OK');
}

// --- Подключение: таймаут и понятные ошибки --------------------------------------
{
  const netjs = read('electron', 'net.cjs');
  ok(netjs.includes('CONNECT_TIMEOUT_MS'), 'у подключения есть таймаут');
  ok(/CONNECT_TIMEOUT_MS\s*=\s*\d+/.test(netjs), 'таймаут задан числом');
  const t = Number(/CONNECT_TIMEOUT_MS\s*=\s*(\d+)/.exec(netjs)?.[1]);
  ok(t > 0 && t <= 15000, `таймаут разумный (${t} мс)`);
  ok(netjs.includes('socket.setTimeout(0)'), 'с установленного соединения таймаут снимается');
  ok(netjs.includes('function joinError('), 'коды ошибок переводятся на человеческий');
  for (const code of ['ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND']) {
    ok(netjs.includes(`'${code}'`), `разбирается код ${code}`);
  }
  // Именно эта ошибка и пришла игроку — она обязана объяснять причину.
  const timeoutMsg = netjs.slice(netjs.indexOf("case 'ETIMEDOUT':"), netjs.indexOf("case 'ECONNREFUSED':"));
  ok(timeoutMsg.includes('брандмауэр'), 'таймаут объясняет про брандмауэр');
  ok(timeoutMsg.includes('сет'), 'и про разные сети');
  console.log('таймаут и ошибки подключения: OK');
}

// --- Планеты: ночная сторона ------------------------------------------------------
{
  const mesh = read('src', 'render', 'planetMesh.ts');
  // Заворот света за терминатор был так широк, что ночной стороны не было.
  const wrap = Number(/const float WRAP = ([\d.]+);/.exec(mesh)?.[1]);
  ok(wrap > 0 && wrap <= 0.16, `заворот света узкий (${wrap})`);
  const amb = /vec3 skyAmb = vec3\(([\d.]+), ([\d.]+), ([\d.]+)\)/.exec(mesh);
  ok(!!amb && Number(amb[3]) <= 0.12, `ambient приглушён (${amb?.[3]})`);
  // Ореол атмосферы обязан зависеть от солнца, иначе планета — плоский круг.
  const atmo = mesh.slice(mesh.indexOf('const ATMO_FRAG'), mesh.indexOf('const SPHERE_GEO'));
  ok(atmo.includes('vec3 sun'), 'ореол знает направление на солнце');
  ok(atmo.includes('dot(nrm, sun)'), 'и гаснет на ночной стороне');
  ok(/0\.0\d+ \+ 0\.\d+ \* lit/.test(atmo), 'на ночной стороне остаётся слабый контур');

  const scene = read('src', 'render', 'scene.ts');
  const exp = Number(/toneMappingExposure = ([\d.]+)/.exec(scene)?.[1]);
  ok(exp > 0 && exp <= 1.0, `экспозиция не задрана (${exp})`);
  // Плиты секторов лежат ковром под всей картой — на прежней яркости они
  // превращали космос в цветной пол.
  ok(scene.includes('multiplyScalar(0.5)'), 'заливка сектора затемнена');
  const fill = /vis\.fillMat\.opacity = ([\d.]+);/.exec(scene);
  ok(!!fill && Number(fill[1]) <= 0.035, `заливка сектора слабая (${fill?.[1]})`);

  const sf = read('src', 'render', 'starfield.ts');
  const disc = /rgba\(120,180,255,([\d.]+)\)/.exec(sf);
  ok(!!disc && Number(disc[1]) <= 0.1, `аддитивный диск галактики приглушён (${disc?.[1]})`);
  console.log('ночная сторона планет: OK');
}

// --- Цели кампании не выполняются на старте ------------------------------------------
{
  // Партия начинается с 95% галактики в руках, поэтому числовые пороги
  // владений закрывались в первую же минуту.
  for (const seed of [1, 2024, 77777]) {
    for (const f of FACTION_IDS.filter((x) => FACTIONS[x].playable)) {
      const s = createGame(seed, f);
      const done = objectivesFor(f).filter((o) => o.check(s, f)).map((o) => o.title);
      ok(done.length === 0, `сид ${seed}, ${f}: на первый день целей не выполнено (${done.join(', ')})`);
    }
  }
  const s = createGame(1, 'superEarth');
  const share = planetsOf(s, 'superEarth').length / s.galaxy.order.length;
  ok(share > 0.9, `стартовые владения действительно велики (${(share * 100).toFixed(0)}%)`);
  ok(!OBJECTIVES.some((o) => o.id === 'obj_fifty'), 'мёртвая цель по числу планет убрана');
  const src = read('src', 'game', 'objectives.ts');
  ok(src.includes('function capturedCapital('), 'взятие столицы проверяется отдельно');
  ok(src.includes('p.origin !== by'), 'своя изначальная столица целью не считается');
  console.log('цели кампании: OK');
}

console.log(`round49: OK (${checks} проверок)`);
