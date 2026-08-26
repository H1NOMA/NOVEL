// Раунд 48: код партии и список игроков, плавность интерфейса и перелётов,
// расширенная галактика, новые миры и фоновые туманности.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateGalaxy } from '../src/game/galaxy';
import {
  decodePartyCode, encodePartyCode, normalizeCode, partyCodeFor, resolveJoinTarget,
} from '../src/net/partyCode';
import { DEFAULT_PORT } from '../src/net/protocol';
import { FOCUS_TREES } from '../src/data/focus';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');

// --- Код партии: туда и обратно ---------------------------------------------------
{
  const code = encodePartyCode('192.168.1.42', DEFAULT_PORT);
  ok(!!code, 'код для обычного адреса выдан');
  ok(/^[0-9A-HJ-KM-NP-TV-Z]{4}-[0-9A-HJ-KM-NP-TV-Z]{4}$/.test(code!),
    `код из двух групп по четыре знака (${code})`);
  const back = decodePartyCode(code!);
  ok(back?.host === '192.168.1.42', `адрес восстановлен (${back?.host})`);
  ok(back?.port === DEFAULT_PORT, 'порт восстановлен');

  // Нестандартный порт тоже переживает поездку.
  const c2 = encodePartyCode('10.0.0.7', DEFAULT_PORT + 5)!;
  const b2 = decodePartyCode(c2)!;
  ok(b2.host === '10.0.0.7' && b2.port === DEFAULT_PORT + 5, 'нестандартный порт восстановлен');

  // Разные адреса — разные коды.
  const seen = new Set<string>();
  for (let i = 1; i < 60; i++) seen.add(encodePartyCode(`192.168.1.${i}`)!);
  ok(seen.size === 59, `коды не совпадают между хостами (${seen.size} из 59)`);
  console.log('код партии: OK');
}

// --- Код диктуют вслух: похожие знаки прощаются ------------------------------------
{
  const code = encodePartyCode('172.16.4.9')!;
  const spoken = code.replace(/1/g, 'I').replace(/0/g, 'O').toLowerCase();
  ok(decodePartyCode(spoken)?.host === '172.16.4.9', 'I вместо 1 и O вместо 0 разбираются');
  ok(decodePartyCode(code.replace('-', ' '))?.host === '172.16.4.9', 'разделитель не важен');
  ok(normalizeCode('  a7k2 - 9qx4 ') === 'A7K29QX4', 'нормализация чистит мусор');

  // Мусор не должен притворяться кодом.
  ok(decodePartyCode('') === null, 'пустая строка — не код');
  ok(decodePartyCode('ABC') === null, 'короткая строка — не код');
  ok(encodePartyCode('не-адрес') === null, 'не-IPv4 кодом не становится');
  ok(encodePartyCode('999.1.1.1') === null, 'битый октет отвергается');
  console.log('устойчивость кода: OK');
}

// --- Подключение принимает и код, и адрес -------------------------------------------
{
  const code = encodePartyCode('192.168.0.15')!;
  ok(resolveJoinTarget(code)?.host === '192.168.0.15', 'код разбирается');
  ok(resolveJoinTarget('192.168.0.15')?.host === '192.168.0.15', 'голый адрес тоже');
  ok(resolveJoinTarget('192.168.0.15:47700')?.port === 47700, 'адрес с портом тоже');
  ok(resolveJoinTarget('host.local')?.port === DEFAULT_PORT, 'имя хоста — порт по умолчанию');
  ok(resolveJoinTarget('   ') === null, 'пустой ввод отвергается');
  ok(partyCodeFor(['127.0.0.1', '192.168.1.5']) !== null, 'код берётся из первого пригодного адреса');
  ok(partyCodeFor([]) === null, 'без адресов кода нет');
  console.log('разбор адреса подключения: OK');
}

// --- Список игроков и исключение ------------------------------------------------------
{
  const proto = read('src', 'net', 'protocol.ts');
  ok(proto.includes('interface PartyMember'), 'в протоколе есть строка списка игроков');
  ok(proto.includes('code?: string | null'), 'код партии ходит по сети');

  const session = read('src', 'net', 'session.ts');
  ok(session.includes('export function kickPeer('), 'хост умеет исключать');
  ok(session.includes('export function getPartyCode('), 'код партии доступен интерфейсу');
  ok(session.includes('export function getPartyMembers('), 'список игроков доступен интерфейсу');
  // Исключённый не должен остаться человеком в состоянии — иначе его фракция
  // замрёт без ИИ и без игрока.
  const kick = session.slice(session.indexOf('export function kickPeer('),
    session.indexOf('export function kickPeer(') + 700);
  ok(kick.includes('peerFaction.delete(peer)'), 'место освобождается');
  ok(kick.includes('state.humans = state.humans.filter'), 'фракцию подхватывает ИИ');
  ok(kick.includes('net.drop(peer'), 'канал закрывается');
  ok(kick.includes("peer === 'host'"), 'себя исключить нельзя');

  // Мост и главный процесс умеют разрывать одно соединение.
  ok(read('src', 'net', 'bridge.ts').includes('drop(peer: string'), 'мост знает про исключение');
  ok(read('electron', 'net.cjs').includes('function dropPeer('), 'сетевой слой умеет рвать одно соединение');
  ok(read('electron', 'preload.cjs').includes("invoke('net:drop'"), 'preload прокидывает исключение');
  ok(read('electron', 'main.cjs').includes("ipcMain.handle('net:drop'"), 'главный процесс обрабатывает его');
  console.log('список игроков и исключение: OK');
}

// --- Где это видно -------------------------------------------------------------------
{
  const menu = read('src', 'ui', 'mainMenu.ts');
  const ui = read('src', 'ui', 'ui.ts');
  const party = read('src', 'ui', 'party.ts');
  ok(party.includes('export function partyCodeBlock('), 'блок кода вынесен в общий модуль');
  ok(party.includes('export function rosterList('), 'список игроков — тоже');
  ok(party.includes('data-kick='), 'у строки игрока есть кнопка исключения');
  // Лобби: код виден до старта.
  ok(menu.includes('partyCodeBlock(code)'), 'код партии виден в лобби');
  ok(menu.includes('rosterList(getPartyMembers(), this.isHost)'), 'список игроков виден в лобби');
  // Меню паузы: то же самое во время партии.
  ok(ui.includes('partyCodeBlock(code)'), 'код партии виден по Esc');
  ok(ui.includes('rosterList(members, isHost)'), 'список игроков виден по Esc');
  ok(ui.includes("currentRole() === 'host'"), 'кнопки исключения только у хоста');
  console.log('видимость кода и списка: OK');
}

// --- Галактика: больше, разнообразнее, но круг ------------------------------------------
{
  for (const seed of [1, 2024, 77777]) {
    const g = generateGalaxy(seed);
    ok(g.order.length >= 150, `сид ${seed}: планет стало больше (${g.order.length})`);
    ok(g.sectors.size >= 50, `сид ${seed}: секторов стало больше (${g.sectors.size})`);

    // Каждое кольцо покрыто целиком: карта остаётся кругом без прорех.
    const rings = new Map<number, { a0: number; a1: number; r0: number; r1: number }[]>();
    for (const s of g.sectors.values()) {
      if (s.ring === 0) continue;
      const list = rings.get(s.ring) ?? [];
      list.push({ a0: s.a0, a1: s.a1, r0: s.r0, r1: s.r1 });
      rings.set(s.ring, list);
    }
    for (const [ring, arr] of rings) {
      arr.sort((a, b) => a.a0 - b.a0);
      const cover = arr.reduce((sum, s) => sum + (s.a1 - s.a0), 0);
      ok(Math.abs(cover - Math.PI * 2) < 1e-6, `сид ${seed}, кольцо ${ring}: покрыт полный круг`);
      for (let i = 1; i < arr.length; i++) {
        ok(Math.abs(arr[i]!.a0 - arr[i - 1]!.a1) < 1e-9, `сид ${seed}, кольцо ${ring}: без разрывов`);
      }
      // Формы разные: в кольце должны встречаться и узкие, и широкие доли.
      // На малых кольцах жребий бросается всего четыре раза, поэтому разброс
      // там закономерно меньше — порог мягче.
      const widths = arr.map((s) => s.a1 - s.a0);
      const spread = Math.max(...widths) / Math.min(...widths);
      ok(spread > (arr.length >= 6 ? 1.4 : 1.1),
        `сид ${seed}, кольцо ${ring}: сектора разной ширины (×${spread.toFixed(2)})`);
    }

    // Кольца не наезжают друг на друга: выпуклость держится в пределах отступа.
    const ringIds = [...rings.keys()].sort((a, b) => a - b);
    for (let i = 1; i < ringIds.length; i++) {
      const prevMax = Math.max(...rings.get(ringIds[i - 1]!)!.map((s) => s.r1));
      const curMin = Math.min(...rings.get(ringIds[i]!)!.map((s) => s.r0));
      ok(curMin > prevMax, `сид ${seed}: кольца ${ringIds[i - 1]}→${ringIds[i]} не пересекаются`);
    }

    // Пустых секторов быть не должно — дырка на карте выглядит как баг.
    ok([...g.sectors.values()].every((s) => s.planets.length > 0), `сид ${seed}: пустых секторов нет`);
    // Каждая планета внутри своего сектора.
    for (const s of g.sectors.values()) {
      if (s.ring === 0) continue;
      for (const pid of s.planets) {
        const p = g.planets.get(pid)!;
        ok(p.radius >= s.r0 && p.radius <= s.r1, `сид ${seed}: ${pid} внутри полосы сектора`);
      }
    }
    // Карта связна: снабжение должно доходить до каждого мира.
    const seen = new Set<string>(['p_super_earth']);
    const queue = ['p_super_earth'];
    while (queue.length) {
      const cur = g.planets.get(queue.pop()!)!;
      for (const n of cur.links) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    ok(seen.size === g.order.length, `сид ${seed}: карта связна (${seen.size} из ${g.order.length})`);
  }
  console.log('галактика: OK');
}

// --- Миры: больше семейств рельефа, без мерцания ------------------------------------------
{
  const files = readdirSync(join(process.cwd(), 'src', 'assets', 'planets'))
    .filter((f) => f.endsWith('.glb'));
  ok(files.length >= 15, `мешей миров стало больше (${files.length})`);
  for (const name of ['canyon', 'archipelago', 'shard', 'mesa', 'basin', 'storm']) {
    ok(files.includes(`${name}.glb`), `новое семейство рельефа: ${name}`);
  }
  const assets = read('src', 'render', 'planetAssets.ts');
  // Каждый биом должен иметь выбор: один вариант — все миры биома одинаковы.
  const table = assets.slice(assets.indexOf('const BIOME_RELIEF'), assets.indexOf('export function reliefGeometry'));
  const pools = [...table.matchAll(/\w+:\s*\[([^\]]+)\]/g)].map((m) => m[1]!.split(',').length);
  ok(pools.length >= 10, `таблица рельефа заполнена (${pools.length} биомов)`);
  ok(pools.every((n) => n >= 3), 'у каждого биома минимум три варианта рельефа');

  // Мерцание лавы: общий множитель яркости по времени убран.
  const mesh = read('src', 'render', 'planetMesh.ts');
  ok(!mesh.includes('float flicker'), 'строб на пожарах убран');
  ok(!/pulse\s*=\s*0\.8\s*\+\s*0\.2\s*\*\s*sin\(uTime/.test(mesh), 'общая пульсация лавы убрана');
  ok(mesh.includes('float heat = fbm(flow)'), 'вместо мигания по поверхности течёт тепловой шум');
  console.log('миры: OK');
}

// --- Туманности: далёкий фон ----------------------------------------------------------
{
  const sf = read('src', 'render', 'starfield.ts');
  ok(sf.includes('export function createNebulaField('), 'фоновые туманности есть');
  const fn = sf.slice(sf.indexOf('export function createNebulaField('),
    sf.indexOf('export interface CometLayer'));
  const far = /worldRadius \* (\d+)/.exec(fn);
  ok(!!far && Number(far[1]) >= 5, `облака вынесены далеко за карту (×${far?.[1]})`);
  ok(fn.includes('depthTest: false'), 'туманности не спорят с планетами по глубине');
  ok(fn.includes('renderOrder = -100'), 'рисуются раньше всего — всегда сзади');
  const scene = read('src', 'render', 'scene.ts');
  ok(scene.includes('createNebulaField('), 'сцена их подключает');
  ok(scene.includes('this.nebulae.visible'), 'на низком качестве гаснут');
  console.log('туманности: OK');
}

// --- Плавность: перелёты и интерфейс ------------------------------------------------------
{
  const fleets = read('src', 'render', 'fleets.ts');
  ok(fleets.includes('function catmull('), 'перелёт считается по сплайну');
  ok(fleets.includes('function smoothTransit('), 'положение флота сглажено');
  ok(fleets.includes('sp.lift'), 'корабль поднимается над плоскостью и садится');

  // Один цикл на симуляцию и рендер: два независимых rAF давали микро-рывки.
  const main = read('src', 'main.ts');
  // Считаем только вызовы, а не упоминания в комментариях: их ровно два —
  // запуск цикла и его рекурсивный шаг.
  const raf = (main.match(/requestAnimationFrame\(loop\)/g) ?? []).length;
  ok(raf === 2 && !/requestAnimationFrame\((?!loop\))/.test(main),
    `цикл кадра один (вызовов rAF: ${raf})`);
  ok(main.indexOf('clock.frame(dt)') < main.indexOf('scene.render()'),
    'шаг мира считается до кадра, а не после');
  // У часов не должно остаться вызова rAF — упоминание в комментарии не в счёт.
  const clock = read('src', 'game', 'clock.ts');
  ok(!/requestAnimationFrame\(/.test(clock), 'у часов больше нет своего цикла');

  // Меню: оболочка строится один раз, меняется только тело экрана.
  const menu = read('src', 'ui', 'mainMenu.ts');
  const render = menu.slice(menu.indexOf('private render(): void {'),
    menu.indexOf('private rootScreen(): string {'));
  ok(!render.includes('mm-bg'), 'фон не пересоздаётся на каждом переходе');
  ok(render.includes('this.body.innerHTML = body'), 'меняется только тело экрана');
  const css = read('src', 'style.css');
  ok(css.includes('will-change: transform'), 'фоновый слой меню закреплён за GPU');
  ok(css.includes('@keyframes mm-in'), 'у экранов есть плавное появление');
  ok(css.includes('prefers-reduced-motion'), 'анимации уважают системную настройку');
  console.log('плавность: OK');
}

// --- Фокусы: тон описаний -------------------------------------------------------------
{
  const all = Object.values(FOCUS_TREES).flat();
  ok(all.length >= 160, `узлов фокусов на месте (${all.length})`);
  ok(all.every((n) => n.desc.trim().length >= 40), 'у каждого узла содержательное описание');
  ok(all.every((n) => /[.!?»]$/.test(n.desc.trim())), 'описания оканчиваются знаком препинания');
  // Описания уникальны: копипаста между узлами сразу видна.
  const seen = new Set(all.map((n) => n.desc));
  ok(seen.size === all.length, `описания не повторяются (${seen.size} из ${all.length})`);
  console.log('описания фокусов: OK');
}

console.log(`round48: OK (${checks} проверок)`);
