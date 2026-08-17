// Раунд 44: масштабируемый интерфейс, главное меню, сетевая партия,
// тонкий контур планет, предметные иконки политики и спецопераций.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, isHuman } from '../src/game/state';
import { SPEC_OPS } from '../src/game/specops';
import { bonusesFor } from '../src/game/politics';
import { serializeState, deserializeState } from '../src/game/persist';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const ROOT = process.cwd();
const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8');

// --- Масштаб интерфейса --------------------------------------------------------
{
  ok(css.includes('--ui-scale'), 'есть переменная масштаба интерфейса');
  ok(/html\s*\{\s*font-size:\s*calc\(16px \* var\(--ui-scale/.test(css),
    'корневой кегль считается от масштаба');
  // Размеры должны быть в rem, иначе ползунок ничего не двигает.
  const remCount = (css.match(/[\d.]+rem/g) ?? []).length;
  ok(remCount > 250, `размеры переведены в rem (${remCount} значений)`);
  const pxFontSizes = css.match(/font-size:\s*[\d.]+px/g) ?? [];
  ok(pxFontSizes.length === 0, `кегли не остались в px (${pxFontSizes.join(', ')})`);

  const scaleSrc = readFileSync(join(ROOT, 'src', 'ui', 'uiScale.ts'), 'utf8');
  ok(scaleSrc.includes('localStorage') || scaleSrc.includes('storage()'),
    'масштаб переживает перезапуск');
  const main = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
  ok(main.includes('applyUiScale()'), 'масштаб применяется на старте');

  const ui = readFileSync(join(ROOT, 'src', 'ui', 'ui.ts'), 'utf8');
  ok(!/font-size:\s*\d+px/.test(ui), 'инлайновые кегли в ui.ts тоже в rem');
  console.log('масштаб интерфейса: OK');
}

// --- Главное меню --------------------------------------------------------------
{
  const menu = readFileSync(join(ROOT, 'src', 'ui', 'mainMenu.ts'), 'utf8');
  for (const screen of ['rootScreen', 'factionScreen', 'loadScreen', 'settingsScreen', 'netScreen', 'lobbyScreen']) {
    ok(menu.includes(screen), `экран меню: ${screen}`);
  }
  ok(existsSync(join(ROOT, 'src', 'assets', 'menubg.webp')), 'фон меню на месте');
  const bg = readFileSync(join(ROOT, 'src', 'assets', 'menubg.webp'));
  ok(bg.length > 10_000 && bg.length < 400_000, `фон меню разумного веса (${bg.length} байт)`);
  ok(css.includes('#start-menu') && css.includes('.mm-btn'), 'стили меню на месте');
  const main = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
  ok(main.includes('new MainMenu('), 'меню — точка входа в игру');
  console.log('главное меню: OK');
}

// --- Сетевая партия ------------------------------------------------------------
{
  // Несколько людей: ИИ не должен трогать занятые фракции.
  const s = createGame(4242, 'superEarth');
  ok(isHuman(s, 'superEarth'), 'своя фракция — человек');
  ok(!isHuman(s, 'automatons'), 'чужая фракция — под ИИ');
  s.humans = ['superEarth', 'automatons'];
  ok(isHuman(s, 'automatons'), 'занятая в сети фракция — человек');

  const sim = readFileSync(join(ROOT, 'src', 'game', 'sim.ts'), 'utf8');
  ok(sim.includes('!isHuman(state, fid)) runAI'), 'ИИ не ведёт человеческие фракции');
  ok(!/fid !== state\.player/.test(sim), 'старых проверок по одному игроку не осталось');

  // Состав игроков переживает сохранение.
  const json = serializeState(s, 'test', 'test');
  const back = deserializeState(json);
  ok(JSON.stringify(back.humans) === JSON.stringify(s.humans), 'humans сохраняется');
  // Старый сейв без поля humans — ровно один игрок.
  const legacy = JSON.parse(json);
  delete legacy.humans;
  const old = deserializeState(JSON.stringify(legacy));
  ok(old.humans.length === 1 && old.humans[0] === old.player, 'старый сейв читается');

  // Слой команд и протокол на месте.
  const cmds = readFileSync(join(ROOT, 'src', 'net', 'commands.ts'), 'utf8');
  ok(cmds.includes('export function applyCommand'), 'есть применение команд');
  ok(cmds.includes('ownFleet') && cmds.includes('ownPlanet'),
    'команды проверяют принадлежность цели');
  const session = readFileSync(join(ROOT, 'src', 'net', 'session.ts'), 'utf8');
  ok(session.includes('peerFaction.get(from)'),
    'исполнитель берётся из реестра соединений, а не из сообщения');
  const snap = readFileSync(join(ROOT, 'src', 'net', 'snapshot.ts'), 'utf8');
  ok(snap.includes('serializeState'), 'снапшот переиспользует сериализатор сохранений');
  ok(!snap.includes('return fresh;'), 'снапшот мутирует состояние, а не подменяет объект');

  // Сокеты живут только в главном процессе, preload требует лишь electron.
  const preload = readFileSync(join(ROOT, 'electron', 'preload.cjs'), 'utf8');
  const requires = preload.match(/require\('([^']+)'\)/g) ?? [];
  ok(requires.length === 1 && requires[0].includes('electron'),
    `preload не тянет node-модули (${requires.join(', ')})`);
  const emain = readFileSync(join(ROOT, 'electron', 'main.cjs'), 'utf8');
  ok(emain.includes('sandbox: true'), 'песочница рендерера не ослаблена');
  ok(emain.includes('backgroundThrottling: false'),
    'свёрнутое окно хоста не тормозит симуляцию');
  console.log('сетевая партия: OK');
}

// --- Контур планет -------------------------------------------------------------
{
  const mesh = readFileSync(join(ROOT, 'src', 'render', 'planetMesh.ts'), 'utf8');
  const shell = mesh.match(/atmo\.scale\.setScalar\(baseRadius \* ([\d.]+)\)/);
  ok(!!shell && Number(shell[1]) <= 1.06,
    `атмосферная оболочка ужата (${shell?.[1]})`);
  const rims = [...mesh.matchAll(/pow\(1\.0 - clamp\(dot\(nrm, vd\), 0\.0, 1\.0\), ([\d.]+)\)/g)]
    .map((m) => Number(m[1]));
  ok(rims.length >= 2 && rims.every((p) => p >= 6),
    `кайма узкая: показатели ${rims.join(', ')}`);
  console.log('контур планет: OK');
}

// --- Иконки политики и спецопераций ---------------------------------------------
{
  const dir = join(ROOT, 'src', 'assets', 'units');
  const files = new Set(readdirSync(dir).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)));
  for (const b of bonusesFor('superEarth')) {
    ok(files.has(`pol_${b.id}`), `иконка политики ${b.id}`);
  }
  for (const op of SPEC_OPS) {
    ok(files.has(`op_${op.id}`), `иконка спецоперации ${op.id}`);
  }
  const icons = readFileSync(join(ROOT, 'src', 'render', 'unitIcons.ts'), 'utf8');
  for (const id of files) {
    ok(icons.includes(`${id}.webp`), `unitIcons знает ${id}`);
  }
  const ui = readFileSync(join(ROOT, 'src', 'ui', 'ui.ts'), 'utf8');
  ok(ui.includes('unitIcon(`pol_') && ui.includes('unitIcon(`op_'),
    'иконки подключены к строкам политики и операций');
  console.log(`иконки политики и операций: OK (${files.size} файлов всего)`);
}

console.log(`round44: OK (${checks} проверок)`);
