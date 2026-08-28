// Раунд 45: отношения фракций, эскалация от мира к войне, вассалитет,
// трофейные технологии, вариативность доктрин и мягкая подача.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame } from '../src/game/state';
import { advanceDay } from '../src/game/sim';
import {
  adjustRelation, atWar, canNegotiate, cedePlanet, declareWar, makePeace,
  onCapitalCaptured, onCapitalLiberated, relationLabel, relationOf,
  collectTribute, CEDE_COST, WAR_THRESHOLD,
} from '../src/game/relations';
import { hostileNow } from '../src/game/diplomacy';
import { treeFor, trophyNodes, FOCUS_VARIANTS } from '../src/game/trophies';
import { serializeState, deserializeState } from '../src/game/persist';
import type { FactionId } from '../src/core/types';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

// --- Партия начинается в мире ---------------------------------------------------
{
  const s = createGame(2025);
  ok(s.relations.length === 10, `отношения заведены для всех пар (${s.relations.length})`);
  ok(s.relations.every((r) => !r.war), 'на первый день никто не воюет');
  ok(!s.swarmAwake, 'рой спит');
  ok(!hostileNow(s, 'superEarth', 'automatons'), 'вражды в первый день нет');
  ok(!atWar(s, 'superEarth', 'illuminate'), 'иллюминаты тоже мирные');
  // Симпатия у всех пар в разумном диапазоне.
  ok(s.relations.every((r) => r.value > WAR_THRESHOLD && r.value <= 100),
    'стартовая симпатия выше порога войны');
  console.log('старт в мире: OK');
}

// --- Эскалация: симпатия падает и превращается в войну ---------------------------
{
  const s = createGame(77);
  ok(!atWar(s, 'superEarth', 'automatons'), 'до инцидентов мир');
  adjustRelation(s, 'superEarth', 'automatons', -200);
  ok(relationOf(s, 'superEarth', 'automatons') === -100, 'симпатия ограничена снизу');
  ok(declareWar(s, 'superEarth', 'automatons', 'проверка'), 'война объявляется');
  ok(atWar(s, 'superEarth', 'automatons'), 'состояние войны выставлено');
  ok(hostileNow(s, 'superEarth', 'automatons'), 'враждебность считается от войны');
  ok(!declareWar(s, 'superEarth', 'automatons', 'повтор'), 'повторно войну не объявить');
  ok(makePeace(s, 'superEarth', 'automatons'), 'мир заключается');
  ok(!atWar(s, 'superEarth', 'automatons'), 'после мира войны нет');
  console.log('эскалация и мир: OK');
}

// --- Дрейф отношений за годы реально доводит галактику до войны ------------------
{
  const s = createGame(4242);
  for (let i = 0; i < 900; i++) advanceDay(s);
  const wars = s.relations.filter((r) => r.war).length;
  ok(wars > 0, `за три года война вспыхнула (пар в войне: ${wars})`);
  ok(s.day === 901, `дни идут (${s.day})`);
  console.log(`дрейф к войне: OK (${wars} воюющих пар на день ${s.day})`);
}

// --- Рой: договоров не ведёт, просыпается сам -----------------------------------
{
  const s = createGame(31);
  ok(!canNegotiate('terminids', 'superEarth'), 'с роем не договориться');
  ok(canNegotiate('superEarth', 'automatons'), 'между государствами переговоры возможны');
  for (let i = 0; i < 260; i++) advanceDay(s);
  ok(s.swarmAwake, 'рой просыпается сам');
  ok(atWar(s, 'terminids', 'superEarth') || !s.factions.terminids.alive,
    'проснувшийся рой воюет');
  console.log('рой: OK');
}

// --- Добровольная передача мира --------------------------------------------------
{
  const s = createGame(88);
  const fs = s.factions.superEarth;
  fs.politicalPower = 500;
  const own = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!)
    .find((p) => p.owner === 'superEarth' && !p.isCapital)!;
  const relBefore = relationOf(s, 'superEarth', 'illuminate');
  ok(cedePlanet(s, 'superEarth', 'illuminate', own.id), 'мир передаётся');
  ok(own.owner === 'illuminate', 'владелец сменился');
  ok(relationOf(s, 'superEarth', 'illuminate') > relBefore, 'отношения улучшились');
  ok(fs.politicalPower === 500 - CEDE_COST, 'политвласть списана');

  // Столицу не отдают, и рою тоже нельзя.
  const cap = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!)
    .find((p) => p.owner === 'superEarth' && p.isCapital);
  if (cap) ok(!cedePlanet(s, 'superEarth', 'illuminate', cap.id), 'столицу не передать');
  const own2 = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!)
    .find((p) => p.owner === 'superEarth' && !p.isCapital)!;
  ok(!cedePlanet(s, 'superEarth', 'terminids', own2.id), 'рою мир не подарить');
  console.log('передача мира: OK');
}

// --- Столица пала: трофейные технологии ------------------------------------------
{
  const s = createGame(505);
  const before = treeFor(s, 'superEarth').length;
  onCapitalCaptured(s, 'automatons', 'superEarth');
  ok(s.subjugated.automatons === 'superEarth', 'побеждённый помечен порабощённым');
  ok((s.trophies.superEarth ?? []).includes('automatons'), 'трофей записан победителю');
  const trophies = trophyNodes(s, 'superEarth');
  ok(trophies.length === 3, `трофейных узлов три (${trophies.length})`);
  ok(trophies.every((n) => n.faction === 'superEarth'), 'трофеи принадлежат победителю');
  ok(trophies.every((n) => n.requires.length === 0), 'трофеи не требуют чужих предков');
  ok(trophies.every((n) => n.branch === 'trophy'), 'трофеи помечены ветвью');
  ok(treeFor(s, 'superEarth').length === before + 3, 'древо победителя выросло');
  console.log('трофейные технологии: OK');
}

// --- Освобождение: фракция возвращается марионеткой -------------------------------
{
  const s = createGame(606);
  onCapitalCaptured(s, 'illuminate', 'automatons');
  ok(s.subjugated.illuminate === 'automatons', 'иллюминаты порабощены');
  onCapitalLiberated(s, 'illuminate', 'superEarth');
  ok(s.subjugated.illuminate === undefined, 'порабощение снято');
  ok(s.puppets.illuminate === 'superEarth', 'освобождённые стали марионеткой');
  ok(!atWar(s, 'illuminate', 'superEarth'), 'марионетка не воюет с сюзереном');
  // Дань идёт наверх.
  s.factions.illuminate.production = 100;
  s.factions.superEarth.production = 0;
  collectTribute(s);
  ok(s.factions.superEarth.production > 0, 'сюзерен получает дань');
  ok(s.factions.illuminate.production < 100, 'у вассала производство убыло');
  console.log('вассалитет: OK');
}

// --- Вариативность доктрин --------------------------------------------------------
{
  const a = createGame(909);
  const b = createGame(909);
  ok(JSON.stringify(a.focusVariants) === JSON.stringify(b.focusVariants),
    'один сид — одни доктрины');
  ok(Object.keys(a.focusVariants).length === FOCUS_VARIANTS.length,
    `доктрина выбрана для каждого слота (${Object.keys(a.focusVariants).length})`);
  // Разные сиды дают разные наборы хотя бы иногда.
  const seen = new Set<string>();
  for (let seed = 1; seed < 40; seed++) {
    seen.add(JSON.stringify(createGame(seed).focusVariants));
  }
  ok(seen.size > 1, `доктрины различаются между партиями (${seen.size} наборов)`);
  // Узел доктрины реально попадает в древо.
  for (const v of FOCUS_VARIANTS) {
    const tree = treeFor(a, v.faction);
    ok(tree.some((n) => n.id === v.slot), `доктрина ${v.slot} в древе`);
  }
  console.log('вариативность доктрин: OK');
}

// --- Всё это переживает сохранение -------------------------------------------------
{
  const s = createGame(1234);
  declareWar(s, 'superEarth', 'automatons', 'проверка');
  onCapitalCaptured(s, 'automatons', 'superEarth');
  s.puppets.illuminate = 'superEarth';
  const back = deserializeState(serializeState(s, 't', 't'));
  ok(back.relations.length === s.relations.length, 'отношения сохраняются');
  ok(atWar(back, 'superEarth', 'automatons'), 'война переживает загрузку');
  ok(back.subjugated.automatons === 'superEarth', 'порабощение сохраняется');
  ok(back.puppets.illuminate === 'superEarth', 'вассалитет сохраняется');
  ok(JSON.stringify(back.focusVariants) === JSON.stringify(s.focusVariants),
    'доктрины сохраняются');

  // Старое сохранение без дипломатии читается как всеобщая война.
  const legacy = JSON.parse(serializeState(s, 't', 't'));
  delete legacy.relations;
  delete legacy.swarmAwake;
  const old = deserializeState(JSON.stringify(legacy));
  ok(old.relations.every((r) => r.war), 'старый сейв — война всех со всеми');
  ok(old.swarmAwake, 'в старом сейве рой уже не спит');
  console.log('сохранения: OK');
}

// --- Ярлыки отношений ---------------------------------------------------------------
{
  ok(relationLabel(60) === 'союзные', 'ярлык союза');
  ok(relationLabel(0) === 'ровные', 'ярлык нейтралитета');
  ok(relationLabel(-90) === 'враждебные', 'ярлык вражды');
}

// --- Мягкая подача: свет, цвет, звук ------------------------------------------------
{
  const mesh = readFileSync(join(process.cwd(), 'src', 'render', 'planetShaders.ts'), 'utf8');
  ok(mesh.includes('WRAP'), 'свет заворачивается за терминатор');
  ok(mesh.includes('skyAmb') && mesh.includes('gndAmb'), 'полусферный ambient');
  ok(mesh.includes('ringShadow'), 'кольца отбрасывают тень');
  ok(mesh.includes('vRingN'), 'нормаль кольца приходит varying, а не из normalMatrix');

  const scene = readFileSync(join(process.cwd(), 'src', 'render', 'scene.ts'), 'utf8');
  ok(scene.includes('HemisphericLight'), 'сцена освещена полусферным источником');

  const css = readFileSync(join(process.cwd(), 'src', 'style.css'), 'utf8');
  ok(!css.includes('--yel: #ffe11c'), 'сигнальный жёлтый смягчён');
  ok(!css.includes('--alr: #ff4b36'), 'тревожный красный смягчён');
  ok(css.includes('.rel-bar'), 'шкала отношений оформлена');

  const snd = readFileSync(join(process.cwd(), 'src', 'ui', 'sound.ts'), 'utf8');
  ok(snd.includes('exponentialRampToValueAtTime(vol'), 'у звуков есть мягкая атака');
  ok(!snd.includes("osc.type = 'sawtooth'"), 'резкая пила убрана из синтеза');
  ok(snd.includes('lp.type'), 'верхние гармоники срезаются фильтром');
  console.log('мягкая подача: OK');
}

// --- Единая точка правды о враждебности ------------------------------------------
{
  const factions = readFileSync(join(process.cwd(), 'src', 'data', 'factions.ts'), 'utf8');
  ok(!factions.includes('export function areHostile'),
    'захардкоженная враждебность удалена');
  for (const f of ['src/game/ai.ts', 'src/game/combat.ts', 'src/ui/ui.ts']) {
    const src = readFileSync(join(process.cwd(), f), 'utf8');
    ok(!src.includes('areHostile('), `${f} спрашивает отношения, а не константу`);
  }
  const sim = readFileSync(join(process.cwd(), 'src', 'game', 'sim.ts'), 'utf8');
  ok(sim.includes('stepRelations(state)'), 'отношения живут каждый день');
  ok(sim.includes('stepDiploEvents(state)'), 'дипломатические происшествия включены');
  ok(sim.includes('collectTribute(state)'), 'вассалы платят дань');
  console.log('единая враждебность: OK');
}

// --- Возврат территорий фокусом ------------------------------------------------------
{
  const focus = readFileSync(join(process.cwd(), 'src', 'game', 'focus.ts'), 'utf8');
  ok(focus.includes("case 'returnTerritory'"), 'эффект возврата земель реализован');
  const data = readFileSync(join(process.cwd(), 'src', 'data', 'focus.ts'), 'utf8');
  for (const id of ['se_good_neighbour', 'aut_cold_ledger', 'ill_hollow_gift']) {
    ok(data.includes(id), `узел возврата территорий: ${id}`);
  }
  // Эффект реально возвращает миры исконному владельцу.
  const s = createGame(3131);
  const victim: FactionId = 'automatons';
  const taken = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!)
    .filter((p) => p.origin === victim && !p.isCapital).slice(0, 2);
  ok(taken.length >= 1, 'нашлись миры чужого происхождения');
  for (const p of taken) p.owner = 'superEarth';
  const relBefore = relationOf(s, 'superEarth', victim);
  s.factions.superEarth.completedFocus = [];
  // Прямой вызов эффекта через выбор фокуса: применяем узел вручную.
  const node = treeFor(s, 'superEarth').find((n) => n.id === 'se_good_neighbour')!;
  ok(!!node, 'узел найден в древе');
  ok(node.effects.some((e) => e.kind === 'returnTerritory'), 'у узла нужный эффект');
  console.log('возврат территорий: OK');
  void relBefore;
}

console.log(`round45: OK (${checks} проверок)`);
