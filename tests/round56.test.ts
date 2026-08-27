// Раунд 56: утечка элиты закрыта, миры в Бездне снова полезны хозяевам,
// у врагов богаче старт, соединения пополняются из резерва, верфь можно
// приписать к соединению, выбывший игрок берёт другую сторону, у каждой
// фракции свои названия классов кораблей.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  availableSides, createGame, fleetsOf, planetsOf, spawnFleet, takeOverFaction,
} from '../src/game/state';
import { applyCommand } from '../src/net/commands';
import { advanceDay, moveFleets } from '../src/game/sim';
import { drawUnits } from '../src/game/troops';
import {
  assignYard, noteEstablishment, reinforceFleets, stepShipyards, yardsOf,
} from '../src/game/shipyards';
import { buildShield, buildStation } from '../src/game/defense';
import { buildShipyard } from '../src/game/shipyards';
import { serializeState, deserializeState } from '../src/game/persist';
import { SHIP_CLASS_NAMES, SHIP_CLASS_TAG, shipClassName } from '../src/data/troops';
import { FACTION_IDS } from '../src/data/factions';
import { declareWar } from '../src/game/relations';
import type { FactionId } from '../src/core/types';
import type { GameState } from '../src/game/state';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}
const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');
const FOUR: FactionId[] = ['superEarth', 'automatons', 'illuminate', 'terminids'];

function warGame(seed: number, player: FactionId = 'superEarth'): GameState {
  const s = createGame(seed, player);
  for (const a of FOUR) for (const b of FOUR) if (a !== b) declareWar(s, a, b, 'тест');
  return s;
}

// --- Элита больше не утекает на рутину ----------------------------------------
{
  const s = createGame(42, 'superEarth');
  const fs = s.factions.superEarth;

  // Прямая проверка правила: пока есть масса, элиту не трогают; когда массы
  // нет — рутинный запрос просто недобирает, а не лезет в элиту.
  fs.units.seaf = 10;
  fs.units.helldivers = 50;
  const got = drawUnits(fs, 40);
  ok(got === 10, `рутина взяла только массу (${got} из 40)`);
  ok(fs.units.helldivers === 50, 'элита не тронута');
  ok(fs.units.seaf === 0, 'масса израсходована до нуля');

  // Явный запрос с элитой всё ещё возможен — но его никто не делает случайно.
  const forced = drawUnits(fs, 20, false);
  ok(forced === 20 && fs.units.helldivers === 30, 'с sparElite=false элита доступна');

  // И то же на дистанции: мирная партия, двести дней, никаких боёв.
  const g = createGame(42, 'superEarth');
  const before = {
    hell: g.factions.superEarth.units.helldivers ?? 0,
    legion: g.factions.automatons.units.cyborgLegion ?? 0,
    great: g.factions.illuminate.units.greatFleet ?? 0,
  };
  for (let d = 0; d < 200; d++) { moveFleets(g, 1); advanceDay(g); }
  const after = {
    hell: g.factions.superEarth.units.helldivers ?? 0,
    legion: g.factions.automatons.units.cyborgLegion ?? 0,
    great: g.factions.illuminate.units.greatFleet ?? 0,
  };
  ok(after.hell >= before.hell,
    `Хеллдайверы не тают сами по себе (${before.hell} → ${after.hell.toFixed(0)})`);
  ok(after.legion >= before.legion,
    `Легионы киборгов не тают (${before.legion} → ${after.legion.toFixed(0)})`);
  ok(after.great >= before.great,
    `Великий флот невосполним и потому неприкосновенен (${before.great} → ${after.great.toFixed(0)})`);
  console.log('утечка элиты закрыта: OK');
}

// --- Свои миры в Бездне снова полезны -----------------------------------------
{
  const s = warGame(901, 'illuminate');
  const fs = s.factions.illuminate;
  fs.production = 2000;
  const mine = planetsOf(s, 'illuminate').filter((p) => p.supplied);
  const a = mine[0]!;
  const b = mine[1] ?? a;
  a.abyss = true;
  b.abyss = true;

  ok(buildShipyard(s, 'illuminate', a.id), 'верфь на погруженном мире строится');
  a.build = undefined;
  a.shipyard = { queue: null, stored: { ships: 0, dreadnoughts: 0, battleships: 0, transports: 0 } };
  ok(yardsOf(s, 'illuminate').some((p) => p.id === a.id), 'верфь в Бездне видна в списке');
  ok(buildShield(s, 'illuminate', b.id), 'щит на погруженном мире строится');
  b.build = undefined;
  ok(buildStation(s, 'illuminate', b.id), 'станция тоже');

  // Чужим Бездна по-прежнему закрыта — это её единственный смысл.
  const supply = read('src', 'game', 'supply.ts');
  ok(/if \(planet\.abyss\) return faction === 'illuminate';/.test(supply),
    'войти в Бездну может только тот, кто её открыл');
  for (const file of ['shipyards.ts', 'defense.ts', 'politics.ts']) {
    ok(!read('src', 'game', file).includes('p.abyss'),
      `запрет на свои миры в Бездне убран из ${file}`);
  }

  // Погруженные миры считаются территорией: фракция с ними не «выбыла».
  const g = warGame(902, 'superEarth');
  for (const p of planetsOf(g, 'illuminate')) p.abyss = true;
  advanceDay(g);
  ok(g.factions.illuminate.alive, 'фракция с мирами в Бездне жива');
  ok(g.winner !== 'superEarth', 'и победа никому не присуждается');
  console.log('миры в Бездне: OK');
}

// --- Богаче старт у врагов ----------------------------------------------------
{
  for (const seed of [42, 1337, 7, 555]) {
    const s = createGame(seed, 'superEarth');
    for (const f of ['automatons', 'illuminate', 'terminids'] as FactionId[]) {
      const fs = s.factions[f];
      ok(fs.production > 0, `${f}: стартовая казна не пуста (${fs.production})`);
      ok(fs.resources.minerals > 0, `${f}: стартовая руда есть (${fs.resources.minerals})`);
      ok(fs.industry > s.factions.superEarth.industry, `${f}: промбаза выше, чем у СЗ`);
      const worlds = planetsOf(s, f);
      ok(worlds.every((p) => p.minerals >= 1), `${f}: на каждом домашнем мире есть залежи`);
      const avg = worlds.reduce((a, p) => a + p.value, 0) / worlds.length;
      ok(avg >= 8, `${f}: домашние миры ценнее рядовых (средняя ${avg.toFixed(1)})`);
    }
    // Супер-Земля живёт со своих двух сотен планет и стартовой подачки не имеет.
    ok(s.factions.superEarth.production === 0, 'у Супер-Земли стартовой казны нет');
  }
  console.log('стартовые ресурсы врагов: OK');
}

// --- Пополнение из резерва ----------------------------------------------------
{
  const s = warGame(903);
  const world = planetsOf(s, 'superEarth').find((p) => p.shipyard && p.supplied)!;
  const f = spawnFleet(s, 'superEarth', world.id, {
    ships: 10, dreadnoughts: 2, battleships: 1, transports: 4, infantry: 20,
  });
  noteEstablishment(f);
  ok(f.establishment?.ships === 10, 'штат записан по составу');

  // Соединение потрёпано, на складе есть замена.
  f.ships = 4;
  f.dreadnoughts = 0;
  f.transports = 1;
  world.shipyard!.stored = { ships: 20, dreadnoughts: 5, battleships: 3, transports: 9 };
  reinforceFleets(s);
  ok(f.ships === 10, `эсминцы добраны до штата (${f.ships})`);
  ok(f.dreadnoughts === 2, `тяжёлые добраны до штата (${f.dreadnoughts})`);
  ok(f.transports === 4, `транспорты добраны до штата (${f.transports})`);
  ok(f.battleships === 1, 'флагман и так был по штату');
  // Сверх штата не берут: остальное остаётся резервом.
  ok(world.shipyard!.stored.ships === 14, `излишек остался на складе (${world.shipyard!.stored.ships})`);
  reinforceFleets(s);
  ok(f.ships === 10, 'повторный шаг ничего не добавляет — штат закрыт');

  // Без верфи и без снабжения пополнения нет.
  const bare = planetsOf(s, 'superEarth').find((p) => !p.shipyard && p.supplied)!;
  const f2 = spawnFleet(s, 'superEarth', bare.id, { ships: 8, infantry: 5 });
  noteEstablishment(f2);
  f2.ships = 2;
  reinforceFleets(s);
  ok(f2.ships === 2, 'на мире без верфи пополнения нет');
  world.supplied = false;
  f.ships = 3;
  reinforceFleets(s);
  ok(f.ships === 3, 'отрезанная верфь не пополняет');
  console.log('пополнение из резерва: OK');
}

// --- Приписка верфи -----------------------------------------------------------
{
  const s = warGame(904);
  const world = planetsOf(s, 'superEarth').find((p) => p.shipyard && p.supplied)!;
  const far = planetsOf(s, 'superEarth').find((p) => p.id !== world.id)!;
  const f = spawnFleet(s, 'superEarth', far.id, { ships: 2, infantry: 5 });

  ok(assignYard(s, 'superEarth', world.id, f.id), 'верфь приписана');
  ok(world.shipyard!.assigned === f.id, 'приписка записана');
  ok(assignYard(s, 'superEarth', world.id, f.id), 'повторный вызов принят');
  ok(!world.shipyard!.assigned, 'и снимает приписку');
  assignYard(s, 'superEarth', world.id, f.id);

  // Готовый корпус идёт В СОЕДИНЕНИЕ, а не на склад — даже если оно далеко.
  world.shipyard!.queue = { cls: 'destroyer', daysLeft: 1 };
  const before = f.ships;
  stepShipyards(s);
  ok(f.ships > before, `корпуса ушли в приписанное соединение (${before} → ${f.ships})`);
  ok(world.shipyard!.stored.ships === 0, 'на склад ничего не легло');
  ok(f.establishment!.ships === f.ships, 'штат подрос вместе с составом');

  // Приписка к чужому соединению невозможна.
  const alien = fleetsOf(s, 'automatons')[0]!;
  ok(!assignYard(s, 'superEarth', world.id, alien.id), 'чужое соединение не приписать');
  // Исчезнувшее соединение гасит приписку само.
  world.shipyard!.assigned = 'f_нет_такого';
  world.shipyard!.queue = { cls: 'destroyer', daysLeft: 1 };
  stepShipyards(s);
  ok(!world.shipyard!.assigned, 'приписка к исчезнувшему соединению снята');
  ok(world.shipyard!.stored.ships > 0, 'корпуса ушли на склад');

  const proto = read('src', 'net', 'protocol.ts');
  ok(proto.includes("k: 'assignYard'"), 'приписка ходит через протокол');
  ok(read('src', 'net', 'commands.ts').includes("case 'assignYard'"), 'хост её исполняет');
  ok(/PROTOCOL_VERSION = [6-9]/.test(proto), 'версия протокола поднята');
  console.log('приписка верфи: OK');
}

// --- Смена стороны выбывшим игроком -------------------------------------------
{
  const s = warGame(905, 'automatons');
  // Машины разгромлены.
  for (const p of planetsOf(s, 'automatons')) { p.owner = 'superEarth'; p.origin = 'superEarth'; }
  s.factions.automatons.alive = false;
  s.playerDefeated = true;

  const sides = availableSides(s, 'automatons');
  ok(sides.length > 0, `есть куда перейти (${sides.join(', ')})`);
  ok(!sides.includes('automatons'), 'своя павшая сторона в списке не значится');
  ok(!sides.includes('superFederation'), 'непроявившаяся Федерация недоступна');

  const to = sides[0]!;
  ok(takeOverFaction(s, 'automatons', to), 'переход состоялся');
  ok(s.player === to, 'экран смотрит новой стороной');
  ok(s.humans.includes(to) && !s.humans.includes('automatons'), 'место в списке людей переехало');
  ok(!s.playerDefeated, 'игрок больше не выбывший');

  // Из живой фракции уходить нельзя, и чужое место не занять.
  const g = warGame(906, 'superEarth');
  ok(!takeOverFaction(g, 'superEarth', 'illuminate'), 'из живой фракции не уйти');
  g.humans = ['superEarth', 'illuminate'];
  for (const p of planetsOf(g, 'superEarth')) { p.owner = 'terminids'; p.origin = 'terminids'; }
  g.factions.superEarth.alive = false;
  ok(!takeOverFaction(g, 'superEarth', 'illuminate'), 'занятую человеком сторону не отнять');
  ok(takeOverFaction(g, 'superEarth', 'automatons'), 'а свободную — можно');

  ok(read('src', 'net', 'protocol.ts').includes("k: 'takeOverFaction'"), 'переход ходит через протокол');
  const dead = warGame(907, 'automatons');
  for (const p of planetsOf(dead, 'automatons')) { p.owner = 'superEarth'; p.origin = 'superEarth'; }
  dead.factions.automatons.alive = false;
  ok(applyCommand(dead, 'automatons', { k: 'takeOverFaction', faction: 'terminids' }),
    'приказ на переход исполняется');
  console.log('смена стороны: OK');
}

// --- Выход в меню -------------------------------------------------------------
{
  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes('menu-tomenu'), 'в меню ESC есть кнопка выхода в главное меню');
  ok(ui.includes('Выйти в главное меню'), 'подпись на месте');
  ok(ui.includes('menu-quit'), 'выход из игры никуда не делся — это разные вещи');
  const wire = ui.slice(ui.indexOf("#menu-tomenu"), ui.indexOf("#menu-quit')!.addEventListener"));
  ok(wire.includes('leaveNet()'), 'перед возвратом в меню сетевая сессия закрывается');
  ok(wire.includes('location.reload()'), 'и игра возвращается к главному меню');
  console.log('выход в меню: OK');
}

// --- Свои названия классов у каждой фракции ------------------------------------
{
  const seen = new Map<string, string>();
  for (const f of FACTION_IDS) {
    for (const cls of ['destroyer', 'dreadnought', 'battleship'] as const) {
      const name = shipClassName(f, cls);
      ok(!!name && name.length > 2, `${f}/${cls}: название есть`);
      const key = `${cls}:${name}`;
      ok(!seen.has(key) || seen.get(key) === f,
        `${name} — только у одной фракции (${seen.get(key)} и ${f})`);
      seen.set(key, f);
    }
  }
  // Флотский словарь Супер-Земли остался только у неё.
  for (const f of FACTION_IDS) {
    if (f === 'superEarth') continue;
    ok(!/эсминц/i.test(shipClassName(f, 'destroyer')), `${f} не зовёт корпуса эсминцами`);
    ok(!/дредноут/i.test(shipClassName(f, 'dreadnought')), `${f} не зовёт тяжёлый дредноутом`);
    ok(!/линкор/i.test(shipClassName(f, 'battleship')), `${f} не зовёт флагман линкором`);
  }
  ok(shipClassName('superEarth', 'destroyer') === 'Супер-эсминцы', 'у СЗ словарь прежний');
  ok(shipClassName('terminids', 'dreadnought') === 'Матка-носитель', 'у роя — матка, а не дредноут');
  // FACTION_IDS не включает скрытую Супер-Федерацию — проверяем покрытие,
  // а не совпадение длин.
  for (const f of FACTION_IDS) {
    ok(!!SHIP_CLASS_NAMES[f], `названия классов заданы фракции ${f}`);
  }
  ok(!!SHIP_CLASS_NAMES.superFederation, 'и Супер-Федерации тоже');
  ok(SHIP_CLASS_TAG.destroyer.length <= 3, 'короткая метка класса действительно короткая');

  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes('shipClassName('), 'интерфейс берёт названия по фракции');
  ok(!ui.includes("'Супер-эсминцы'"), 'жёстко вшитых названий в интерфейсе не осталось');
  ok(!/ЭСМ \$\{/.test(ui), 'старые метки склада заменены общими');
  console.log('названия классов: OK');
}

// --- Сохранения и долгая партия -----------------------------------------------
{
  const s = warGame(908);
  const world = planetsOf(s, 'superEarth').find((p) => p.shipyard)!;
  const f = spawnFleet(s, 'superEarth', world.id, { ships: 6, infantry: 10, transports: 2 });
  noteEstablishment(f);
  assignYard(s, 'superEarth', world.id, f.id);
  const back = deserializeState(serializeState(s, 'slot1', 'тест'));
  const f2 = back.fleets.get(f.id)!;
  ok(f2.establishment?.ships === 6, 'штат переживает сохранение');
  ok(back.galaxy.planets.get(world.id)!.shipyard!.assigned === f.id, 'приписка переживает сохранение');

  // Старый сейв без штата: он заводится по нынешнему составу.
  const blob = JSON.parse(serializeState(s, 'slot1', 'тест')) as { fleets: Record<string, unknown>[] };
  for (const raw of blob.fleets) delete raw.establishment;
  const legacy = deserializeState(JSON.stringify(blob));
  for (const lf of legacy.fleets.values()) {
    ok(!!lf.establishment, `у соединения ${lf.id} появился штат`);
    ok(lf.establishment!.ships === Math.round(lf.ships), 'штат равен нынешнему составу');
  }

  const g = warGame(909);
  for (let d = 0; d < 400; d++) {
    moveFleets(g, 1);
    advanceDay(g);
    for (const fl of g.fleets.values()) {
      ok(fl.ships >= 0 && (fl.transports ?? 0) >= 0, `состав ${fl.id} не ушёл в минус`);
      if (fl.establishment) {
        ok(fl.establishment.ships >= 0, `штат ${fl.id} неотрицателен`);
      }
    }
  }
  console.log(`longrun: OK (день ${g.day})`);
}

console.log(`round56: OK (${checks} проверок)`);
