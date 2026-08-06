// Раунд 29: спецоперации, оборонительные сооружения, опыт соединений,
// перехват снабжения, очередь приказов, обломки/шрамы, сейв новых полей.
import { createGame, spawnFleet } from '../src/game/state';
import { advanceDay, moveFleets } from '../src/game/sim';
import { orderFleetTo } from '../src/game/units';
import { resolveGround, resolveOrbital, hullCount } from '../src/game/combat';
import { opReadyIn, reconActive, runRecon, runSabotage, runUprising, originBlockaded } from '../src/game/specops';
import { buildShield, buildStation, demolishDefenses } from '../src/game/defense';
import { gainXp, rankOf, nextRankIn } from '../src/game/veterancy';
import { serializeState, deserializeState } from '../src/game/persist';
import { emptyYard } from '../src/game/shipyards';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

// --- Спецоперации -----------------------------------------------------------
{
  const s = createGame(7);
  const se = s.factions.superEarth;
  se.politicalPower = 500;

  // Диверсия: вражеская планета с верфью и складом.
  const enemyYardWorld = s.galaxy.order
    .map((id) => s.galaxy.planets.get(id)!)
    .find((p) => p.owner === 'automatons' && !p.shattered)!;
  enemyYardWorld.shipyard = emptyYard();
  enemyYardWorld.shipyard.stored.ships = 9;
  enemyYardWorld.shipyard.queue = { cls: 'destroyer', daysLeft: 5 };
  ok(runSabotage(s, 'superEarth', enemyYardWorld.id), 'диверсия должна пройти');
  ok(enemyYardWorld.shipyard!.stored.ships === 0 && !enemyYardWorld.shipyard!.queue, 'склад и стапель уничтожены');
  ok(se.politicalPower === 410, `цена диверсии списана (осталось ${se.politicalPower})`);
  ok(opReadyIn(s, 'superEarth', 'sabotage') > 0, 'кулдаун диверсии активен');
  ok(!runSabotage(s, 'superEarth', enemyYardWorld.id), 'повторная диверсия в кулдауне запрещена');

  // Разведка: сектор вскрыт и закрывается по истечении срока.
  const target = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!).find((p) => p.owner === 'terminids')!;
  ok(runRecon(s, 'superEarth', target.id), 'разведка должна пройти');
  ok(reconActive(s, target.sector), 'сектор разведан');
  s.day += 31;
  advanceDay(s);
  ok(!reconActive(s, target.sector), 'разведка истекла через 30 дней');

  // Агитация: гарнизон редеет, укрепления рушатся.
  const upTarget = s.galaxy.order
    .map((id) => s.galaxy.planets.get(id)!)
    .find((p) => p.owner === 'automatons')!;
  upTarget.garrison = Math.max(upTarget.garrison, 20);
  upTarget.fortification = 3;
  const wasGarrison = upTarget.garrison;
  ok(runUprising(s, 'superEarth', upTarget.id), 'агитация должна пройти');
  ok(upTarget.garrison < wasGarrison && upTarget.fortification === 2, 'гарнизон и укрепления просели');
  console.log('спецоперации: OK');
}

// --- Оборона: щит и орбитальная станция ------------------------------------
{
  const s = createGame(11);
  const se = s.factions.superEarth;
  se.production = 1000;
  const home = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!).find((p) => p.owner === 'superEarth' && p.supplied)!;
  ok(buildShield(s, 'superEarth', home.id), 'щит строится');
  ok(buildStation(s, 'superEarth', home.id), 'станция строится');
  ok(!buildShield(s, 'superEarth', home.id), 'второй щит на планете запрещён');

  // Станция бьёт по вражескому флоту даже при пустой своей орбите.
  const raider = spawnFleet(s, 'automatons', home.id, { ships: 10, infantry: 5 });
  const hullsBefore = hullCount(raider);
  resolveOrbital(s);
  ok(hullCount(raider) < hullsBefore, `станция нанесла урон (${hullsBefore} → ${hullCount(raider)})`);
  ok((home.wreckage ?? 0) > 0, 'после боя на орбите остались обломки');

  // При захвате оборона гибнет.
  demolishDefenses(home);
  ok(!home.buildings.includes('shieldGen') && !home.buildings.includes('orbStation'), 'оборона снесена при захвате');
  console.log('оборона: OK');
}

// --- Опыт и ранги -----------------------------------------------------------
{
  const s = createGame(13);
  const f = spawnFleet(s, 'superEarth', 'p_super_earth', { ships: 5, infantry: 10 });
  ok(rankOf(f).name === 'Новобранцы', 'старт — новобранцы');
  gainXp(f, 30);
  ok(rankOf(f).name === 'Обстрелянные' && rankOf(f).mult > 1, '25+ опыта — обстрелянные');
  gainXp(f, 1000);
  ok((f.xp ?? 0) <= 500, 'опыт ограничен потолком');
  ok(rankOf(f).name === 'Элита' && nextRankIn(f) === null, 'потолок — элита');
  console.log('опыт соединений: OK');
}

// --- Перехват снабжения атаки ----------------------------------------------
{
  const s = createGame(17);
  const origin = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!).find((p) => p.owner === 'superEarth')!;
  ok(!originBlockaded(s, origin.id, 'superEarth'), 'плацдарм чист');
  spawnFleet(s, 'automatons', origin.id, { ships: 6, infantry: 3 });
  ok(originBlockaded(s, origin.id, 'superEarth'), 'вражеский рейдер режет снабжение с плацдарма');
  console.log('перехват снабжения: OK');
}

// --- Очередь приказов -------------------------------------------------------
{
  const s = createGame(23);
  const start = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!).find((p) => p.owner === 'superEarth' && p.links.length >= 2)!;
  // Цепочка своих планет: соседняя своя, затем ещё одна.
  const hop1 = start.links.map((id) => s.galaxy.planets.get(id)!).find((p) => p.owner === 'superEarth');
  if (hop1) {
    const hop2 = hop1.links.map((id) => s.galaxy.planets.get(id)!).find((p) => p.owner === 'superEarth' && p.id !== start.id) ?? start;
    const f = spawnFleet(s, 'superEarth', start.id, { ships: 4, infantry: 8 });
    ok(orderFleetTo(s, f, hop1.id, false), 'первый приказ принят');
    f.orderQueue = [{ target: hop2.id }];
    for (let d = 0; d < 60 && (f.transit || f.orderQueue); d++) moveFleets(s, 1);
    ok(!f.transit && f.at === hop2.id, `очередь отработана: флот у ${hop2.id} (факт: ${f.at})`);
    console.log('очередь приказов: OK');
  } else {
    console.log('очередь приказов: пропуск (нет цепочки своих планет у сида)');
  }
}

// --- Шрамы долгих битв ------------------------------------------------------
{
  const s = createGame(29);
  const target = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!)
    .find((p) => p.owner === 'automatons' && p.supplied)!;
  target.garrison = 30;
  const inv = spawnFleet(s, 'superEarth', target.id, { ships: 30, infantry: 400 });
  inv.origin = undefined;
  resolveGround(s); // битва завязывается
  ok(!!target.battle && target.battle.attacker === 'superEarth', 'битва началась');
  // Затяжной штурм: на 25-й день битвы контроль почти дожат.
  target.battle!.days = 24;
  target.battle!.liberation = 99;
  resolveGround(s);
  ok(target.owner === 'superEarth', 'планета взята штурмом');
  ok(!!target.scarred, 'долгая битва оставила шрамы');
  ok((inv.xp ?? 0) > 0, 'штурмовавший флот получил опыт');
  console.log(`шрамы и захват: OK (опыт ${inv.xp?.toFixed(0)})`);
}

// --- Сейв: новые поля переживают (де)сериализацию ---------------------------
{
  const s = createGame(31);
  const f = spawnFleet(s, 'superEarth', 'p_super_earth', { ships: 3, infantry: 5 });
  gainXp(f, 80);
  f.orderQueue = [{ target: s.galaxy.order[3]! }];
  s.recons.push({ sector: 'Тестовый', until: 999 });
  s.factions.superEarth.opsUsed['recon'] = 5;
  const earth = s.galaxy.planets.get('p_super_earth')!;
  earth.wreckage = 7;
  earth.scarred = true;

  const restored = deserializeState(serializeState(s, 'slot1', 'test'));
  const rf = restored.fleets.get(f.id)!;
  ok((rf.xp ?? 0) === (f.xp ?? 0), 'опыт пережил сейв');
  ok(rf.orderQueue?.[0]?.target === f.orderQueue[0]!.target, 'очередь приказов пережила сейв');
  ok(restored.recons.length === 1 && restored.recons[0]!.sector === 'Тестовый', 'разведоперации пережили сейв');
  ok(restored.factions.superEarth.opsUsed['recon'] === 5, 'кулдауны операций пережили сейв');
  const rEarth = restored.galaxy.planets.get('p_super_earth')!;
  ok(rEarth.wreckage === 7 && rEarth.scarred === true, 'обломки и шрамы пережили сейв');
  console.log('сейвы: OK');
}

console.log(`round29: OK (${checks} проверок)`);
