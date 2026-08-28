// Раунд 58: аудит и исправления, делёж наследства побеждённой фракции,
// случайные события, детализация корпусов и широкое окно политики.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, fleetCap, planetsOf, spawnFleet } from '../src/game/state';
import { advanceDay } from '../src/game/sim';
import { generateGalaxy } from '../src/game/galaxy';
import { mergeFleets, splitFleet, disbandFleet } from '../src/game/units';
import { applyCommand } from '../src/net/commands';
import { addWarScore, confirmPartition, openPartition, planPartition, settlePartition, warScoreOf } from '../src/game/partition';
import { canBuyBonus, buyBonus } from '../src/game/politics';
import { seDefence, seDoctrine, SE_DOCTRINE_DEFENCE, SE_MASS_HULLS, SE_MASS_TROOPS } from '../src/game/combat';
import { EVENT_GAP } from '../src/game/events';
import { TIMELINE_EVENTS } from '../src/data/events';
import { FACTION_IDS } from '../src/data/factions';
import { recomputeSupply } from '../src/game/supply';
import { atWar, declareWar } from '../src/game/relations';
import { FOCUS_VARIANTS } from '../src/game/trophies';
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

// --- Делёж наследства побеждённой фракции ---------------------------------------
{
  const s = createGame(777, 'superEarth');
  // Три года войны: автоматоны сделали втрое больше СЗ, иллюминаты — ничего.
  addWarScore(s, 'automatons', 'terminids', 300);
  addWarScore(s, 'superEarth', 'terminids', 100);
  ok(warScoreOf(s, 'automatons', 'terminids') === 300, 'очки войны копятся по парам');
  ok(warScoreOf(s, 'terminids', 'automatons') === 0, 'счёт односторонний: это заслуги ПРОТИВ фракции');
  addWarScore(s, 'automatons', 'automatons', 50);
  ok(warScoreOf(s, 'automatons', 'automatons') === 0, 'сама против себя фракция очков не копит');

  const before = planetsOf(s, 'terminids').length;
  const plan = planPartition(s, 'terminids', 'automatons');
  const sum = plan.shares.reduce((a, x) => a + x.planets.length, 0);
  ok(sum === before && sum === plan.spoils.length, `роздано ровно всё наследство (${sum} из ${before})`);
  const aut = plan.shares.find((x) => x.faction === 'automatons')!;
  const se = plan.shares.find((x) => x.faction === 'superEarth')!;
  ok(aut.planets.length > se.planets.length, 'кто больше воевал — тому больше миров');
  ok(Math.abs(aut.share - 0.75) < 0.01, `доля считается по очкам (${aut.share.toFixed(2)})`);
  // Столица достаётся добившему: её штурм и есть конец войны.
  const cap = planetsOf(s, 'terminids').find((p) => p.isCapital);
  if (cap) ok(plan.spoils.find((x) => x.planet === cap.id)?.to === 'automatons', 'столица — добившему');

  // Раздел останавливает время и держит его до подтверждения.
  s.speed = 2;
  ok(openPartition(s, 'terminids', 'automatons'), 'раздел открылся');
  ok(s.speed === 0, 'партия встала на паузу');
  const day0 = s.day;
  advanceDay(s);
  ok(s.day === day0, 'день не идёт, пока делят');
  ok(applyCommand(s, 'superEarth', { k: 'setSpeed', speed: 3 }) === false,
    'снять паузу кнопкой скорости нельзя');
  ok(!s.partition!.confirmed.includes('superEarth'), 'от человека ждут согласия');
  ok(s.partition!.confirmed.includes('automatons'), 'ИИ согласен сразу');
  ok(applyCommand(s, 'superEarth', { k: 'confirmPartition' }), 'согласие принимается приказом');
  ok(s.partition === null, 'раздел закрыт');
  ok(s.speed === 2, 'скорость вернулась к прежней');
  ok(planetsOf(s, 'terminids').length === 0, 'у побеждённого не осталось миров');
  advanceDay(s);
  ok(s.day === day0 + 1, 'время пошло дальше');
  console.log('делёж наследства: OK');
}

// --- Никто не воевал: делят поровну, а не бросают ---------------------------------
{
  const s = createGame(31, 'superEarth');
  const plan = planPartition(s, 'illuminate', null);
  const nonZero = plan.shares.filter((x) => x.planets.length > 0).length;
  ok(nonZero >= 2, 'без очков наследство расходится между живыми, а не одному');
  console.log('раздел без очков войны: OK');
}

// --- Транспорты не исчезают при работе с соединениями -----------------------------
{
  const s = createGame(52, 'superEarth');
  const home = planetsOf(s, 'superEarth')[0]!;
  const a = spawnFleet(s, 'superEarth', home.id, { ships: 6, infantry: 36, transports: 3 });
  const b = spawnFleet(s, 'superEarth', home.id, { ships: 6, infantry: 36, transports: 3 });
  mergeFleets(s, a, [b]);
  ok((a.transports ?? 0) === 6, `слияние переносит аппарели (${a.transports})`);
  ok(a.infantry === 72, 'вместе с десантом, который на них ехал');

  const half = splitFleet(s, a)!;
  ok((half.transports ?? 0) === 3 && (a.transports ?? 0) === 3,
    `разделение делит аппарели поровну (${a.transports} / ${half.transports})`);

  const yard = planetsOf(s, 'superEarth').find((p) => p.shipyard)!;
  const c = spawnFleet(s, 'superEarth', yard.id, { ships: 2, infantry: 12, transports: 2 });
  const stored = yard.shipyard!.stored.transports ?? 0;
  disbandFleet(s, c);
  ok((yard.shipyard!.stored.transports ?? 0) === stored + 2, 'роспуск кладёт аппарели на склад');
  console.log('аппарели не пропадают: OK');
}

// --- Оборонительная доктрина непрерывна, но со своей кривой -----------------------
{
  // На самом пороге оборона обязана быть В ПОЛНУЮ силу: порог и есть «мир
  // прикрыт как положено». Общая с атакой кривая давала здесь лишь 1,53.
  const atThreshold = seDefence('superEarth', SE_MASS_HULLS, SE_MASS_TROOPS, SE_DOCTRINE_DEFENCE);
  ok(Math.abs(atThreshold - SE_DOCTRINE_DEFENCE) < 0.01,
    `на пороге оборона в полную силу (${atThreshold.toFixed(2)})`);
  // И никаких обрывов: чуть ниже порога — чуть слабее, а не вдвое.
  const bit = seDefence('superEarth', SE_MASS_HULLS * 0.95, SE_MASS_TROOPS * 0.95, SE_DOCTRINE_DEFENCE);
  ok(bit > 1 && bit < atThreshold && atThreshold - bit < 0.35,
    `у обороны нет ступеньки (${bit.toFixed(2)} против ${atThreshold.toFixed(2)})`);
  ok(seDefence('automatons', 999, 999, SE_DOCTRINE_DEFENCE) === 1, 'доктрина только у Супер-Земли');
  // Атакующая кривая осталась своей: полная сила при полуторном перекрытии.
  ok(seDoctrine('superEarth', SE_MASS_HULLS, SE_MASS_TROOPS, 2.2) < 2.0,
    'у атаки порог — не полная сила');

  const combat = read('src', 'game', 'combat.ts');
  ok(combat.includes('const step = (ratio - 0.5) * 22'),
    'множители штурма применяются отдельно от отката');
  ok(combat.includes('const inBattle = landableInfantry(f)'),
    'потери несёт только высаженная пехота');
  ok(combat.includes('const boots ='), 'взятие мира требует наземных сил');
  ok(combat.includes('const canLand ='), 'битва не заводится без десанта');
  console.log('исправления боёв: OK');
}

// --- Пустой флот не заводит вечную ложную тревогу ---------------------------------
{
  const s = createGame(61, 'superEarth');
  const target = planetsOf(s, 'automatons')[0]!;
  spawnFleet(s, 'superEarth', target.id, { ships: 5, infantry: 0, transports: 0 });
  for (let i = 0; i < 30; i++) advanceDay(s);
  ok(!target.battle, 'флот без десанта не начинает битву');
  console.log('пустой флот не воюет: OK');
}

// --- События стали случайными ------------------------------------------------------
{
  const dated = TIMELINE_EVENTS.filter((e) => e.day !== undefined && !e.capture);
  ok(dated.length >= 40, `пул случайных событий большой (${dated.length})`);
  const ev = read('src', 'game', 'events.ts');
  ok(ev.includes('state.rng.next()'), 'выбор идёт из сида партии, а не из Math.random');
  ok(!ev.includes('Math.random()'), 'вызовов Math.random в событиях нет — иначе хост и клиент разойдутся');
  ok(EVENT_GAP >= 10, 'между случайными событиями есть пауза');

  // Один и тот же сид даёт одну и ту же цепочку, разные — разные.
  const run = (seed: number): string => {
    const s = createGame(seed, 'superEarth');
    for (let i = 0; i < 900; i++) advanceDay(s);
    return s.firedEvents.join(',');
  };
  const a1 = run(4242);
  const a2 = run(4242);
  const b1 = run(9999);
  ok(a1 === a2, 'один сид — одна и та же цепочка событий');
  ok(a1 !== b1, 'разные сиды — разные партии');
  ok(a1.length > 0, 'события вообще случаются');
  console.log('случайные события: OK');
}

// --- Генерация: планеты не слипаются в луч ------------------------------------------
{
  // Кламп угла шёл по нормированному значению против ненормированных границ, и
  // у форм с закруткой целые бакеты садились на одну кромку сектора.
  const gal = read('src', 'game', 'galaxy.ts');
  ok(gal.includes('Math.min(a1 - aPad, angle)'), 'клампится сам угол, а не его нормированная копия');
  for (const shape of ['spiral', 'clusters'] as const) {
    const g = generateGalaxy(7, shape);
    const ps = g.order.map((id) => g.planets.get(id)!);
    let tight = 0;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        if (Math.hypot(ps[i]!.pos.x - ps[j]!.pos.x, ps[i]!.pos.y - ps[j]!.pos.y) < 20) tight++;
      }
    }
    ok(tight < 25, `${shape}: планеты не стоят вплотную (${tight} пар)`);
  }
  console.log('генерация без слипания: OK');
}

// --- Стартовые флоты не садятся все на один мир --------------------------------------
{
  for (const seed of [3, 17, 45, 88]) {
    const s = createGame(seed, 'superEarth');
    for (const f of FACTION_IDS) {
      const at = new Set([...s.fleets.values()].filter((fl) => fl.faction === f).map((fl) => fl.at));
      const worlds = planetsOf(s, f).length;
      ok(at.size > 1 || worlds < 2, `сид ${seed}, ${f}: флот не собран в одной точке (${at.size} мест)`);
    }
  }
  console.log('стартовое размещение флотов: OK');
}

// --- Потолок флота растёт с державой -------------------------------------------------
{
  const s = createGame(5, 'superEarth');
  const seCap = fleetCap(s, 'superEarth');
  const autCap = fleetCap(s, 'automatons');
  ok(seCap > autCap, `у гегемона потолок выше (${seCap} против ${autCap})`);
  ok(seCap >= 12, `сто с лишним миров дают заметный флот (${seCap})`);
  // Потеря территории сжимает и флот: это следствие размера державы.
  for (const p of planetsOf(s, 'superEarth').slice(0, 120)) p.owner = 'automatons';
  ok(fleetCap(s, 'superEarth') < seCap, 'потеряв миры, гегемон теряет и потолок флота');
  console.log('потолок флота: OK');
}

// --- Бонус, который ничего не изменит, не продаётся ------------------------------------
{
  const s = createGame(9, 'superEarth');
  const fs = s.factions.superEarth;
  fs.politicalPower = 500;
  fs.warSupport = 100;
  ok(!canBuyBonus(s, 'superEarth', 'propaganda'), 'пропаганда на потолке поддержки недоступна');
  ok(!buyBonus(s, 'superEarth', 'propaganda'), 'и не покупается в обход');
  ok(fs.politicalPower === 500, 'ПВ не списалась впустую');
  fs.warSupport = 80;
  ok(canBuyBonus(s, 'superEarth', 'propaganda'), 'а ниже потолка — доступна');
  console.log('бесполезная покупка закрыта: OK');
}

// --- Корпуса детализированы и интерфейс политики широкий -------------------------------
{
  const hull = read('src', 'render', 'hullShader.ts');
  for (const part of ['float seam(', 'float fbm3(', 'uPanel', 'uWear', 'uOrganic']) {
    ok(hull.includes(part), `у корпусов процедурная обшивка: ${part}`);
  }
  const ships = read('src', 'render', 'shipAssets.ts');
  ok(ships.includes("'hull'") && ships.includes('hullMaterial('), 'флот использует шейдер корпуса');
  const mesh = read('src', 'render', 'planetMesh.ts');
  ok(mesh.includes('structureMaterial('), 'планетарные сооружения — тем же шейдером');
  ok(mesh.includes('yardGrp'), 'верфь видна на орбите');
  ok(mesh.includes('setYard('), 'и переключается из сцены');
  const scene = read('src', 'render', 'scene.ts');
  ok(scene.includes('vis.setYard('), 'сцена показывает верфи');
  ok(mesh.includes('SPHERE_LOD') && mesh.includes('setDetail('), 'у сферы есть уровни детализации');
  const sh = read('src', 'render', 'planetShaders.ts');
  ok(sh.includes('float hgt ='), 'рельеф уходит в свет, а не только в цвет');
  ok(sh.includes('dFdx(hgt)'), 'нормаль разворачивается по градиенту высоты');

  const css = read('src', 'style.css');
  ok(css.includes('.dossier-cols'), 'досье разложено в колонки');
  ok(/#dossier\s*\{[^}]*width:\s*min\(76rem/.test(css), 'окно политики широкое');
  ok(css.includes('#partition'), 'у раздела наследства есть своё окно');
  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes('renderPartition('), 'интерфейс рисует раздел');
  ok(ui.includes("k: 'confirmPartition'"), 'и умеет подтверждать его приказом');
  console.log('визуал и интерфейс: OK');
}


// --- Вторая волна аудита: критические находки -----------------------------------
{
  const s = createGame(404, 'superEarth');
  // Трофейная столица не делает своего хозяина «головой чужого государства».
  const foreign = planetsOf(s, 'automatons').find((p) => p.isCapital);
  if (foreign) {
    foreign.owner = 'superEarth';                 // Киберстан взят Супер-Землёй
    recomputeSupply(s);
    const mine = planetsOf(s, 'superEarth').filter((p) => p.supplied).length;
    ok(mine > 10, `опора снабжения — своя столица, а не трофейная (снабжено ${mine})`);
  }

  // atWar симметричен в обе стороны.
  const t = createGame(405, 'superEarth');
  t.puppets = { illuminate: 'superEarth' };
  declareWar(t, 'superEarth', 'automatons', 'проверка');
  ok(atWar(t, 'illuminate', 'automatons') === atWar(t, 'automatons', 'illuminate'),
    'война марионетки читается одинаково с обеих сторон');
  // Погибший сюзерен не держит чужую войну вечно.
  t.factions.superEarth.alive = false;
  ok(!atWar(t, 'illuminate', 'automatons'), 'мёртвый сюзерен не навязывает войн');

  // Разрушенный мир не проводит снабжение.
  const sup = read('src', 'game', 'supply.ts');
  ok(sup.includes('!n.shattered'), 'обломки не мостят граф снабжения');
  ok(sup.includes("p.isCapital && p.origin === faction"), 'опорой служит своя столица');
  const cb = read('src', 'game', 'combat.ts');
  ok(cb.includes('planet.isCapital && planet.origin === prev'),
    'капитулирует хозяин своей столицы, а не всякий владелец');
  console.log('критические находки: OK');
}

// --- Шкала боевых доктрин -----------------------------------------------------------
{
  // combat — это ДОЛЯ: combatMult считает 1 + bonuses.combat. Целые числа
  // давали множитель ×9 вместо ×1.25.
  let seenCombat = 0;
  for (const v of FOCUS_VARIANTS) {
    for (const opt of v.options) {
      for (const e of opt.effects ?? []) {
        if (e.kind !== 'combat') continue;
        seenCombat++;
        ok(e.amount <= 0.5, `${v.slot}/${opt.id}: боевой бонус в шкале долей (${e.amount})`);
      }
    }
  }
  ok(seenCombat > 0, 'боевые доктрины вообще проверены');
  console.log('шкала доктрин: OK');
}

// --- Древо фокусов: никаких наложенных узлов ------------------------------------------
{
  const seen = new Map<string, string>();
  for (const [faction, nodes] of Object.entries(FOCUS_TREES)) {
    for (const n of nodes) {
      const key = `${faction}:${n.x},${n.y}`;
      ok(!seen.has(key), `${faction}: узлы ${seen.get(key) ?? ''} и ${n.id} не в одной клетке (${n.x},${n.y})`);
      seen.set(key, n.id);
    }
  }
  console.log('древо без наложений: OK');
}

// --- Сеть: снапшот везёт мир целиком, приказы проверяют правила -------------------------
{
  const snap = read('src', 'net', 'snapshot.ts');
  for (const f of ['relations', 'swarmAwake', 'subjugated', 'puppets', 'trophies', 'focusVariants']) {
    ok(snap.includes(`target.${f} = fresh.${f}`), `снапшот везёт ${f}`);
  }
  const cmds = read('src', 'net', 'commands.ts');
  ok(cmds.includes('canNegotiate(actor, c.with)'), 'мир проверяет правила переговоров');
  ok(cmds.includes('PEACE_THRESHOLD'), 'и порог симпатии');
  const ses = read('src', 'net', 'session.ts');
  ok(ses.includes("peerFaction.set(from, msg.cmd.faction)"), 'смена стороны обновляет реестр соединений');
  ok((ses.match(/settlePartition\(state\)/g) ?? []).length >= 3,
    'выход, кик и смена стороны не морозят раздел');

  // Раздел закрывается сам, когда ждать больше некого.
  const g = createGame(88, 'superEarth');
  g.humans = ['superEarth', 'illuminate'];
  openPartition(g, 'terminids', 'automatons');
  ok(!!g.partition, 'раздел открыт');
  confirmPartition(g, 'superEarth');
  ok(!!g.partition, 'ждём второго человека');
  g.humans = ['superEarth'];                       // иллюминат вышел из партии
  settlePartition(g);
  ok(g.partition === null, 'после выхода участника раздел закрывается сам');
  console.log('сетевые находки: OK');
}

console.log(`round58: OK (${checks} проверок)`);
