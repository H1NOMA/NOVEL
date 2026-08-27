// Раунд 54: рой начинает с двух секторов, у машин лавовый мир и Малевелон
// Крик, имена миров каноничны, иллюминаты ныряют в Бездну и не теряют
// снабжения, а кометы с карты убраны.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, fleetsOf, planetsOf, spawnFleet } from '../src/game/state';
import { applyCommand } from '../src/net/commands';
import { recomputeSupply } from '../src/game/supply';
import { resolveGround } from '../src/game/combat';
import { advanceDay, moveFleets } from '../src/game/sim';
import { replenishUnits } from '../src/game/troops';
import { warpBlocker, warpFleet, WARP_COST, harvestPoints } from '../src/game/illuminate';
import { declareWar } from '../src/game/relations';
import { QUALITY_PRESETS } from '../src/ui/settings';
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

const FACTIONS4: FactionId[] = ['superEarth', 'automatons', 'illuminate', 'terminids'];

function warGame(seed: number, player: FactionId = 'superEarth'): GameState {
  const s = createGame(seed, player);
  for (const a of FACTIONS4) for (const b of FACTIONS4) if (a !== b) declareWar(s, a, b, 'тест');
  return s;
}

const SEEDS = [42, 1337, 900913, 7, 555, 11, 23, 64];

// --- Рой начинает с двух секторов -------------------------------------------
{
  for (const seed of SEEDS) {
    const s = createGame(seed, 'superEarth');
    const swarm = planetsOf(s, 'terminids');
    const sectors = new Set(swarm.map((p) => p.sector));
    ok(sectors.size >= 2, `сид ${seed}: у роя не меньше двух секторов (${sectors.size})`);
    ok(swarm.length >= 7, `сид ${seed}: улью хватает миров (${swarm.length})`);
    // Второй сектор — рядом, а не на другом краю галактики.
    const hive = swarm.find((p) => p.name === 'Кеплер Прайм') ?? swarm[0]!;
    for (const p of swarm) {
      const d = Math.hypot(p.pos.x - hive.pos.x, p.pos.y - hive.pos.y);
      ok(d < s.galaxy.radiusMax, `сид ${seed}: мир роя ${p.name} не улетел за карту`);
    }
    // Чужие престолы рой не отнимает.
    for (const other of ['automatons', 'illuminate'] as FactionId[]) {
      const seat = planetsOf(s, other).find((p) => p.isCapital);
      ok(!!seat, `сид ${seed}: престол ${other} на месте, рой его не забрал`);
    }
  }
  console.log('два сектора роя: OK');
}

// --- Автоматоны: лава дома и Крик по соседству --------------------------------
{
  for (const seed of SEEDS) {
    const s = createGame(seed, 'superEarth');
    const machines = planetsOf(s, 'automatons');
    const cyberstan = machines.find((p) => p.isCapital);
    ok(!!cyberstan, `сид ${seed}: Киберстан на месте`);
    const home = machines.filter((p) => p.sector === cyberstan!.sector);
    ok(home.some((p) => p.biome === 'magma' && p.minerals >= 2),
      `сид ${seed}: в секторе машин есть лавовый мир с залежами`);

    const creek = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!)
      .find((p) => p.name === 'Малевелон Крик');
    ok(!!creek, `сид ${seed}: Малевелон Крик на карте`);
    ok(creek!.owner === 'automatons', `сид ${seed}: Крик держат машины`);
    ok(creek!.biome === 'jungle', `сид ${seed}: Крик — джунгли`);
    ok(creek!.sector !== cyberstan!.sector, `сид ${seed}: Крик в СОСЕДНЕМ секторе, не в домашнем`);
    ok(!!creek!.scarred, `сид ${seed}: Крик несёт шрамы прошлой мясорубки`);
    // Ровно один Крик на галактику.
    const creeks = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!)
      .filter((p) => p.name === 'Малевелон Крик').length;
    ok(creeks === 1, `сид ${seed}: Крик один (${creeks})`);
  }
  console.log('лава и Малевелон Крик: OK');
}

// --- Названия в духе HD2 ------------------------------------------------------
{
  const names = read('src', 'game', 'names.ts');
  for (const gone of ['Марш', 'Поля', 'Провал', 'Оплот', 'Лощина']) {
    ok(!names.includes(`'${gone}'`), `суффикс «${gone}» убран как чужой вселенной`);
  }
  const s = createGame(42, 'superEarth');
  const all = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!.name);
  ok(new Set(all).size === all.length, 'имена миров не повторяются');
  // Канон реально попадает на карту, а не лежит в файле мёртвым грузом.
  const canonHits = ['Драупнир', 'Эстану', 'Фенрир III', 'Хеллмайр', 'Меридия', 'Кримсика']
    .filter((n) => all.includes(n)).length;
  ok(canonHits >= 3, `настоящие миры HD2 попали на карту (${canonHits} из 6 проверенных)`);
  // Сектора не скатываются в цифровые хвосты.
  const secs = [...s.galaxy.sectors.values()].map((x) => x.name);
  const numbered = secs.filter((n) => /-\d+$/.test(n)).length;
  ok(numbered === 0, `сектора названы словами, а не номерами (с номерами: ${numbered})`);
  console.log('названия по канону: OK');
}

// --- Иллюминаты: снабжение не перерезать --------------------------------------
{
  const s = warGame(801);
  // Строим заведомо отрезанный анклав: далёкий мир Супер-Земли переходит к
  // иллюминатам и оказывается один среди чужих. Опорным компонентом остаётся
  // столица, анклав — в кольце. Топология конкретного сида на это не влияет.
  const seat = planetsOf(s, 'illuminate').find((p) => p.isCapital)!;
  const island = planetsOf(s, 'superEarth')
    .filter((p) => !p.isCapital && p.links.every((l) => s.galaxy.planets.get(l)!.owner !== 'illuminate'))
    .sort((a, b) => Math.hypot(b.pos.x - seat.pos.x, b.pos.y - seat.pos.y)
      - Math.hypot(a.pos.x - seat.pos.x, a.pos.y - seat.pos.y))[0]!;
  island.owner = 'illuminate';
  recomputeSupply(s);
  const left = planetsOf(s, 'illuminate');
  ok(left.length > 0, 'у иллюминатов остались миры');
  ok(left.every((p) => p.supplied), 'ни один мир иллюминатов не потерял снабжения');
  ok(island.cutOff === true, 'отрезанный анклав помечен потерей связи с ядром');
  ok(island.supplied === true, 'и при этом снабжается — Бездну не перерезать');
  ok(seat.cutOff === false, 'столица связь с ядром не теряла');

  // Та же операция над Супер-Землёй снабжение отбирает.
  const s2 = warGame(801);
  const victim = planetsOf(s2, 'superEarth').find((p) => !p.isCapital)!;
  for (const lid of victim.links) {
    const n = s2.galaxy.planets.get(lid)!;
    if (n.owner === 'superEarth') { n.owner = 'automatons'; n.origin = 'automatons'; }
  }
  recomputeSupply(s2);
  ok(!victim.supplied, 'мир Супер-Земли в кольце снабжение теряет');

  // Окружение бьёт по обороне: отрезанный мир падает РАНЬШЕ. Мерим днями до
  // падения — это честнее, чем срез контроля: при достаточном перевесе оба
  // мира в итоге берут, вопрос только в том, сколько они продержались.
  const daysToFall = (cut: boolean): number => {
    const g = warGame(802);
    const p = planetsOf(g, 'illuminate').find((q) => !q.isCapital) ?? planetsOf(g, 'illuminate')[0]!;
    p.garrison = 30;
    p.fortification = 1;
    const f = spawnFleet(g, 'terminids', p.id, { ships: 20, infantry: 120 });
    f.origin = undefined;
    for (let d = 1; d <= 60; d++) {
      // Пересчёт снабжения тут не гоняем: держим подопытное состояние руками.
      p.supplied = true;
      p.cutOff = cut;
      resolveGround(g);
      if (p.owner !== 'illuminate') return d;
    }
    return 999;
  };
  const cutDays = daysToFall(true);
  const linkedDays = daysToFall(false);
  ok(cutDays < linkedDays,
    `отрезанный мир иллюминатов падает раньше (${cutDays} дн против ${linkedDays} дн)`);
  console.log('снабжение иллюминатов: OK');
}

// --- Варп-прыжок --------------------------------------------------------------
{
  const s = warGame(803, 'illuminate');
  const fs = s.factions.illuminate;
  fs.politicalPower = 200;
  const f = fleetsOf(s, 'illuminate')[0]!;
  const far = planetsOf(s, 'superEarth')
    .filter((p) => !p.isCapital && !p.shattered)
    .sort((a, b) => Math.hypot(b.pos.x - f.at.length, 0) - Math.hypot(a.pos.x, 0))[0]!;

  // Право на Бездну — только у иллюминатов.
  ok(warpBlocker(s, 'superEarth', f.id, far.id) !== null, 'Супер-Земля в Бездну не ныряет');
  ok(warpBlocker(s, 'automatons', f.id, far.id) !== null, 'машины в Бездну не ныряют');
  ok(warpBlocker(s, 'illuminate', f.id, far.id) === null, 'иллюминатам прыжок разрешён');

  const from = f.at;
  const powerBefore = fs.politicalPower;
  ok(warpFleet(s, 'illuminate', f.id, far.id), 'прыжок совершён');
  ok(f.at === far.id, 'соединение вышло у цели');
  ok(!f.transit, 'соединение не в пути — оно уже на месте');
  ok(f.at !== from, 'орбита сменилась');
  ok(fs.politicalPower === powerBefore - WARP_COST, `прыжок оплачен (${WARP_COST} ПВ)`);
  ok(f.origin === undefined, 'плацдарма у прыжка нет — атака пойдёт без снабжения');
  ok(!!far.warpBeacon, 'над целью горит маяк вторжения');

  // Без власти прыжка нет.
  fs.politicalPower = WARP_COST - 1;
  const f2 = fleetsOf(s, 'illuminate')[1];
  if (f2) {
    ok(warpBlocker(s, 'illuminate', f2.id, planetsOf(s, 'superEarth')[0]!.id) !== null,
      'без политвласти Бездна не открывается');
  }

  // Приказ ходит через сеть.
  const proto = read('src', 'net', 'protocol.ts');
  const cmds = read('src', 'net', 'commands.ts');
  ok(proto.includes("k: 'warpFleet'"), 'прыжок описан в протоколе');
  ok(cmds.includes("case 'warpFleet'"), 'хост исполняет прыжок');
  ok(/PROTOCOL_VERSION = [5-9]/.test(proto), 'версия протокола поднята');
  const s3 = warGame(804, 'illuminate');
  s3.factions.superEarth.politicalPower = 500;
  const seFleet = fleetsOf(s3, 'superEarth')[0]!;
  ok(!applyCommand(s3, 'superEarth', {
    k: 'warpFleet', fleet: seFleet.id, target: planetsOf(s3, 'terminids')[0]!.id,
  }), 'приказ на прыжок от Супер-Земли отклонён');
  console.log('варп-прыжок: OK');
}

// --- Точка людского ресурса ---------------------------------------------------
{
  const s = warGame(805, 'illuminate');
  s.factions.illuminate.politicalPower = 300;
  const prey = planetsOf(s, 'superEarth').find((p) => !p.isCapital && p.supplied)!;
  prey.garrison = 6;
  const f = fleetsOf(s, 'illuminate')[0]!;
  f.infantry = 200;
  ok(warpFleet(s, 'illuminate', f.id, prey.id), 'прыжок к жертве');
  for (let d = 0; d < 40 && prey.owner !== 'illuminate'; d++) resolveGround(s);
  ok(prey.owner === 'illuminate', 'мир взят после варп-вторжения');
  ok(prey.harvest === true, 'взятый с маяка мир стал точкой людского ресурса');
  ok(!prey.warpBeacon, 'маяк погашен — вторжение состоялось');
  ok(harvestPoints(s).some((p) => p.id === prey.id), 'точка попала в список');

  // Точка реально кормит Безмозглые массы.
  const before = s.factions.illuminate.units.voteless ?? 0;
  s.factions.illuminate.units.voteless = 0;
  replenishUnits(s, 'illuminate');
  const withPoint = s.factions.illuminate.units.voteless ?? 0;
  prey.harvest = undefined;
  s.factions.illuminate.units.voteless = 0;
  replenishUnits(s, 'illuminate');
  const without = s.factions.illuminate.units.voteless ?? 0;
  ok(withPoint > without, `точка ресурса даёт прирост масс (${withPoint.toFixed(2)} против ${without.toFixed(2)})`);
  void before;

  // Отбитый обратно мир перестаёт быть точкой.
  prey.harvest = true;
  prey.garrison = 1;
  const retake = spawnFleet(s, 'superEarth', prey.id, { ships: 30, infantry: 200, transports: 20 });
  retake.origin = undefined;
  for (let d = 0; d < 60 && prey.owner === 'illuminate'; d++) resolveGround(s);
  if (prey.owner !== 'illuminate') {
    ok(!prey.harvest, 'отбитый мир перестал кормить массы');
  }
  console.log('точка людского ресурса: OK');
}

// --- Кометы убраны ------------------------------------------------------------
{
  const starfield = read('src', 'render', 'starfield.ts');
  const scene = read('src', 'render', 'scene.ts');
  ok(!/createComets|CometLayer/.test(starfield), 'кометы вырезаны из фона');
  ok(!/comet/i.test(scene), 'сцена о кометах больше не знает');
  ok(QUALITY_PRESETS.low.nebulae === false && QUALITY_PRESETS.high.nebulae === true,
    'пресет качества переименован в туманности');
  console.log('кометы убраны: OK');
}

// --- Партия не ломается -------------------------------------------------------
{
  const s = warGame(806);
  let warps = 0;
  const seen = new Set<string>();
  for (let d = 0; d < 500; d++) {
    moveFleets(s, 1);
    advanceDay(s);
    for (const id of s.galaxy.order) {
      const p = s.galaxy.planets.get(id)!;
      if (p.warpBeacon && !seen.has(id)) { seen.add(id); warps++; }
      // Мир иллюминатов не может остаться без снабжения ни в один день.
      if (p.owner === 'illuminate') {
        ok(p.supplied, `мир иллюминатов ${p.name} снабжается на день ${s.day}`);
      }
      // Точка ресурса бывает только у иллюминатов.
      if (p.harvest) ok(p.owner === 'illuminate', `точка ресурса под иллюминатами (${p.name})`);
    }
  }
  ok(warps > 0, `ИИ иллюминатов пользуется Бездной (вторжений: ${warps})`);
  console.log(`longrun: OK (день ${s.day}, варп-вторжений ${warps})`);
}

console.log(`round54: OK (${checks} проверок)`);
