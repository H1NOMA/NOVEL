// Раунд 52: клиенты перестали отставать от хоста (затор в сокете и сжатие),
// пинг в списке игроков, версия в меню, карта переделана — чёрный космос,
// круглые звёзды, мировое солнце, — окна таскаются и не теряют прокрутку.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createConnection, type Socket } from 'node:net';
import { deflateSync } from 'node:zlib';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}
const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');

// --- Транспорт: живая проверка кадров и затора ---------------------------------
//
// Это главная правка раунда, и проверяется она не по исходнику, а на настоящих
// сокетах: хост поднимается, к нему подключается сырой клиент, и через канал
// гоняются те же кадры, что в партии.
async function transport(): Promise<void> {
  const require = createRequire(join(process.cwd(), 'package.json'));
  const gameNet = require('./electron/net.cjs') as {
    startHost(port: number): Promise<{ ok: boolean }>;
    broadcastVolatile(msg: unknown): { sent: number; skipped: number; bytes: number };
    peerBacklog(): Record<string, number>;
    setDeliver(fn: (kind: string, p: { msg?: unknown }) => void): void;
    stopAll(): void;
  };

  const got: unknown[] = [];
  gameNet.setDeliver((kind, p) => {
    if (kind === 'message' && p.msg) got.push(p.msg);
  });
  const started = await gameNet.startHost(47701);
  ok(started.ok, 'хост поднимается на тестовом порту');

  const client: Socket = await new Promise((res) => {
    const s = createConnection({ host: '127.0.0.1', port: 47701 }, () => res(s));
  });

  // Кадр: 4 байта длины, байт признака сжатия, тело. Собираем вручную —
  // тест обязан знать формат, а не подсматривать его у реализации.
  const send = (obj: unknown, packed: boolean): void => {
    const json = Buffer.from(JSON.stringify(obj), 'utf8');
    const body = packed ? deflateSync(json) : json;
    const head = Buffer.allocUnsafe(5);
    head.writeUInt32BE(body.length, 0);
    head.writeUInt8(packed ? 1 : 0, 4);
    client.write(Buffer.concat([head, body]));
  };

  // Мелкое без сжатия и крупное со сжатием — хост обязан разобрать оба.
  send({ k: 'hello', version: 3, name: 'Тест' }, false);
  const bulky = { k: 'cmd', cmd: { k: 'setSpeed', speed: 2 }, pad: 'э'.repeat(20000) };
  send(bulky, true);
  await new Promise((r) => setTimeout(r, 400));
  ok(got.length === 2, `хост принял оба кадра (${got.length})`);
  ok((got[0] as { k: string }).k === 'hello', 'мелкий кадр разобран');
  ok((got[1] as { pad: string }).pad.length === 20000, 'сжатый крупный кадр разобран без потерь');

  // Кадр от хоста реально сжимается.
  //
  // Срез генерируется здесь и имеет ФИКСИРОВАННЫЙ размер. Раньше его брали из
  // package-lock.json, и тест незаметно зависел от веса этого файла: смена
  // одной зависимости меняла срез на пару килобайт, сокет переставал
  // захлёбываться, и падала проверка затора ниже — хотя сеть была ни при чём.
  // Текст нарочно неоднородный: ровные повторы сжались бы почти в ноль, и
  // затора снова не вышло бы.
  const words = ['planet', 'fleet', 'supply', 'garrison', 'orbit', 'sector', 'invasion',
    'superEarth', 'automatons', 'illuminate', 'terminids', 'shipyard', 'depot'];
  let blob = '';
  let seed = 20260828;
  while (blob.length < 200 * 1024) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    blob += `${words[seed % words.length]}:${seed % 9973},`;
  }
  const payload = { k: 'snapshot', snapshot: blob };
  const raw = JSON.stringify(payload).length;
  const frameOut = gameNet.broadcastVolatile(payload);
  ok(frameOut.sent === 1, 'срез ушёл единственному клиенту');
  ok(frameOut.bytes < raw / 2, `кадр сжат заметно (${frameOut.bytes} против ${raw})`);

  // Затор: клиент перестаёт читать, хост обязан ПРОПУСКАТЬ срезы, а не копить.
  client.pause();
  let sent = 0;
  let skipped = 0;
  let maxQueue = 0;
  // Срезы идут ПАЧКОЙ, без пауз между ними: именно так выглядит хост на
  // тройной скорости против клиента, который не успевает читать. С паузой на
  // setImmediate после каждого кадра петля успевала сливать сокет и очередь не
  // добиралась до порога — тест ловил не затор, а скорость петли.
  for (let i = 0; i < 300; i++) {
    const r = gameNet.broadcastVolatile(payload);
    sent += r.sent;
    skipped += r.skipped;
    maxQueue = Math.max(maxQueue, Object.values(gameNet.peerBacklog())[0] ?? 0);
    if (i % 50 === 49) await new Promise((r2) => setImmediate(r2));
  }
  ok(skipped > 0, `при заторе срезы пропускаются (пропущено ${skipped} из 300)`);
  // Без сброса очередь выросла бы на 300 кадров; проверяем, что потолок близок
  // к порогу, а не к сумме всего отправленного.
  ok(maxQueue < sent * frameOut.bytes * 0.5,
    `очередь не растёт без предела (${(maxQueue / 1024).toFixed(0)} КиБ)`);

  client.destroy();
  gameNet.stopAll();
  console.log('транспорт: OK');
}

// --- Исходник транспорта и сессии ------------------------------------------------
{
  const netjs = read('electron', 'net.cjs');
  ok(netjs.includes("require('node:zlib')"), 'сжатие подключено');
  ok(netjs.includes('function frame('), 'кадры собираются в одном месте');
  ok(netjs.includes('head.writeUInt32BE'), 'длина кадра идёт заголовком');
  ok(netjs.includes('function broadcastVolatile('), 'есть рассылка «не жалко потерять»');
  ok(netjs.includes('s.writableLength > BACKLOG_LIMIT'), 'забитый канал пропускается');
  ok(/BACKLOG_LIMIT = \d+ \* 1024/.test(netjs), 'порог затора задан числом');
  ok(!netjs.includes("socket.setEncoding('utf8')"), 'построчного текстового разбора больше нет');

  const session = read('src', 'net', 'session.ts');
  ok(session.includes('net.broadcastVolatile'), 'срезы уходят именно этим каналом');
  ok(session.includes('startPingLoop('), 'хост замеряет задержку');
  ok(session.includes("{ k: 'pong', t: msg.t }"), 'клиент возвращает штамп без обработки');
  ok(session.includes('peerPing.set(from, rtt)'), 'задержка запоминается по игроку');
  const proto = read('src', 'net', 'protocol.ts');
  ok(proto.includes("k: 'ping'") && proto.includes("k: 'pong'"), 'замер описан в протоколе');
  ok(proto.includes('ping?: number | null'), 'задержка едет в списке игроков');
  console.log('сеть и пинг: OK');
}

// --- Пинг под ником и версия в меню ------------------------------------------------
{
  const party = read('src', 'ui', 'party.ts');
  ok(party.includes('function pingCell('), 'ячейка задержки есть');
  ok(party.includes('party-who'), 'ник и пинг стоят столбиком');
  const css = read('src', 'style.css');
  for (const cls of ['good', 'warn', 'bad']) {
    ok(party.includes(`'${cls}'`), `у задержки есть степень: ${cls}`);
    ok(css.includes(`.party-ping.${cls}`), `и свой цвет: ${cls}`);
  }
  ok(party.includes("m.isHost) return '<span class=\"party-ping host\">"), 'у хоста задержки нет');

  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes('private refreshRoster('), 'список игроков обновляется живьём');
  ok(ui.includes('menu-roster'), 'у списка есть свой контейнер');
  // Меню одного игрока не имеет права морозить войну у остальных.
  ok(ui.includes("if (currentRole() === 'single')"), 'пауза по ESC — только в одиночной партии');

  const menu = read('src', 'ui', 'mainMenu.ts');
  ok(menu.includes('mm-version') && menu.includes('__APP_VERSION__'), 'версия выводится в меню');
  ok(css.includes('.mm-version'), 'версия стоит в углу');
  const vite = read('vite.config.ts');
  ok(vite.includes('__APP_VERSION__'), 'версия подставляется сборщиком');
  ok(vite.includes('RELEASE_TAG'), 'в релизе версию задаёт тег');
  const wf = read('.github', 'workflows', 'desktop-build.yml');
  ok(wf.includes('RELEASE_TAG:'), 'CI передаёт тег в сборку');
  console.log('версия и пинг в интерфейсе: OK');
}

// --- Карта: чёрный космос, круглые звёзды, мировое солнце ---------------------------
{
  const sky = read('src', 'render', 'starfield.ts');
  ok(!sky.includes('PointsMaterial'), 'квадратных точек больше нет');
  ok(sky.includes('gl_PointCoord'), 'звезда рисуется по своей форме');
  ok(sky.includes('if (r > 1.0) discard;'), 'всё вне круга отсекается');
  ok(sky.includes('uPixelRatio'), 'размер звезды задан в пикселях');
  ok(sky.includes('aPhase'), 'мерцание у каждой звезды своё');

  const scene = read('src', 'render', 'scene.ts');
  const eng = read('src', 'render', 'engine.ts');
  ok(eng.includes('new Color4(0, 0, 0, 1)'), 'космос чёрный');
  // Порядок вывода держит конвейер движка: тон-маппинг и перевод в sRGB он
  // делает ровно один раз, в самом конце цепочки.
  ok(scene.includes('ip.toneMappingEnabled = true')
    && scene.includes('TONEMAPPING_ACES'), 'вывод цепочки приведён в порядок');
  ok(scene.includes('this.pipeline.samples ='), 'сглаживание внутри цепочки');
  ok(scene.includes("new DirectionalLight('key', SUN_DIR"), 'корабли освещены тем же солнцем');

  const mesh = read('src', 'render', 'planetShaders.ts');
  ok(eng.includes('export const SUN_DIR'), 'солнце карты — общее направление на всю карту');
  ok(mesh.includes('vWorldN') && mesh.includes('mat3(world) * normal'),
    'свет считается в мировых координатах');
  ok(!mesh.includes('vec3 sun = normalize(vec3(0.55, 0.35, 0.75))'),
    'прибитого к камере солнца больше нет');
  ok(mesh.includes('uniform vec3 uSun'), 'солнце приходит извне');

  const fleets = read('src', 'render', 'fleets.ts');
  ok(fleets.includes('function beaconTexture('), 'у соединений есть опознавательный огонь');
  ok(fleets.includes('model.scaling.scaleInPlace('), 'силуэт корабля укрупнён');

  // Детализация и сглаживание платятся качеством, а не всегда.
  const st = read('src', 'ui', 'settings.ts');
  ok(st.includes('samples: 0') && st.includes('samples: 4'), 'сглаживание зависит от пресета');
  console.log('карта: OK');
}

// --- Окна: прокрутка и перетаскивание ------------------------------------------------
{
  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes('private paint(host: HTMLElement, html: string)'), 'есть общая перерисовка окна');
  ok(ui.includes('e.scrollTop') && ui.includes('keep['), 'прокрутка снимается и возвращается');
  // Ни одно из живых окон не должно переписываться в обход paint.
  for (const el of ['dossierEl', 'decisionsEl', 'productionEl', 'resourceEl', 'factionEl', 'fleetDetailEl']) {
    ok(!ui.includes(`this.${el}.innerHTML = `), `${el} перерисовывается через paint`);
  }
  ok(ui.includes('private wireDrag('), 'перетаскивание вынесено в общий метод');
  ok(ui.includes('private panelPos = new Map'), 'положение окна запоминается');
  ok(ui.includes('wireDrag(this.fleetDetailEl)'), 'карточка соединения таскается');
  ok(ui.includes('wireDrag(this.resourceEl)') && ui.includes('wireDrag(this.factionEl)'),
    'окна ресурсов и фракции тоже');

  // Утечка подписки туториала.
  ok(ui.includes('this.tutorialOff'), 'обучение снимает свою подписку с шины');
  console.log('окна: OK');
}

// --- Чистота репозитория ----------------------------------------------------------
{
  const pkg = JSON.parse(read('package.json')) as {
    version: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
    'у игры нет зависимостей во время работы');
  ok(!pkg.devDependencies?.playwright, 'playwright не остался в зависимостях');
  ok(/^\d+\.\d+\.\d+$/.test(pkg.version), `версия проекта осмысленная (${pkg.version})`);

  // Мёртвые экспорты, найденные аудитом, действительно убраны.
  for (const [file, name] of [
    ['src/render/planetAssets.ts', 'asteroidGeometry'],
    ['src/game/persist.ts', 'getAutosaveDays'],
    ['src/game/trophies.ts', 'nodeById'],
    ['src/ui/uiScale.ts', 'setUiScale'],
    ['src/data/biomes.ts', 'BIOME_LIST'],
  ] as const) {
    ok(!read(...file.split('/')).includes(`export function ${name}`)
      && !read(...file.split('/')).includes(`export const ${name}`),
      `мёртвый экспорт убран: ${name}`);
  }

  const readme = read('README.md');
  ok(readme.includes('Вторая Галактическая война'), 'описание проекта на месте');
  ok(readme.includes('Сетевая игра'), 'сетевая партия описана');
  ok(readme.includes('форма галактики') || readme.includes('форму галактики'), 'формы галактики описаны');
  console.log('репозиторий: OK');
}

// Раннер собирает тесты в CJS, поэтому await верхнего уровня недоступен:
// асинхронную часть запускаем явно и сами решаем судьбу процесса.
transport().then(() => {
  console.log(`round52: OK (${checks} проверок)`);
}).catch((e: unknown) => {
  console.error('FAIL: транспорт —', e);
  process.exit(1);
});
