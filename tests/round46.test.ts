// Раунд 46: главное меню — кадр рубки фоном, логотип-растр, шесть пунктов
// и экран карьеры, который копится поверх отдельных партий.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Карьера живёт в localStorage; в node его нет — подставляем простую замену
// ДО первого вызова, иначе модуль тихо уйдёт в ветку «хранилища нет».
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

import { createGame } from '../src/game/state';
import {
  careerFinish, careerLines, careerPeace, careerRank, careerStart, careerSync,
  loadCareer, resetCareer,
} from '../src/game/career';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');

// --- Пустая карьера ------------------------------------------------------------
{
  resetCareer();
  const c = loadCareer();
  ok(c.campaigns === 0 && c.wins === 0 && c.losses === 0, 'чистая карьера пуста');
  ok(Array.isArray(c.wonAs) && c.wonAs.length === 0, 'список победных фракций пуст');
  ok(careerRank(c).title === 'Рекрут', 'без побед звание рекрутское');
  ok(careerRank(c).next !== null, 'у рекрута есть следующее звание');
  console.log('пустая карьера: OK');
}

// --- Счётчики кампаний и фракций -----------------------------------------------
{
  resetCareer();
  careerStart('superEarth');
  careerStart('superEarth');
  careerStart('automatons');
  const c = loadCareer();
  ok(c.campaigns === 3, `три начатые кампании (${c.campaigns})`);
  ok(c.byFaction.superEarth === 2, 'две партии за Супер-Землю');
  ok(c.byFaction.automatons === 1, 'одна за автоматонов');
  console.log('счётчики кампаний: OK');
}

// --- Рекорды подтягиваются из партии --------------------------------------------
{
  resetCareer();
  const s = createGame(4646, 'superEarth');
  s.day = 240;
  careerSync(s);
  const c = loadCareer();
  ok(c.longestWar === 240, `самая долгая кампания записана (${c.longestWar})`);
  ok(c.bestWorlds > 0, 'рекорд подконтрольных миров больше нуля');

  // Рекорд только растёт: короткая партия его не сбивает.
  const short = createGame(11, 'superEarth');
  short.day = 12;
  careerSync(short);
  ok(loadCareer().longestWar === 240, 'короткая партия не затирает рекорд');
  console.log('рекорды партии: OK');
}

// --- Итоги партий и звания -------------------------------------------------------
{
  resetCareer();
  const s = createGame(777, 'automatons');
  s.day = 100;
  careerFinish(s, true);
  let c = loadCareer();
  ok(c.wins === 1 && c.losses === 0, 'победа зачтена');
  ok(c.days === 100, 'прожитые дни накопились');
  ok(c.wonAs.includes('automatons'), 'фракция победы записана');
  ok(careerRank(c).title === 'Десантник', `звание за одну победу (${careerRank(c).title})`);

  careerFinish(s, false);
  c = loadCareer();
  ok(c.losses === 1, 'поражение зачтено');
  ok(c.days === 200, 'дни складываются за обе партии');

  // Повторная победа за ту же сторону не дублирует запись.
  careerFinish(s, true);
  ok(loadCareer().wonAs.filter((f) => f === 'automatons').length === 1, 'фракция не дублируется');

  careerPeace();
  ok(loadCareer().peaces === 1, 'подписанный мир учтён');

  // Верхнее звание не ломается на отсутствии следующего.
  const top = { ...loadCareer(), wins: 40 };
  ok(careerRank(top).title === 'Легенда Супер-Земли', 'потолок званий достижим');
  ok(careerRank(top).next === null, 'выше потолка следующего звания нет');
  console.log('итоги партий и звания: OK');
}

// --- Витрина карьеры -------------------------------------------------------------
{
  const lines = careerLines(loadCareer());
  ok(lines.length >= 9, `витрина заполнена (${lines.length} строк)`);
  ok(lines.every(([k, v]) => typeof k === 'string' && typeof v === 'string' && k && v),
    'все строки витрины непустые');
  console.log('витрина карьеры: OK');
}

// --- Обнуление -------------------------------------------------------------------
{
  resetCareer();
  const c = loadCareer();
  ok(c.campaigns === 0 && c.wins === 0 && c.days === 0, 'обнуление стирает всё');
  console.log('обнуление карьеры: OK');
}

// --- Симуляция дёргает карьеру ----------------------------------------------------
{
  const sim = read('src', 'game', 'sim.ts');
  ok(sim.includes('careerSync(state)'), 'рекорды подтягиваются по ходу партии');
  ok(sim.includes('careerFinish(state, false)'), 'поражение игрока уходит в карьеру');
  ok(sim.includes('careerFinish(state, state.winner === state.player)'), 'победа уходит в карьеру');
  const rel = read('src', 'game', 'relations.ts');
  ok(rel.includes('careerPeace()'), 'подписанный мир уходит в карьеру');
  const main = read('src', 'main.ts');
  ok((main.match(/careerStart\(faction\)/g) ?? []).length === 3,
    'карьера стартует на всех входах: одиночная, хост, подключение');
  console.log('подключение карьеры: OK');
}

// --- Главное меню: состав и порядок пунктов ---------------------------------------
{
  const menu = read('src', 'ui', 'mainMenu.ts');
  const order = ['continue', 'new', 'load', 'career', 'settings', 'quit'];
  let at = -1;
  for (const id of order) {
    const idx = menu.indexOf(`'${id}', '`);
    ok(idx > at, `пункт «${id}» на своём месте`);
    at = idx;
  }
  for (const label of ['ПРОДОЛЖИТЬ', 'НАЧАТЬ НОВУЮ ИГРУ', 'ЗАГРУЗИТЬ', 'КАРЬЕРА', 'НАСТРОЙКИ', 'ВЫЙТИ']) {
    ok(menu.includes(label), `надпись кнопки: ${label}`);
  }
  ok(menu.includes('window.close()'), 'выход закрывает окно');
  ok(menu.includes("this.screen === 'career'"), 'экран карьеры включён в роутер');
  ok(menu.includes('mm-career-reset'), 'кнопка обнуления карьеры на экране');
  // Недоступные пункты гасятся, а не пропадают — порядок кнопок заучивается.
  ok(menu.includes("mm-btn ${on ? '' : 'off'}"), 'недоступный пункт гасится классом off');
  ok(menu.includes('disabled'), 'недоступный пункт не кликается');
  // Сеть уехала из корня в настройки: корневых пунктов ровно шесть.
  const root = menu.slice(menu.indexOf('rootScreen'), menu.indexOf('careerScreen'));
  ok(!root.includes("'net'"), 'сетевая партия убрана из корневого меню');
  ok(menu.includes("data-go=\"net\""), 'вход в сеть остался в настройках');
  console.log('состав главного меню: OK');
}

// --- Логотип и фон ----------------------------------------------------------------
{
  const logo = read('src', 'ui', 'logo.ts');
  ok(logo.includes("assets/menulogo.webp?url"), 'логотип берётся из ассета сборкой');
  ok(logo.includes('class="logo-mark"'), 'у знака свой класс для размера и тени');
  ok(!logo.includes('<svg'), 'векторная заглушка убрана');

  const css = read('src', 'style.css');
  ok(css.includes("url('./assets/menubg.webp')"), 'фон меню — кадр рубки');
  // Стартовый экран и меню паузы больше не делят один id: раньше стили паузы
  // центрировали стартовый блок и закрашивали кадр своей заливкой.
  const menu = read('src', 'ui', 'mainMenu.ts');
  ok(menu.includes("this.root.id = 'start-menu'"),
    'у стартового меню свой идентификатор');
  ok(read('src', 'ui', 'ui.ts').includes("menuEl.id = 'main-menu'"),
    'меню паузы осталось на своём id');
  ok(css.includes('#start-menu {'), 'стили стартового экрана привязаны к новому id');
  ok(css.includes('.mm-inner.sub'), 'на вложенных экранах знак ужимается');
  // Подпись внизу слева убрана: экран держат логотип и кнопки.
  ok(!menu.includes('mm-foot'), 'подписи под меню нет в разметке');
  ok(!css.includes('.mm-foot'), 'её стиль тоже убран');
  // Колонка прижата к левому краю — там же, где самая тёмная часть кадра.
  const inner = css.slice(css.indexOf('.mm-inner {'), css.indexOf('.mm-inner > *'));
  const pad = /padding:\s*([\d.]+)rem\s+([\d.]+)rem\s+([\d.]+)rem\s+([\d.]+)rem/.exec(inner);
  ok(!!pad && Number(pad[4]) < 2, `левый отступ узкий (${pad?.[4]}rem)`);
  // Разметка и стили не должны разъезжаться: каждый класс из меню описан.
  for (const cls of ['.logo-mark', '.mm-btn-idx', '.mm-btn-text', '.mm-btn-arrow', '.mm-btn.off',
                     '.mm-rank', '.mm-rank-title', '.mm-rank-next', '.mm-stats', '.mm-stat',
                     '.mm-row', '.mm-back.danger', '.mm-panel.wide']) {
    ok(css.includes(cls), `стиль описан: ${cls}`);
  }
  // Левая треть затемняется под интерфейс, правая остаётся видимой.
  const veil = css.slice(css.indexOf('.mm-veil'), css.indexOf('.mm-inner'));
  ok(veil.includes('linear-gradient(90deg'), 'вуаль гасит кадр по горизонтали');
  ok(/rgba\(3,4,6,0\.9\d\) 0%/.test(veil), 'у левого края вуаль почти непрозрачна');

  for (const [name, min, max] of [['menubg.webp', 60, 900], ['menulogo.webp', 30, 900]] as const) {
    const size = statSync(join(process.cwd(), 'src', 'assets', name)).size / 1024;
    ok(size > min && size < max, `${name}: разумный вес (${size.toFixed(0)} КБ)`);
  }
  console.log('логотип и фон: OK');
}

// --- Репозиторий не тащит мёртвые генераторы ----------------------------------------
{
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  ok(pkg.scripts['assets:menubg']?.includes('tools/images/enhance.py'),
    'фон собирается новым конвейером');
  ok(!!pkg.scripts['assets:menulogo'], 'у логотипа свой скрипт подготовки');
  ok(!Object.values(pkg.scripts).some((s) => s.includes('menuart.py') || s.includes('bridgeart.py')),
    'ссылок на удалённые генераторы не осталось');
  console.log('конвейер ассетов: OK');
}

console.log(`round46: OK (${checks} проверок)`);
