// Раунд 51: партия синхронизируется целиком (клиент больше не считает мир
// сам), время у стола общее, у каждой фракции свой позывной, поверхности
// планет перестали быть мыльными, а форма галактики выбирается на старте.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, planetsOf, spawnFleet } from '../src/game/state';
import { applyCommand } from '../src/net/commands';
import { encodeSnapshot, applySnapshot } from '../src/net/snapshot';
import { interpolateFleets, orderFleetTo } from '../src/game/units';
import { advanceDay } from '../src/game/sim';
import { GALAXY_SHAPES, shapeDef } from '../src/game/galaxyShapes';
import { findPath } from '../src/game/galaxy';
import { FACTION_IDS, FACTIONS, WAR_CRY } from '../src/data/factions';
import { QUALITY_PRESETS } from '../src/ui/settings';
import type { FactionId } from '../src/core/types';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}
const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');

// --- Клиент больше не симулирует мир ---------------------------------------------
{
  const clock = read('src', 'game', 'clock.ts');
  ok(clock.includes('setAuthoritative('), 'у часов есть режим «не считать самому»');
  ok(clock.includes('interpolateFleets('), 'клиент только подтягивает корабли между срезами');
  const frame = clock.slice(clock.indexOf('frame(dt'), clock.indexOf('frame(dt') + 900);
  ok(frame.includes('if (!this.authoritative)'), 'ветка клиента отделена до симуляции');
  ok(frame.indexOf('if (!this.authoritative)') < frame.indexOf('advanceDay('),
    'advanceDay на клиенте недостижим');

  const main = read('src', 'main.ts');
  ok(main.includes('opts.client) clock.setAuthoritative(false)'), 'клиент запускается без симуляции');
  ok(main.includes("startGame(state, { client: true })"), 'подключение к партии помечает экран клиентским');

  // Интерполяция двигает ТОЛЬКО долю пути и никогда не доводит её до прибытия.
  const s = createGame(31, 'superEarth');
  const own = planetsOf(s, 'superEarth');
  const f = spawnFleet(s, 'superEarth', own[0]!.id, { ships: 4, infantry: 8 });
  const far = own.find((p) => p.id !== own[0]!.id)!;
  ok(orderFleetTo(s, f, far.id, false), 'приказ на перелёт принят');
  const at0 = f.at;
  const day0 = s.day;
  for (let i = 0; i < 500; i++) interpolateFleets(s, 0.5);
  ok(!!f.transit, 'после интерполяции соединение всё ещё в пути');
  ok(f.at === at0, 'клиент не переставляет соединение на новую орбиту');
  ok(s.day === day0, 'и не двигает день');
  ok((f.transit?.progress ?? 0) <= 0.995 + 1e-9, 'доля пути упирается в потолок');
}

// --- Всё, что делает игрок, проходит через приказы --------------------------------
{
  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes('private act(cmd: Cmd)'), 'у интерфейса одна дверь к состоянию');
  ok(ui.includes('sendCommand(cmd)') && ui.includes('applyCommand(this.state, this.state.player, cmd)'),
    'приказ либо уходит хосту, либо применяется тем же кодом локально');

  // Ни одного прямого мутатора мира в интерфейсе не осталось.
  const forbidden = [
    'orderFleetTo(', 'garrisonReinforce(', 'splitFleet(', 'disbandFleet(', 'mergeFleets(',
    'buildShipyard(', 'cancelQueue(', 'formFleetFromYard(', 'queueShip(', 'takeStoredShips(',
    'buildDepot(', 'buildE711Station(', 'buildSpecialDock(', 'enableE711Mining(', 'fireSuperweapon(',
    'installTermicide(', 'plantGloomSeed(', 'produceDivision(', 'raiseSpire(', 'rebuildSpecial(',
    'buyBonus(', 'buyTruce(', 'cedePlanet(', 'declareWar(', 'makePeace(', 'selectFocus(',
    'runRecon(', 'runSabotage(', 'runUprising(', 'buildShield(', 'buildStation(',
    'cycleCommander(', 'resolveChoice(', 'attackPlans.push',
  ];
  for (const bad of forbidden) {
    ok(!ui.includes(bad), `интерфейс не вызывает ${bad} напрямую`);
  }

  // Каждый вид приказа из протокола реально исполняется.
  const proto = read('src', 'net', 'protocol.ts');
  const cmds = read('src', 'net', 'commands.ts');
  const kinds = [...proto.matchAll(/\{ k: '([a-zA-Z0-9]+)'/g)].map((m) => m[1]!);
  // Служебные сообщения канала — не приказы игрока и в applyCommand не идут.
  const cmdKinds = kinds.filter((k) => !['hello', 'welcome', 'lobby', 'claim', 'start',
    'snapshot', 'cmd', 'nak', 'resync', 'bye', 'ping', 'pong'].includes(k));
  ok(cmdKinds.length >= 35, `приказов в протоколе много (${cmdKinds.length})`);
  for (const k of cmdKinds) {
    ok(cmds.includes(`case '${k}'`), `хост умеет исполнять приказ ${k}`);
  }
  ok(/PROTOCOL_VERSION = [3-9]/.test(proto), 'версия протокола поднята — состав приказов изменился');
}

// --- Приказы работают от лица любой фракции ---------------------------------------
{
  const s = createGame(77, 'superEarth');
  s.humans = ['superEarth', 'illuminate'];
  const ill = planetsOf(s, 'illuminate')[0]!;
  s.factions.illuminate.production = 999;

  // Клиент-иллюминат строит у себя — и это применяется, хотя экран хоста за СЗ.
  ok(applyCommand(s, 'illuminate', { k: 'buildDepot', planet: ill.id }), 'клиент строит на своём мире');
  // Стройка занимает дни (раунд 53): приказ ставит площадку, а не готовый объект.
  ok(ill.build?.id === 'depot', 'на мире клиента заложена стройка');
  // И не может строить на чужом.
  const se = planetsOf(s, 'superEarth')[0]!;
  ok(!applyCommand(s, 'illuminate', { k: 'buildDepot', planet: se.id }), 'на чужом мире строить нельзя');

  // Развилка события — личная: чужую не закрыть.
  s.pendingChoices = { superEarth: 'ev_x' };
  ok(!applyCommand(s, 'illuminate', { k: 'resolveChoice', event: 'ev_x', choice: 0 }),
    'чужую развилку решать нельзя');

  // Планы атак принадлежат фракции.
  const target = s.galaxy.planets.get(ill.links[0]!)!;
  const before = target.owner;
  target.owner = 'superEarth';
  ok(applyCommand(s, 'illuminate', { k: 'planAttack', from: ill.id, to: target.id }), 'план атаки заготовлен');
  ok(s.attackPlans.some((p) => p.faction === 'illuminate'), 'план подписан фракцией');
  ok(!applyCommand(s, 'superEarth', { k: 'unplanAttack', from: ill.id, to: target.id }),
    'чужой план отменить нельзя');
  ok(applyCommand(s, 'illuminate', { k: 'unplanAttack', from: ill.id, to: target.id }), 'свой — можно');
  target.owner = before;
}

// --- Время партии общее -------------------------------------------------------------
{
  const s = createGame(5, 'superEarth');
  s.humans = ['superEarth', 'terminids'];
  s.speed = 1;
  // Паузу ставит ЛЮБОЙ участник, не только хост.
  ok(applyCommand(s, 'terminids', { k: 'setSpeed', speed: 0 }), 'клиент ставит паузу');
  ok(s.speed === 0, 'мир встал у всех');
  ok(applyCommand(s, 'superEarth', { k: 'setSpeed', speed: 3 }), 'хост разгоняет время');
  ok(s.speed === 3, 'скорость общая');
  ok(!applyCommand(s, 'terminids', { k: 'setSpeed', speed: 3 }), 'повтор той же скорости не считается изменением');

  // Скорость приезжает к клиенту снапшотом.
  const client = createGame(5, 'terminids');
  applySnapshot(client, encodeSnapshot(s));
  ok(client.speed === 3, 'клиент получает скорость со срезом');

  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes("this.act({ k: 'setSpeed'"), 'кнопки скорости шлют приказ');
  const speed = ui.slice(ui.indexOf('private applySpeed('), ui.indexOf('private applySpeed(') + 600);
  ok(speed.includes('this.act('), 'пауза тоже уходит приказом');
}

// --- ИИ не распоряжается человеческими фракциями -------------------------------------
{
  const dec = read('src', 'game', 'decisions.ts');
  ok(dec.includes('const ai = (f: FactionId)') && dec.includes('!isHuman(state, f)'),
    'решения ИИ проверяют, не человек ли за фракцией');
  ok(dec.includes("!isHuman(state, 'terminids')"), 'Мрак сам собой у игрока-роя не зарождается');
  ok(dec.includes("!isHuman(state, 'illuminate')"), 'и шпили у игрока-иллюмината тоже');

  // Прогон: производство человеческой фракции ИИ не тратит.
  const s = createGame(19, 'superEarth');
  s.humans = ['superEarth', 'automatons'];
  s.factions.automatons.production = 500;
  s.factions.automatons.politicalPower = 500;
  const prod = s.factions.automatons.production;
  const pp = s.factions.automatons.politicalPower;
  advanceDay(s);
  ok(s.factions.automatons.production >= prod * 0.9,
    `производство игрока-машины не разошлось (${prod} → ${s.factions.automatons.production.toFixed(0)})`);
  ok(s.factions.automatons.politicalPower >= pp, 'и политвласть его тоже цела');
}

// --- Позывные фракций ----------------------------------------------------------------
{
  const snd = read('src', 'ui', 'sound.ts');
  ok(snd.includes('fanfare(faction: FactionId)'), 'позывной выбирается по фракции');
  for (const f of ['SuperEarth', 'Automatons', 'Illuminate', 'Terminids', 'Federation']) {
    ok(snd.includes(`private fanfare${f}(`), `у фракции свой мотив: ${f}`);
  }
  ok(snd.includes('private glide(') && snd.includes('private noise('),
    'для мотивов добавлены скольжение высоты и шум');
  const main = read('src', 'main.ts');
  ok(main.includes('ui.startFanfare()'), 'позывной играет при входе в галактику');

  // Клич у каждой стороны свой.
  const cries = FACTION_IDS.map((f) => WAR_CRY[f]);
  ok(cries.every(Boolean), 'клич есть у каждой фракции');
  ok(new Set(cries).size === cries.length, 'и он у всех разный');
  ok(WAR_CRY.terminids !== WAR_CRY.superEarth, 'рою не предлагают нести демократию');
  ok(main.includes('WAR_CRY[state.player]'), 'на старте показывается свой клич');
}

// --- Поверхности планет: детали вместо мыла -------------------------------------------
{
  const mesh = read('src', 'render', 'planetShaders.ts');
  // Октав стало больше — именно их нехватка и читалась как размытие.
  const loop = /for\(int i=0;i<(\d+);i\+\+\)\{\s*if \(float\(i\) >= gOct\)/.exec(mesh);
  ok(!!loop && Number(loop[1]) >= 7, `у шума не меньше семи октав (${loop?.[1]})`);
  ok(mesh.includes('float ridged('), 'есть складчатый шум с острым гребнем');
  ok(mesh.includes('float grit('), 'есть высокочастотное зерно поверхности');
  // …но без муара: мелкое гасится по размеру пикселя.
  ok(mesh.includes('float band(float freq, float fw)'), 'детали ограничены пределом различимости');
  ok(mesh.includes('fwidth('), 'предел считается по производной экранных координат');
  ok(mesh.includes('gOct = clamp(log2('), 'число октав тоже режется по размеру пикселя');
  // Производные (fwidth) — ядро языка на WebGL2, а движок поднимается именно
  // на нём: отдельный флаг расширения больше не нужен.
  ok(read('src', 'render', 'engine.ts').includes('new Engine(canvas, true,'),
    'движок поднимается с WebGL2 — производные там в ядре языка');
  ok(mesh.includes('float mountains = ridged(') && mesh.includes('float valleys ='),
    'на суше есть и хребты, и эрозионные долины');
  ok(mesh.includes('uIce > 0.5') && mesh.includes('float plate ='), 'у ледяных миров поля плит');

  const scene = read('src', 'render', 'scene.ts');
  const lod = /const wantOct = Math\.min\(cap, this\.distance > (\d+)/.exec(scene);
  ok(!!lod && Number(lod[1]) >= 30, `порог упрощения отодвинут (${lod?.[1]})`);
  ok(scene.includes('QUALITY_PRESETS[this.quality].planetOct'), 'потолок детализации зависит от качества');
  ok(QUALITY_PRESETS.low.planetOct < QUALITY_PRESETS.high.planetOct,
    'на низком качестве деталей меньше');

  // Разброс масштаба поверхности — иначе миры одного биома выглядят копиями.
  const freq = /const freq = ([\d.]+) \+ rand\(\) \* ([\d.]+);/.exec(read('src', 'render', 'planetMesh.ts'));
  ok(!!freq && Number(freq[2]) >= 3, `разброс частоты рельефа широкий (±${freq?.[2]})`);
}

// --- Формы галактики -------------------------------------------------------------------
{
  ok(GALAXY_SHAPES.length >= 5, `форм галактики несколько (${GALAXY_SHAPES.length})`);
  const ids = GALAXY_SHAPES.map((g) => g.id);
  ok(new Set(ids).size === ids.length, 'идентификаторы форм уникальны');
  for (const g of GALAXY_SHAPES) {
    ok(!!g.label && !!g.blurb, `${g.id}: есть название и описание`);
    // Превью — настоящий снимок, а не заглушка: файл увесистый.
    const art = join(process.cwd(), 'src', 'assets', 'galaxy', `${g.id}.webp`);
    ok(existsSync(art), `${g.id}: превью на месте`);
    ok(statSync(art).size > 8000, `${g.id}: превью — настоящий кадр (${statSync(art).size} байт)`);
  }

  // Каждая форма даёт играбельную галактику: связную, со столицами и живыми врагами.
  for (const g of GALAXY_SHAPES) {
    for (const seed of [3, 991, 40404]) {
      const s = createGame(seed, 'superEarth', g.id);
      const counts = FACTION_IDS.map((f) => planetsOf(s, f).length);
      ok(counts.every((c) => c > 0), `${g.id}/${seed}: ни одна фракция не исчезла`);
      ok(Math.min(...counts.slice(1)) >= 3, `${g.id}/${seed}: у врагов есть плацдарм`);
      for (const nm of ['Киберстан', "Святилище Скв'бай", 'Кеплер Прайм']) {
        ok([...s.galaxy.planets.values()].some((p) => p.name === nm), `${g.id}/${seed}: ${nm} на месте`);
      }
      const far = [...s.galaxy.planets.values()].reduce((a, b) => (b.radius > a.radius ? b : a));
      ok(!!findPath(s.galaxy, 'p_super_earth', far.id), `${g.id}/${seed}: карта связная`);
      // Полосы колец не наезжают друг на друга ни при каком профиле радиусов.
      const rings = new Map<number, { r0: number; r1: number }[]>();
      for (const sec of s.galaxy.sectors.values()) {
        if (!sec.ring) continue;
        const list = rings.get(sec.ring) ?? [];
        list.push(sec);
        rings.set(sec.ring, list);
      }
      const ringIds = [...rings.keys()].sort((a, b) => a - b);
      for (let i = 1; i < ringIds.length; i++) {
        const prevMax = Math.max(...rings.get(ringIds[i - 1]!)!.map((x) => x.r1));
        const curMin = Math.min(...rings.get(ringIds[i]!)!.map((x) => x.r0));
        ok(curMin > prevMax, `${g.id}/${seed}: кольца ${ringIds[i - 1]}→${ringIds[i]} не пересекаются`);
      }
    }
  }

  // Формы действительно разные: у кольца ядро пустое, у спирали плотность гуляет по углу.
  const ring = createGame(3, 'superEarth', 'ring');
  const disc = createGame(3, 'superEarth', 'disc');
  const nearCore = (st: ReturnType<typeof createGame>): number =>
    [...st.galaxy.planets.values()].filter((p) => p.radius > 0 && p.radius < 160).length;
  ok(nearCore(ring) < nearCore(disc), `у кольца ядро пустее (${nearCore(ring)} против ${nearCore(disc)})`);

  const angularSpread = (id: Parameters<typeof shapeDef>[0]): number => {
    const st = createGame(3, 'superEarth', id);
    const bins = new Array(16).fill(0);
    for (const p of st.galaxy.planets.values()) {
      if (p.radius <= 0) continue;
      const a = (Math.atan2(p.pos.y, p.pos.x) + Math.PI * 2) % (Math.PI * 2);
      bins[Math.floor((a / (Math.PI * 2)) * 16) % 16]++;
    }
    return Math.max(...bins) / Math.max(1, Math.min(...bins));
  };
  ok(angularSpread('bar') > angularSpread('disc'),
    `у перемычки плотность по углу неровнее (${angularSpread('bar').toFixed(2)} против ${angularSpread('disc').toFixed(2)})`);
  ok(angularSpread('clusters') > angularSpread('disc'), 'у скоплений тоже');

  // Форма доходит от меню до генератора.
  const menu = read('src', 'ui', 'mainMenu.ts');
  ok(menu.includes("this.screen === 'shape' ? this.shapeScreen()"), 'экран выбора формы есть');
  ok(menu.includes('data-shape='), 'карточки формы кликабельны');
  ok(menu.includes('SHAPE_ART['), 'на карточке — снимок галактики');
  ok(menu.includes('this.actions.newGame(faction, shape)'), 'форма уходит в новую партию');
  ok(menu.includes('this.actions.hostGame(this.hostFaction, this.hostShape)'), 'и в сетевую тоже');
  const main = read('src', 'main.ts');
  ok(main.includes('createGame(Math.floor(Math.random() * 1e9), faction, shape)'),
    'генератор получает выбранную форму');
  const tool = read('tools', 'shapeshots.mjs');
  ok(tool.includes("getElementById('ui')?.setAttribute('style', 'display:none')"),
    'снимки делаются с погашенным интерфейсом');
}

console.log(`round51: OK (${checks} проверок)`);
