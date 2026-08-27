// Раунд 53: доктрина Супер-Земли (концентрация против рассредоточенности),
// транспорты ВССЗ как условие высадки, редактор соединений, стройка во
// времени и снос всего построенного при захвате, ИИ с несколькими осями.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, planetsOf, spawnFleet, fleetsOf } from '../src/game/state';
import { applyCommand } from '../src/net/commands';
import {
  hullCount, hullPower, orbitCovered, orbitPower, resolveBombardment, resolveGround,
  seMassedAttack, SE_MASS_HULLS, SE_MASS_TROOPS,
} from '../src/game/combat';
import { composeFleet, landableInfantry, liftCapacity, queueShip, stepShipyards, storedHulls } from '../src/game/shipyards';
import { beginBuild, buildDef, cancelBuild, razeBuildings, stepConstruction } from '../src/game/construction';
import { buildShield } from '../src/game/defense';
import { buildDepot } from '../src/game/supply';
import { aiBuild, runAI } from '../src/game/ai';
import { advanceDay } from '../src/game/sim';
import { serializeState, deserializeState } from '../src/game/persist';
import { SHIP_CLASSES, shipClassesFor, TRANSPORT_LIFT } from '../src/data/troops';
import { declareWar } from '../src/game/relations';
import type { FactionId, GameState } from '../src/core/types';
import type { GameState as GS } from '../src/game/state';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}
const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');
void (null as unknown as GameState);

/** Партия, где все воюют со всеми: доктрины проверяются в бою, а не в мире. */
function warGame(seed: number, player: FactionId = 'superEarth'): GS {
  const s = createGame(seed, player);
  for (const a of ['superEarth', 'automatons', 'illuminate', 'terminids'] as FactionId[]) {
    for (const b of ['superEarth', 'automatons', 'illuminate', 'terminids'] as FactionId[]) {
      if (a !== b) declareWar(s, a, b, 'тест');
    }
  }
  return s;
}

// --- Транспорты ВССЗ ---------------------------------------------------------
{
  const s = warGame(701);

  const def = SHIP_CLASSES.find((c) => c.id === 'transport');
  ok(!!def, 'в производстве есть класс транспортов');
  ok(def!.power === 0, 'транспорт не несёт орудий');
  ok(shipClassesFor('superEarth').some((c) => c.id === 'transport'), 'транспорты доступны Супер-Земле');
  ok(!shipClassesFor('automatons').some((c) => c.id === 'transport'), 'другим фракциям транспорты не строятся');

  // Подъёмная сила: только у Супер-Земли она конечна.
  const seFleet = spawnFleet(s, 'superEarth', 'p_super_earth', { ships: 4, infantry: 40, transports: 2 });
  ok(liftCapacity(seFleet) === 2 * TRANSPORT_LIFT, `подъём считается по транспортам (${liftCapacity(seFleet)})`);
  ok(landableInfantry(seFleet) === 2 * TRANSPORT_LIFT, 'ссаживается только то, что подняли');
  const bugs = spawnFleet(s, 'terminids', planetsOf(s, 'terminids')[0]!.id, { ships: 4, infantry: 40 });
  ok(liftCapacity(bugs) === Infinity, 'рою транспорты не нужны');
  ok(landableInfantry(bugs) === 40, 'рой ссаживает всё, что есть');

  ok(hullCount(seFleet) === 6, `транспорты считаются корпусами на карте (${hullCount(seFleet)})`);
  ok(hullPower(seFleet) === 4, `но не добавляют огневой мощи (${hullPower(seFleet)})`);

  // Без транспортов штурм Супер-Земли не идёт вовсе.
  const target = planetsOf(s, 'automatons').find((p) => p.supplied)!;
  target.garrison = 20;
  const empty = spawnFleet(s, 'superEarth', target.id, { ships: 20, infantry: 200, transports: 0 });
  empty.origin = undefined;
  resolveGround(s);
  ok((target.battle?.liberation ?? 0) <= 0, 'ВССЗ без транспортов не берут планету');
  empty.transports = 20;
  for (let i = 0; i < 5; i++) resolveGround(s);
  ok((target.battle?.liberation ?? 0) > 0 || target.owner === 'superEarth',
    'с транспортами высадка пошла');
  console.log('транспорты ВССЗ: OK');
}

// --- Доктрина Супер-Земли: концентрация -------------------------------------
{
  ok(SE_MASS_HULLS > 0 && SE_MASS_TROOPS > 0, 'пороги массированного удара заданы');
  ok(!seMassedAttack('automatons', 999, 999), 'доктрина только у Супер-Земли');
  ok(!seMassedAttack('superEarth', SE_MASS_HULLS - 1, SE_MASS_TROOPS), 'мало корпусов — не кулак');
  ok(!seMassedAttack('superEarth', SE_MASS_HULLS, SE_MASS_TROOPS - 1), 'мало десанта — не кулак');
  ok(seMassedAttack('superEarth', SE_MASS_HULLS, SE_MASS_TROOPS), 'порог взят — это кулак');

  // Один и тот же мир: разрозненная атака вязнет, массированная — проходит.
  const liberationAfter = (hulls: number, troops: number): number => {
    const s = warGame(702);
    const p = planetsOf(s, 'automatons').find((q) => q.supplied && !q.isCapital)!;
    p.garrison = 60;
    p.fortification = 2;
    const f = spawnFleet(s, 'superEarth', p.id, {
      ships: hulls, infantry: troops, transports: Math.ceil(troops / TRANSPORT_LIFT),
    });
    f.origin = undefined;
    for (let d = 0; d < 30 && p.owner !== 'superEarth'; d++) resolveGround(s);
    return p.owner === 'superEarth' ? 100 : (p.battle?.liberation ?? 0);
  };
  const thin = liberationAfter(SE_MASS_HULLS - 6, SE_MASS_TROOPS - 20);
  const mass = liberationAfter(SE_MASS_HULLS + 10, SE_MASS_TROOPS + 20);
  ok(mass > thin, `массированный удар продвигается дальше (${mass.toFixed(0)} против ${thin.toFixed(0)})`);
  ok(mass >= 100, `кулак Супер-Земли берёт планету (${mass.toFixed(0)})`);
  ok(thin < 100, `разрозненными силами тот же мир не взять (${thin.toFixed(0)})`);
  console.log('доктрина СЗ — концентрация: OK');
}

// --- Доктрина Супер-Земли: рассредоточенность --------------------------------
{
  const s = warGame(703);
  const mine = planetsOf(s, 'superEarth').find((p) => p.supplied && !p.isCapital)!;
  ok(!orbitCovered(s, mine), 'мир без своих кораблей не прикрыт');
  ok(orbitPower(s, mine.id, 'superEarth') === 0, 'мощь на орбите нулевая');

  // Обстрел с орбиты: гарнизон непрокрытого мира тает сам по себе.
  mine.garrison = 60;
  const raider = spawnFleet(s, 'automatons', mine.id, { ships: 20, infantry: 0 });
  const before = mine.garrison;
  resolveBombardment(s);
  ok(mine.garrison < before, `непрокрытый гарнизон осыпается под огнём (${before} → ${mine.garrison.toFixed(1)})`);

  // Тот же обстрел по прикрытому миру не проходит вовсе.
  const covered = planetsOf(s, 'superEarth').find((p) => p.supplied && p.id !== mine.id)!;
  covered.garrison = 60;
  spawnFleet(s, 'automatons', covered.id, { ships: 20, infantry: 0 });
  spawnFleet(s, 'superEarth', covered.id, { ships: 2, infantry: 0, transports: 0 });
  const g2 = covered.garrison;
  resolveBombardment(s);
  ok(covered.garrison === g2, 'прикрытый флотом мир обстрелу не поддаётся');
  ok(hullPower(raider) > 0, 'рейдер цел — обстрел ему ничего не стоит');

  // Супер-Земля страдает от обстрела сильнее прочих.
  const drop = (owner: FactionId): number => {
    const g = warGame(704);
    const p = planetsOf(g, owner).find((q) => q.supplied && !q.isCapital)!;
    p.garrison = 80;
    p.buildings.length = 0;
    spawnFleet(g, owner === 'terminids' ? 'automatons' : 'terminids', p.id, { ships: 20, infantry: 0 });
    const b0 = p.garrison;
    resolveBombardment(g);
    return b0 - p.garrison;
  };
  ok(drop('superEarth') > drop('automatons'), 'миры гегемона уязвимее прочих');
  console.log('доктрина СЗ — рассредоточенность: OK');
}

// --- Стройка занимает время --------------------------------------------------
{
  const s = warGame(705);
  const p = planetsOf(s, 'superEarth').find((q) => q.supplied && !q.depot)!;
  s.factions.superEarth.production = 900;

  ok(!!buildDef('shieldGen') && buildDef('shieldGen')!.days > 1, 'у щита есть срок работ');
  const prodBefore = s.factions.superEarth.production;
  ok(buildShield(s, 'superEarth', p.id), 'щит заложен');
  ok(!!p.build && p.build.id === 'shieldGen', 'на планете появилась стройплощадка');
  ok(!p.buildings.includes('shieldGen'), 'самого щита ещё нет');
  ok(s.factions.superEarth.production < prodBefore, 'производство списано сразу');
  ok(!buildDepot(s, 'superEarth', p.id), 'вторая стройка на том же мире невозможна');

  // Отрезанный мир работы не двигает.
  p.supplied = false;
  const left = p.build!.daysLeft;
  stepConstruction(s);
  ok(p.build!.daysLeft === left, 'без снабжения стройка стоит');
  p.supplied = true;
  stepConstruction(s);
  ok(p.build!.daysLeft < left, 'со снабжением работы идут');

  // Доведём до конца.
  for (let d = 0; d < 40 && p.build; d++) stepConstruction(s);
  ok(p.buildings.includes('shieldGen'), 'щит достроен и принят в строй');

  // Отмена возвращает половину вложенного.
  ok(buildDepot(s, 'superEarth', p.id), 'заложена точка снабжения');
  const before = s.factions.superEarth.production;
  ok(applyCommand(s, 'superEarth', { k: 'cancelBuild', planet: p.id }), 'стройка свёрнута приказом');
  ok(!p.build, 'площадка убрана');
  ok(s.factions.superEarth.production > before, 'половина вложенного вернулась');
  ok(!applyCommand(s, 'automatons', { k: 'cancelBuild', planet: p.id }), 'чужую стройку не свернуть');
  console.log('стройка во времени: OK');
}

// --- Захват сносит всё построенное -------------------------------------------
{
  const s = warGame(706);
  const p = planetsOf(s, 'superEarth').find((q) => q.supplied)!;
  p.buildings = ['shieldGen', 'orbStation', 'termicide'];
  p.depot = true;
  p.shipyard = { queue: { cls: 'destroyer', daysLeft: 3 }, stored: { ships: 5, dreadnoughts: 1, battleships: 0, transports: 2 } };
  beginBuild(s, p, 'specialDock', 120);
  razeBuildings(p);
  ok(p.buildings.length === 0, 'сооружения снесены');
  ok(!p.depot, 'точка снабжения уничтожена');
  ok(!p.shipyard, 'верфь со складом и стапелем уничтожена');
  ok(!p.build, 'недостроенное сгорело на площадке');

  // То же самое в живом бою: планета переходит из рук в руки — и пустеет.
  const s2 = warGame(707);
  const t = planetsOf(s2, 'automatons').find((q) => q.supplied && !q.isCapital)!;
  t.buildings = ['shieldGen', 'incinFactory'];
  t.depot = true;
  t.garrison = 4;
  const inv = spawnFleet(s2, 'superEarth', t.id, { ships: 40, infantry: 120, transports: 12 });
  inv.origin = undefined;
  for (let d = 0; d < 25 && t.owner !== 'superEarth'; d++) resolveGround(s2);
  ok(t.owner === 'superEarth', 'планета захвачена');
  ok(t.buildings.length === 0 && !t.depot, 'у победителя на руках голая планета');
  console.log('захват сносит сооружения: OK');
}

// --- Редактор соединений -----------------------------------------------------
{
  const s = warGame(708);
  const yardWorld = planetsOf(s, 'superEarth').find((p) => p.shipyard)!;
  yardWorld.shipyard!.stored = { ships: 8, dreadnoughts: 2, battleships: 1, transports: 6 };
  const fs = s.factions.superEarth;
  fs.units.seaf = 200;
  fs.units.helldivers = 40;
  const fleetsBefore = fleetsOf(s, 'superEarth').length;

  // Состав задаётся явно, десант — поимённо.
  const made = composeFleet(s, 'superEarth', yardWorld.id, {
    ships: 4, dreadnoughts: 1, battleships: 0, transports: 3,
    troops: { helldivers: 12, seaf: 24 },
  });
  ok(!!made, 'соединение собрано по составу');
  ok(made!.ships === 4 && made!.dreadnoughts === 1 && made!.battleships === 0, 'корпуса взяты ровно по заказу');
  ok(made!.transports === 3, 'транспорты взяты по заказу');
  ok(fleetsOf(s, 'superEarth').length === fleetsBefore + 1, 'соединений стало на одно больше');
  ok(yardWorld.shipyard!.stored.ships === 4, 'остаток остался на складе');
  ok(storedHulls(yardWorld.shipyard!) === 4 + 1 + 1 + 3, 'склад пересчитан верно');

  // Транспорты ограничивают десант: 3 транспорта — 36 бойцов, не больше.
  ok(made!.infantry <= 3 * TRANSPORT_LIFT, `десант не превышает подъёма (${made!.infantry})`);
  ok(fs.units.helldivers === 28, 'элита списана именно из своего пула');

  // Заказ сверх наличия молча урезается, а не проваливается.
  const greedy = composeFleet(s, 'superEarth', yardWorld.id, {
    ships: 999, dreadnoughts: 0, battleships: 0, transports: 0, troops: {},
  });
  ok(!!greedy && greedy!.ships === 4, 'заказ урезан до наличия на складе');

  // Пустой состав — не соединение.
  ok(!composeFleet(s, 'superEarth', yardWorld.id, {
    ships: 0, dreadnoughts: 0, battleships: 0, transports: 0, troops: { seaf: 50 },
  }), 'без единого корпуса соединения не бывает');

  // Приказ ходит через сеть и не даёт собирать на чужом мире.
  const proto = read('src', 'net', 'protocol.ts');
  const cmds = read('src', 'net', 'commands.ts');
  ok(proto.includes("k: 'composeFleet'"), 'редактор ходит через протокол');
  ok(cmds.includes("case 'composeFleet'"), 'хост исполняет сборку соединения');
  ok(proto.includes("k: 'cancelBuild'"), 'отмена стройки ходит через протокол');
  ok(/PROTOCOL_VERSION = [4-9]/.test(proto), 'версия протокола поднята');
  const alien = planetsOf(s, 'automatons')[0]!;
  ok(!applyCommand(s, 'superEarth', {
    k: 'composeFleet', planet: alien.id, ships: 1, dreadnoughts: 0,
    battleships: 0, transports: 0, troops: {},
  }), 'на чужой верфи соединение не собрать');
  console.log('редактор соединений: OK');
}

// --- Верфь умеет строить транспорты ------------------------------------------
{
  const s = warGame(709);
  const p = planetsOf(s, 'superEarth').find((q) => q.shipyard && q.supplied)!;
  s.factions.superEarth.production = 900;
  s.factions.superEarth.resources.minerals = 900;
  ok(queueShip(s, 'superEarth', p.id, 'transport'), 'транспорт поставлен на стапель');
  ok(!queueShip(s, 'automatons', p.id, 'transport'), 'автоматоны транспорт не закажут');
  for (let d = 0; d < 30 && p.shipyard!.queue; d++) stepShipyards(s);
  ok((p.shipyard!.stored.transports ?? 0) > 0, 'транспорты легли на склад отдельной строкой');
  console.log('верфь и транспорты: OK');
}

// --- ИИ: несколько осей наступления ------------------------------------------
{
  const s = warGame(710, 'terminids');
  // Автоматонами правит ИИ; дадим им много соединений и посмотрим, куда пойдут.
  const home = planetsOf(s, 'automatons').filter((p) => p.supplied);
  for (let i = 0; i < 6; i++) {
    spawnFleet(s, 'automatons', home[i % home.length]!.id, { ships: 12, infantry: 40 });
  }
  runAI(s, 'automatons');
  const dests = new Set<string>();
  for (const f of fleetsOf(s, 'automatons')) {
    if (f.order && f.order.kind !== 'idle') dests.add(f.order.target);
  }
  ok(dests.size >= 2, `ИИ ведёт наступление несколькими осями (целей: ${dests.size})`);

  const ai = read('src', 'game', 'ai.ts');
  ok(ai.includes('committed'), 'ИИ учитывает уже направленные на цель силы');
  ok(ai.includes('export function aiBuild'), 'у ИИ есть осмысленная стройка');
  ok(!read('src', 'game', 'sim.ts').includes('aiBuildDefenses'), 'старая стройка «щит на ценнейший мир» убрана');
  console.log('ИИ — оси наступления: OK');
}

// --- ИИ: стройка по ролям миров ----------------------------------------------
{
  const s = warGame(711, 'terminids');
  const fs = s.factions.automatons;
  fs.production = 4000;
  // Дадим ИИ построиться несколько раз подряд и посмотрим, что он выбрал.
  for (let i = 0; i < 12; i++) aiBuild(s, 'automatons');
  const sites = planetsOf(s, 'automatons').filter((p) => p.build);
  ok(sites.length >= 2, `ИИ заложил стройки на нескольких мирах (${sites.length})`);
  ok(new Set(sites.map((p) => p.id)).size === sites.length, 'по одной площадке на мир');
  const kinds = new Set(sites.map((p) => p.build!.id));
  ok(kinds.size >= 2, `ИИ строит разное, а не одно и то же (${[...kinds].join(', ')})`);
  console.log('ИИ — стройка: OK');
}

// --- Сохранения и старые партии ----------------------------------------------
{
  const s = warGame(712);
  const p = planetsOf(s, 'superEarth').find((q) => q.supplied)!;
  s.factions.superEarth.production = 900;
  buildShield(s, 'superEarth', p.id);
  const back = deserializeState(serializeState(s, 'slot1', 'тест'));
  const p2 = back.galaxy.planets.get(p.id)!;
  ok(p2.build?.id === 'shieldGen', 'стройплощадка переживает сохранение');
  ok(p2.build!.daysLeft === p.build!.daysLeft, 'срок работ сохранён');

  // Старый сейв без транспортов: соединениям СЗ выдаются аппарели под десант.
  const blob = JSON.parse(serializeState(s, 'slot1', 'тест')) as { fleets: Record<string, unknown>[] };
  for (const f of blob.fleets) delete f.transports;
  const legacy = deserializeState(JSON.stringify(blob));
  for (const f of legacy.fleets.values()) {
    if (f.faction !== 'superEarth') continue;
    ok(landableInfantry(f) >= f.infantry - 0.001, `старое соединение СЗ не потеряло десант (${f.id})`);
  }
  console.log('сохранения: OK');
}

// --- Партия не ломается на длинной дистанции ---------------------------------
{
  const s = warGame(713);
  // Стройплощадка живёт считанные дни, поэтому снимок на 400-й день ничего не
  // доказывает: смотрим на всю дистанцию.
  let seenSites = 0;
  for (let d = 0; d < 400; d++) {
    advanceDay(s);
    for (const id of s.galaxy.order) {
      const p = s.galaxy.planets.get(id)!;
      if (!p.build) continue;
      seenSites++;
      ok(p.build.daysLeft <= p.build.total + 0.001, `срок стройки в пределах нормы (${p.name})`);
      ok(!!buildDef(p.build.id), `стройка знает, что возводит (${p.build.id})`);
    }
  }
  ok(seenSites > 0, `за 400 дней в галактике шли стройки (${seenSites} площадко-дней)`);
  const razed = s.galaxy.order
    .map((id) => s.galaxy.planets.get(id)!)
    .filter((p) => p.owner !== p.origin && p.buildings.length === 0).length;
  ok(razed > 0, `захваченные миры отстраиваются с нуля (${razed})`);
  for (const f of s.fleets.values()) {
    ok(f.infantry >= 0 && (f.transports ?? 0) >= 0, `состав соединения не ушёл в минус (${f.id})`);
    if (f.faction === 'superEarth') {
      ok(f.infantry <= liftCapacity(f) + 0.001, `десант СЗ не превышает подъёма (${f.id})`);
    }
  }
  console.log(`longrun: OK (день ${s.day})`);
}

console.log(`round53: OK (${checks} проверок)`);
