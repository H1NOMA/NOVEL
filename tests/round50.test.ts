// Раунд 50: независимые окна управления у каждой фракции, свои названия
// соединений, слияние групп, разбор источников ресурсов и окно чужой фракции
// с подсветкой карты в духе HoI4.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, fleetsOf, planetsOf, spawnFleet, type GameState } from '../src/game/state';
import { mergeFleets } from '../src/game/units';
import { encodeSnapshot, applySnapshot } from '../src/net/snapshot';
import { applyCommand } from '../src/net/commands';
import { FACTIONS, FACTION_IDS, FLEET_NOUN, fleetTitle, homeworldFaction } from '../src/data/factions';
import { mineralsReport, powerReport, productionReport, e711Report } from '../src/game/economy';
import { mineMinerals, mineE711 } from '../src/game/troops';
import { accruePower } from '../src/game/politics';
import { checkObjectives, objectiveKey, objectivesFor } from '../src/game/objectives';
import { recomputeSupply } from '../src/game/supply';
import type { FactionId } from '../src/core/types';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;
const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');

// --- Своё у каждого экрана ------------------------------------------------------
{
  // Клиент играет за иллюминатов, хост — за Супер-Землю. После снапшота у
  // клиента обязана остаться СВОЯ точка зрения: своя фракция, своё поражение,
  // своё окно выбора события.
  const host = createGame(4242, 'superEarth');
  const client = createGame(4242, 'illuminate');
  host.pendingChoices = { superEarth: 'ev_host_only' };
  host.playerDefeated = true;
  host.day = 77;

  applySnapshot(client, encodeSnapshot(host));
  ok(client.player === 'illuminate', 'фракция клиента не подменяется хозяйской');
  ok(client.day === 77, 'мир при этом приезжает целиком');
  ok(client.pendingChoices.illuminate !== 'ev_host_only', 'чужое окно выбора события не показывается');
  ok(client.pendingChoices.superEarth === 'ev_host_only', 'но чужая развилка в состоянии видна — она хозяйская');
  ok(client.playerDefeated === false, 'поражение считается по своей фракции');

  // А вот собственное поражение флаг обязан поймать.
  const dead = createGame(4242, 'illuminate');
  host.factions.illuminate.alive = false;
  applySnapshot(dead, encodeSnapshot(host));
  ok(dead.playerDefeated === true, 'гибель СВОЕЙ фракции отмечается поражением');

  const snap = read('src', 'net', 'snapshot.ts');
  ok(!snap.includes('target.playerDefeated = fresh.playerDefeated'), 'playerDefeated не копируется с хоста');
  ok(!snap.includes('target.player = fresh.player'), 'player не копируется с хоста');

  // Древо фокусов открывается на своей фракции, а не на Супер-Земле.
  const ui = read('src', 'ui', 'ui.ts');
  ok(!ui.includes("focusTab: FactionId = 'superEarth'"), 'вкладка фокусов не прибита к Супер-Земле');
  ok(ui.includes('this.focusTab = state.player'), 'вкладка фокусов открывается на своей фракции');
  console.log('независимость экранов: OK');
}

// --- Цели кампании личные ---------------------------------------------------------
{
  const s = createGame(9, 'superEarth');
  s.humans = ['superEarth', 'illuminate'];
  // «Кузница флота» проверяется по своим верфям, значит ключ обязан быть личным.
  ok(objectiveKey('illuminate', 'obj_yards') === 'illuminate:obj_yards', 'ключ цели содержит фракцию');
  ok(objectivesFor('illuminate').every((o) => !o.faction || o.faction === 'illuminate'),
    'чужие фракционные цели не предлагаются');
  ok(objectivesFor('superEarth').some((o) => o.id === 'obj_capitulate'),
    'фракционная цель Супер-Земли на месте');
  ok(!objectivesFor('illuminate').some((o) => o.id === 'obj_capitulate'),
    'иллюминатам капитуляция роя целью не ставится');

  // Взятие Киберстана засчитывается ТОМУ, кто его взял.
  const cyber = [...s.galaxy.planets.values()].find((p) => p.name === 'Киберстан')!;
  cyber.owner = 'illuminate';
  checkObjectives(s);
  ok(s.doneObjectives.includes('illuminate:obj_cyberstan'), 'цель зачтена взявшей фракции');
  ok(!s.doneObjectives.includes('superEarth:obj_cyberstan'), 'и не зачтена хозяину партии');
  const before = s.factions.illuminate.politicalPower;
  checkObjectives(s);
  ok(near(s.factions.illuminate.politicalPower, before), 'награда выдаётся один раз');
  console.log('личные цели кампании: OK');
}

// --- Названия соединений по фракциям ------------------------------------------------
{
  const expected: Record<string, string> = {
    superEarth: 'Соединение', automatons: 'Сенатор',
    illuminate: 'Иерарх', terminids: 'Улей',
  };
  for (const [f, noun] of Object.entries(expected)) {
    ok(FLEET_NOUN[f as FactionId] === noun, `${f}: соединение зовётся «${noun}»`);
    ok(fleetTitle(f as FactionId, 3) === `${noun} №3`, `${f}: номер подставляется`);
  }
  ok(new Set(Object.values(FLEET_NOUN)).size === Object.keys(FLEET_NOUN).length,
    'у каждой фракции своё слово');
  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes('fleetTitle('), 'интерфейс берёт название из данных фракции');
  ok(ui.includes('FLEET_NOUN[f.faction]'), 'номер карточки чистится по слову своей фракции');
  const units = read('src', 'game', 'units.ts');
  ok(units.includes('FLEET_NOUN'), 'журнал пишет фракционным словом');
  console.log('названия соединений: OK');
}

// --- Слияние соединений -------------------------------------------------------------
{
  const s = createGame(11, 'superEarth');
  const home = planetsOf(s, 'superEarth')[0]!;
  const other = planetsOf(s, 'superEarth')[1]!;

  const a = spawnFleet(s, 'superEarth', home.id, { ships: 4, infantry: 10 });
  a.xp = 100;
  const b = spawnFleet(s, 'superEarth', home.id, { ships: 6, infantry: 5, special: 'dss' });
  b.xp = 0;
  const far = spawnFleet(s, 'superEarth', other.id, { ships: 3, infantry: 3 });
  const alien = spawnFleet(s, 'automatons', home.id, { ships: 9, infantry: 9 });

  const merged = mergeFleets(s, a, [b, far, alien]);
  ok(merged === 1, 'слилось только соединение с той же орбиты своей фракции');
  ok(a.ships === 10 && a.infantry === 15, 'корпуса и пехота сложились');
  ok(a.special === 'dss', 'спецстанция переехала к приёмнику');
  ok(!s.fleets.has(b.id) && !s.fleetOrder.includes(b.id), 'слитое соединение исчезло из списка');
  ok(s.fleets.has(far.id) && s.fleets.has(alien.id), 'чужое и далёкое остались на месте');
  // Опыт взвешен по корпусам: 100 на четырёх плюс 0 на шести = 40.
  ok(near(a.xp ?? 0, 40, 1e-9), `опыт взвешен по корпусам (${a.xp})`);
  ok(a.order?.kind === 'idle', 'текущий приказ сброшен');

  // В бою орбиту не покинуть — и не слиться.
  const s2 = createGame(12, 'superEarth');
  const w = planetsOf(s2, 'superEarth')[0]!;
  const t = spawnFleet(s2, 'superEarth', w.id, { ships: 2, infantry: 2 });
  const u = spawnFleet(s2, 'superEarth', w.id, { ships: 2, infantry: 2 });
  w.battle = { attacker: 'automatons', defender: 'superEarth', attackerForce: 10, defenderForce: 10, liberation: 10, days: 1 };
  ok(mergeFleets(s2, t, [u]) === 0, 'скованные боем не сливаются');
  w.battle = undefined;
  u.transit = { from: w.id, to: w.id, progress: 0.5, invade: false, path: [w.id] };
  ok(mergeFleets(s2, t, [u]) === 0, 'соединение в перелёте не сливается');

  // Сеть: приказ есть в протоколе и проверяет принадлежность КАЖДОГО флота.
  const proto = read('src', 'net', 'protocol.ts');
  ok(proto.includes("k: 'mergeFleets'"), 'приказ слияния описан в протоколе');
  const cmds = read('src', 'net', 'commands.ts');
  ok(cmds.includes("case 'mergeFleets'"), 'хост исполняет приказ слияния');
  ok(/c\.sources\s*\.?\s*\.map\(\(id\) => ownFleet\(state, actor, id\)\)/.test(cmds)
    || /c\.sources[\s\S]{0,40}ownFleet\(state, actor, id\)/.test(cmds),
    'каждый источник проверяется на принадлежность');

  const s3 = createGame(13, 'superEarth');
  const w3 = planetsOf(s3, 'superEarth')[0]!;
  const mine = spawnFleet(s3, 'superEarth', w3.id, { ships: 3, infantry: 3 });
  const theirs = spawnFleet(s3, 'automatons', w3.id, { ships: 5, infantry: 5 });
  applyCommand(s3, 'superEarth', { k: 'mergeFleets', target: mine.id, sources: [theirs.id] });
  ok(s3.fleets.has(theirs.id) && mine.ships === 3, 'чужие корабли не присваиваются приказом');

  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes('mergeInto('), 'слияние подключено к интерфейсу');
  ok(ui.includes("contextmenu"), 'слияние вешается на правый щелчок по карточке');
  console.log('слияние соединений: OK');
}

// --- Источники ресурсов ---------------------------------------------------------------
{
  // Отчёт обязан сходиться с симуляцией: иначе окно врёт игроку.
  for (const f of FACTION_IDS) {
    const s = createGame(31, f);
    recomputeSupply(s);
    const rep = mineralsReport(s, f);
    const actual = mineMinerals(s, f);
    const reported = rep.income.reduce((sum, l) => sum + l.amount, 0);
    ok(near(reported, actual, 1e-9), `${f}: руда в отчёте сходится с добычей (${reported} / ${actual})`);
  }

  {
    const s = createGame(32, 'superEarth');
    recomputeSupply(s);
    const fs = s.factions.superEarth;
    const before = fs.politicalPower;
    const rep = powerReport(s, 'superEarth');
    accruePower(s, 'superEarth');
    ok(near(rep.gross, fs.politicalPower - before, 1e-9), 'политвласть в отчёте сходится с приростом');

    // Производство: база плюс доля ценности миров, минус содержание флота.
    const worlds = planetsOf(s, 'superEarth');
    const mult = 0.75 + fs.stability / 200;
    const expect = 0.4 * (fs.industry + worlds.reduce((sum, p) => sum + p.value, 0) * 0.3) * mult;
    const prod = productionReport(s, 'superEarth');
    ok(near(prod.gross, expect, 1e-6), `производство сходится с формулой (${prod.gross} / ${expect})`);
    const hulls = fleetsOf(s, 'superEarth')
      .reduce((sum, fl) => sum + fl.ships + fl.dreadnoughts * 2 + fl.battleships * 4, 0);
    ok(near(prod.gross - prod.net, hulls * 0.05, 1e-9), 'содержание флота учтено расходом');
    ok(prod.income.length > 0 && prod.income.every((l) => l.amount > 0), 'источники перечислены поимённо');
    ok(prod.income.some((l) => l.name === 'Промышленная база'), 'промбаза отдельной строкой');

    // Е-711: решение включено — доход обязан совпасть с добычей.
    fs.flags.e711Mining = true;
    const term = planetsOf(s, 'superEarth').find((p) => p.origin === 'terminids');
    if (term) term.e711Rich = true;
    const e711 = e711Report(s);
    const stock = fs.resources.e711;
    mineE711(s);
    ok(near(e711.gross, fs.resources.e711 - stock, 1e-9), 'Е-711 в отчёте сходится с добычей');
    ok(e711.income.every((l) => !!l.detail), 'у каждого источника Е-711 указано место');
  }

  // Мир без снабжения руды не даёт — и попадает в «не поступает», а не в расход.
  {
    const s = createGame(33, 'automatons');
    recomputeSupply(s);
    const rich = planetsOf(s, 'automatons').find((p) => p.minerals > 0 && p.supplied);
    if (rich) {
      const withSupply = mineralsReport(s, 'automatons').gross;
      rich.supplied = false;
      const rep = mineralsReport(s, 'automatons');
      ok(rep.gross < withSupply, 'отрезанный мир выпадает из прихода');
      ok(rep.blocked.some((l) => l.name === rich.name || l.name.startsWith('Прочие')),
        'и попадает в список молчащих источников');
      ok(near(rep.net, rep.gross - rep.drain.reduce((sum, l) => sum + l.amount, 0), 1e-9),
        'итог считается без упущенного дохода');
    }
  }

  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes('data-res="production"') || ui.includes("res=\"${res}\"") || ui.includes('data-res="${res}"'),
    'цифры в шапке помечены ресурсом');
  ok(ui.includes('openResource('), 'клик по цифре открывает окно источников');
  ok(ui.includes('resourceReport('), 'окно строится по отчёту');
  const css = read('src', 'style.css');
  ok(css.includes('#resource-panel'), 'у окна источников есть оформление');
  ok(css.includes('.hud-res'), 'кликабельная цифра выделена');
  console.log('источники ресурсов: OK');
}

// --- Окно чужой фракции и подсветка карты ------------------------------------------------
{
  for (const f of FACTION_IDS) {
    ok(homeworldFaction(FACTIONS[f].capital) === f, `${f}: столица опознаётся как родной мир`);
  }
  ok(homeworldFaction('Мелевелон-Крик') === null, 'обычный мир окна фракции не открывает');

  // Столица под чужим флагом остаётся родным миром прежних хозяев.
  const s = createGame(51, 'superEarth');
  const cyber = [...s.galaxy.planets.values()].find((p) => p.name === 'Киберстан')!;
  cyber.owner = 'superEarth';
  ok(homeworldFaction(cyber.name) === 'automatons', 'захваченная столица помнит хозяев');

  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes('openFaction('), 'окно фракции есть');
  const rc = ui.slice(ui.indexOf('private onPlanetRightClicked('),
    ui.indexOf('private onPlanetRightClicked(') + 1200);
  ok(rc.includes('homeworldFaction(dest.name)'), 'ПКМ по родному миру открывает окно фракции');
  ok(rc.includes('!picks.length'), 'но только когда соединения не выделены');
  ok(ui.includes('closeFaction()'), 'окно закрывается');
  const esc = ui.slice(ui.indexOf('private closeTopOverlay('),
    ui.indexOf('private closeTopOverlay(') + 700);
  ok(esc.includes('this.closeFaction()'), 'ESC снимает окно фракции первым');
  ok(ui.includes('setFactionSpotlight(f)') && ui.includes('setFactionSpotlight(null)'),
    'подсветка карты включается и гасится вместе с окном');

  const scene = read('src', 'render', 'scene.ts');
  ok(scene.includes('setFactionSpotlight('), 'сцена умеет подсвечивать фракцию');
  const spot = scene.slice(scene.indexOf('private refreshSectors('),
    scene.indexOf('refreshOwners(): void'));
  ok(spot.includes('this.spotlight'), 'сектора знают о подсветке');
  ok(spot.includes("p.owner === this.spotlight"), 'сектор красится по присутствию фракции');
  ok(/alpha = 0\.00\d/.test(spot), 'чужие сектора уходят в тень');
  ok(scene.includes('p.owner === this.spotlight ? 1 :'), 'чужие миры притухают');

  const css = read('src', 'style.css');
  ok(css.includes('#faction-panel'), 'у окна фракции есть оформление');
  console.log('окно фракции и подсветка: OK');
}

// --- Подсказок в интерфейсе не прибавилось -----------------------------------------------
{
  // Требование стоит с раунда 47: никаких всплывающих пояснений на карте.
  const ui = read('src', 'ui', 'ui.ts');
  const res = ui.slice(ui.indexOf('private renderResource('), ui.indexOf('private openFaction('));
  ok(!res.includes('title="'), 'окно источников обходится без всплывашек');
  console.log('без подсказок: OK');
}

console.log(`round50: OK (${checks} проверок)`);
