// Раунд 55: древо фокусов перерисовано схемой (ортогональные связи, щитки,
// трассировка ветки), в главном меню появились титры.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDITS } from '../src/data/credits';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}
const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');

// --- Состав титров ------------------------------------------------------------
{
  const flat = JSON.stringify(CREDITS);
  ok(CREDITS.length >= 5, `в титрах несколько разделов (${CREDITS.length})`);

  // Генеральный разработчик — HINOMA, и он один.
  const chief = CREDITS.find((b) => /Генеральный разработчик/i.test(b.title ?? ''));
  ok(!!chief, 'раздел генерального разработчика есть');
  ok(chief!.roles?.[0]?.names.includes('HINOMA') === true, 'генеральный разработчик — HINOMA');
  ok(!flat.includes('"HINOMA"') || flat.split('"HINOMA"').length === 2, 'HINOMA назван ровно один раз');

  // Под каждым элементом разработки — Claude.
  const dev = CREDITS.find((b) => /^Разработка$/i.test(b.title ?? ''));
  ok(!!dev, 'раздел разработки есть');
  ok((dev!.roles?.length ?? 0) >= 10, `разделов работ достаточно (${dev!.roles?.length})`);
  for (const r of dev!.roles ?? []) {
    ok(r.names.includes('Claude'), `под «${r.role}» стоит Claude`);
    ok(r.role.length > 0, 'у элемента разработки есть название');
  }

  // Отдельная благодарность.
  const thanks = CREDITS.find((b) => /благодарность/i.test(b.title ?? ''));
  ok(!!thanks, 'раздел благодарности есть');
  ok(JSON.stringify(thanks).includes('Сыну степей'), 'благодарность — Сыну степей');

  // Ключевые области разработки перечислены поимённо.
  for (const area of ['Гейм-дизайн', 'Сетевая игра', 'Звук', 'Баланс']) {
    ok(flat.includes(area), `в титрах упомянуто: ${area}`);
  }
  console.log('состав титров: OK');
}

// --- Как титры устроены -------------------------------------------------------
{
  const src = read('src', 'ui', 'credits.ts');
  ok(read('src', 'data', 'credits.ts').includes('export const CREDITS'),
    'состав титров лежит отдельно от показа');
  ok(src.includes('logoBlock'), 'в начале ленты — логотип из главного меню');
  ok(/SCROLL_SPEED/.test(src), 'скорость ленты задана, а не жёсткая длительность');
  ok(/FADE_MS/.test(src), 'есть затухание экрана');
  ok(src.includes("classList.add('fading')") && src.includes("classList.remove('fading')"),
    'экран гаснет и на входе, и на выходе');
  ok(/addEventListener\('keydown'/.test(src) && /addEventListener\('click'/.test(src),
    'титры прерываются клавишей и щелчком');
  ok(src.includes('removeEventListener'), 'обработчики снимаются — утечки нет');

  const css = read('src', 'style.css');
  ok(css.includes('@keyframes cr-roll'), 'анимация прокрутки описана');
  ok(/from \{ transform: translateY\(100vh\)/.test(css), 'лента стартует снизу экрана');
  ok(/to \{ transform: translateY\(-100%\)/.test(css), 'и уезжает вверх');
  ok(/#credits \{[^}]*background: #050505/.test(css), 'фон титров — чёрный');

  const menu = read('src', 'ui', 'mainMenu.ts');
  ok(menu.includes("'ТИТРЫ'"), 'кнопка титров есть в главном меню');
  ok(menu.includes("to === 'credits'"), 'кнопка титры запускает');
  ok(menu.includes('playCredits'), 'меню вызывает проигрыватель титров');
  console.log('устройство титров: OK');
}

// --- Схема древа фокусов ------------------------------------------------------
{
  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes('private elbow('), 'связи строятся ортогональным перегибом');
  ok(!/C\$\{x1\},\$\{\(y1 \+ y2\) \/ 2\}/.test(ui), 'кривых Безье в связях больше нет');
  ok(ui.includes('fx-link'), 'у линий связи свой класс');
  ok(ui.includes("cls += ' far'") || ui.includes('far ? '), 'дальние требования помечаются отдельно');
  ok(ui.includes('private highlightChain('), 'есть трассировка ветки под курсором');
  ok(ui.includes("addEventListener('mouseenter'"), 'трассировка включается наведением');
  ok(ui.includes('fn-plate'), 'иконка узла сидит в щитке');
  ok(ui.includes('fn-bar'), 'у идущего фокуса есть полоса хода');
  ok(ui.includes("cls += ' root'"), 'корни веток выделены');

  // Дальние требования теперь рисуются, а не исчезают: раньше isRemoteRequire
  // просто пропускал связь, и узел висел в воздухе.
  const focusFn = ui.slice(ui.indexOf('private renderFocus()'), ui.indexOf('private highlightChain('));
  ok(!/if \(this\.isRemoteRequire\(n, r\)\) continue;/.test(focusFn),
    'дальняя связь больше не выбрасывается из отрисовки');
  ok(/const far = this\.isRemoteRequire/.test(focusFn), 'она рисуется пунктиром');

  const css = read('src', 'style.css');
  for (const rule of ['.fn-plate', '.fn-name', '.fn-bar', '.fx-link', '.fx-link.far',
    '.focus-canvas.tracing', '.focus-node.root']) {
    ok(css.includes(rule), `стиль описан: ${rule}`);
  }
  ok(/\.fx-link\.far \{[^}]*stroke-dasharray/.test(css), 'дальняя связь — пунктиром');
  ok(/#focus-overlay \{[^}]*rgba\(5, 5, 4, 0\.98/.test(css), 'оверлей не просвечивает картой');
  ok(!/\.focus-node \{[^}]*background: transparent/.test(css), 'старый плоский узел убран');
  console.log('схема древа: OK');
}

// --- Ортогональная геометрия --------------------------------------------------
{
  // elbow приватен, поэтому проверяем его форму по исходнику: путь обязан
  // состоять только из вертикалей, горизонталей и скруглений на углах —
  // никаких косых линий, иначе схема перестаёт быть схемой.
  const ui = read('src', 'ui', 'ui.ts');
  const body = ui.slice(ui.indexOf('private elbow('), ui.indexOf('private renderFocus()'));
  ok(body.includes('`M${x1},${y1}`'), 'путь начинается в родителе');
  ok(body.includes('`L${x2},${y2}`'), 'и заканчивается в потомке');
  ok((body.match(/Q\$\{/g) ?? []).length === 2, 'ровно два скруглённых угла');
  ok(body.includes('busY'), 'горизонтальный перегон идёт по шине ряда');
  ok(!/ L\$\{x1 \+ /.test(body.replace(/\$\{x1 \+ dir \* R\}/g, '')), 'косых участков в пути нет');
  console.log('геометрия связей: OK');
}

console.log(`round55: OK (${checks} проверок)`);
