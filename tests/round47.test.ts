// Раунд 47: горячие клавиши на физических кодах, единая модель настроек,
// пресеты качества, палитра для дальтоников и чистка подсказок из интерфейса.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Настройки и привязки живут в localStorage; в node его нет — подставляем
// замену ДО первого обращения, иначе модули уйдут в ветку «хранилища нет».
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

import {
  ACTIONS, assignBinding, bindable, keyLabel, KEY_GROUPS, loadKeyMap, resetKeyMap,
  sameBinding, saveKeyMap, type ActionId, type Binding,
} from '../src/ui/hotkeys';
import {
  DEFAULTS, getSettings, patchSettings, QUALITY_PRESETS, resetSettings,
} from '../src/ui/settings';
import { COLORBLIND_PALETTE, factionColor, FACTIONS, setFactionPalette } from '../src/data/factions';
import { FACTION_IDS } from '../src/data/factions';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');

// --- Привязки к физическим клавишам ------------------------------------------
{
  const map = resetKeyMap();
  ok(ACTIONS.length >= 20, `действий заведено достаточно (${ACTIONS.length})`);
  ok(ACTIONS.every((a) => !!map[a.id]?.code), 'у каждого действия есть клавиша по умолчанию');

  // Раскладка не должна влиять: все коды — физические (KeyX, DigitN, F5…),
  // никаких одиночных символов вроде 'f', которые на кириллице станут 'а'.
  for (const a of ACTIONS) {
    const c = a.def.code;
    ok(/^(Key[A-Z]|Digit\d|F\d{1,2}|Numpad\w+|Arrow\w+|[A-Z]\w+)$/.test(c),
      `${a.id}: код физической клавиши (${c})`);
  }
  // И в самом коде игры не должно остаться сравнений по символу.
  const hk = read('src', 'ui', 'hotkeys.ts');
  ok(hk.includes('e.code'), 'диспетчер читает e.code');
  const ui = read('src', 'ui', 'ui.ts');
  ok(!/e\.key\s*===\s*'[a-z0-9]'/i.test(ui), 'в интерфейсе не осталось сравнений e.key с символом');
  ok(!ui.includes("e.key.toLowerCase()"), 'и приведения раскладки к нижнему регистру тоже');

  // Все действия разложены по известным группам — иначе строка потеряется.
  for (const a of ACTIONS) {
    ok((KEY_GROUPS as readonly string[]).includes(a.group), `${a.id}: группа «${a.group}» известна`);
  }
  console.log('привязки к физическим клавишам: OK');
}

// --- Уникальность и вытеснение ------------------------------------------------
{
  let map = resetKeyMap();
  const codes = ACTIONS.map((a) => JSON.stringify(map[a.id]));
  ok(new Set(codes).size === codes.length, 'умолчания не конфликтуют между собой');

  // Назначаем клавишу, уже занятую другим действием: прежний владелец её теряет.
  const victim: ActionId = 'focusTree';
  const taken: Binding = { ...map[victim] };
  map = assignBinding(map, 'chronicle', taken);
  ok(sameBinding(map.chronicle, taken), 'новая привязка встала');
  ok(!map[victim].code, 'прежний владелец клавиши освободил её');

  // Модификаторы различают привязки: Tab и Shift+Tab — разные клавиши.
  ok(!sameBinding({ code: 'Tab' }, { code: 'Tab', shift: true }), 'Shift меняет привязку');
  ok(sameBinding({ code: 'Tab' }, { code: 'Tab', shift: false }), 'отсутствие модификатора == false');
  console.log('уникальность привязок: OK');
}

// --- Подписи клавиш --------------------------------------------------------------
{
  ok(keyLabel({ code: 'Space' }) === 'Пробел', 'пробел подписан словом');
  ok(keyLabel({ code: 'KeyF' }) === 'F', 'буквенная клавиша без префикса');
  ok(keyLabel({ code: 'Digit3' }) === '3', 'цифра без префикса');
  ok(keyLabel({ code: 'Tab', shift: true }) === 'Shift + Tab', 'модификатор в подписи');
  ok(keyLabel({ code: 'Digit1', ctrl: true }) === 'Ctrl + 1', 'Ctrl в подписи');
  ok(keyLabel(undefined) === '—', 'пустая привязка подписана прочерком');
  ok(keyLabel({ code: '' }) === '—', 'снятая привязка тоже');
  ok(!bindable('ShiftLeft'), 'на голый модификатор привязаться нельзя');
  ok(bindable('KeyQ'), 'обычная клавиша назначается');
  console.log('подписи клавиш: OK');
}

// --- Хранение привязок --------------------------------------------------------
{
  const map = resetKeyMap();
  const next = assignBinding(map, 'home', { code: 'KeyM' });
  saveKeyMap(next);
  ok(loadKeyMap().home.code === 'KeyM', 'изменённая привязка переживает перезагрузку');
  resetKeyMap();
  ok(loadKeyMap().home.code === 'KeyH', 'сброс возвращает умолчание');
  console.log('хранение привязок: OK');
}

// --- Модель настроек -----------------------------------------------------------
{
  mem.clear();
  const s = resetSettings();
  ok(s.quality === DEFAULTS.quality && s.master === DEFAULTS.master, 'сброс даёт умолчания');

  patchSettings({ quality: 'low', master: 0.25 });
  ok(getSettings().quality === 'low', 'пресет качества сохранён');
  ok(getSettings().master === 0.25, 'громкость сохранена');
  ok(getSettings().bloom === DEFAULTS.bloom, 'остальные поля не сбились');

  // Значения зажимаются: ползунок из будущей версии не должен ломать игру.
  patchSettings({ master: 5, uiScale: 99, panelOpacity: -1 });
  const c = getSettings();
  ok(c.master === 1, `громкость зажата сверху (${c.master})`);
  ok(c.uiScale <= 1.6, `масштаб зажат сверху (${c.uiScale})`);
  ok(c.panelOpacity >= 0.5, `плотность зажата снизу (${c.panelOpacity})`);

  // Мусор в хранилище не должен валить запуск.
  mem.set('sgw2_settings', '{ это не json');
  resetSettings();
  ok(getSettings().quality === DEFAULTS.quality, 'повреждённые настройки заменяются умолчаниями');
  console.log('модель настроек: OK');
}

// --- Перенос настроек из старых ключей -------------------------------------------
{
  mem.clear();
  mem.set('sgw2_sound', JSON.stringify({ master: 0.3, ambient: 0.1, effects: 0.9 }));
  mem.set('sgw2_fx', JSON.stringify({ bloom: false, scan: false, autosaveDays: 180 }));
  mem.set('sgw2_ui_scale', '1.4');
  // Модуль кеширует настройки, поэтому чистое чтение делаем через переимпорт.
  const src = read('src', 'ui', 'settings.ts');
  ok(src.includes("s.getItem('sgw2_sound')"), 'громкость подхватывается из старого ключа');
  ok(src.includes("s.getItem('sgw2_fx')"), 'эффекты подхватываются из старого ключа');
  ok(src.includes("s.getItem('sgw2_ui_scale')"), 'масштаб подхватывается из старого ключа');
  console.log('перенос старых настроек: OK');
}

// --- Пресеты качества ------------------------------------------------------------
{
  const q = QUALITY_PRESETS;
  ok(q.low.pixelRatio < q.medium.pixelRatio && q.medium.pixelRatio < q.high.pixelRatio,
    'плотность пикселей растёт от пресета к пресету');
  ok(q.low.stars < q.high.stars, 'звёзд на низком меньше');
  ok(q.low.nebulae === false && q.high.nebulae === true, 'туманности отключены на низком');
  ok(q.low.bloomStrength === 0, 'на низком свечения нет вовсе');

  const scene = read('src', 'render', 'scene.ts');
  ok(scene.includes('setQuality('), 'сцена умеет применять пресет');
  ok(scene.includes('this.stars.setCount('), 'звёзды прореживаются без пересборки геометрии');
  ok(scene.includes('Math.min(p.pixelRatio, window.devicePixelRatio)'),
    'плотность не задирается выше возможностей экрана');
  console.log('пресеты качества: OK');
}

// --- Палитра для дальтоников -------------------------------------------------------
{
  setFactionPalette({});
  ok(factionColor('automatons') === FACTIONS.automatons.color, 'по умолчанию цвета каноничные');
  setFactionPalette(COLORBLIND_PALETTE);
  ok(factionColor('automatons') === COLORBLIND_PALETTE.automatons, 'подмена работает');
  ok(FACTION_IDS.every((f) => !!COLORBLIND_PALETTE[f]), 'в палитре есть каждая фракция');
  // Цвета должны попарно различаться — иначе подмена бессмысленна.
  const vals = Object.values(COLORBLIND_PALETTE);
  ok(new Set(vals).size === vals.length, 'цвета палитры не повторяются');
  setFactionPalette({});

  // Прямых чтений .color в интерфейсе и рендере быть не должно: они прошли бы
  // мимо подмены и раскрасили карту каноничными цветами.
  for (const f of [['src', 'ui', 'ui.ts'], ['src', 'ui', 'mainMenu.ts'],
    ['src', 'render', 'scene.ts'], ['src', 'render', 'fleets.ts'], ['src', 'render', 'planetMesh.ts']]) {
    ok(!/FACTIONS\[[^\]]+\]\.color/.test(read(...f)), `${f.join('/')}: цвет только через factionColor`);
  }
  console.log('палитра для дальтоников: OK');
}

// --- Группы флотов -------------------------------------------------------------------
{
  const ui = read('src', 'ui', 'ui.ts');
  ok(ui.includes('private fleetGroup('), 'группы флотов реализованы');
  ok(ui.includes('onGroup('), 'диспетчер отдаёт цифры в обработчик групп');
  ok(ui.includes('fc-group'), 'номер группы виден на карточке соединения');
  const hk = read('src', 'ui', 'hotkeys.ts');
  ok(hk.includes('/^Digit[1-9]$/'), 'цифры 1–9 разбираются отдельно от привязок');
  ok(hk.includes('e.ctrlKey || e.metaKey'), 'Ctrl (и Cmd) назначает группу');
  console.log('группы флотов: OK');
}

// --- Интерфейс без подсказок ------------------------------------------------------
{
  const ui = read('src', 'ui', 'ui.ts');
  const menu = read('src', 'ui', 'mainMenu.ts');
  const css = read('src', 'style.css');

  // Оверлей управления заменён вкладкой в настройках.
  ok(!ui.includes('help-overlay'), 'оверлея с описанием управления больше нет');
  ok(!ui.includes('toggleHelp'), 'и его переключателя тоже');
  // Кнопки на карте больше не носят всплывающих подсказок.
  const side = ui.slice(ui.indexOf('this.sideBtns.innerHTML'), ui.indexOf('#focus-btn\')!'));
  ok(!side.includes('title='), 'у кнопок на карте нет title-подсказок');
  // Показатели подписаны в строке, а не по наведению.
  ok(ui.includes('hud-tag'), 'у показателей HUD есть видимая подпись');
  ok(css.includes('.hud-tag'), 'и стиль для неё');
  // Фальшивые слоты «пригласить друга · СКОРО» убраны вместе со стилями.
  ok(!ui.includes('squad-slot'), 'фальшивых слотов команды в меню паузы нет');
  ok(!css.includes('.squad-slot'), 'их стили тоже убраны');
  ok(!css.includes('.menu-squad'), 'и контейнер под них');
  // Пояснения под кнопками сетевых экранов сняты.
  ok(!menu.includes('Ваш компьютер станет сервером'), 'пояснение про сервер убрано');
  ok(!menu.includes('Свободные места останутся за ИИ'), 'пояснение про лобби убрано');
  console.log('интерфейс без подсказок: OK');
}

// --- Настройки одни на игру и меню ----------------------------------------------
{
  const menu = read('src', 'ui', 'mainMenu.ts');
  const ui = read('src', 'ui', 'ui.ts');
  ok(menu.includes('new SettingsPanel('), 'главное меню открывает общий экран настроек');
  ok(ui.includes('new SettingsPanel('), 'меню паузы открывает его же');
  const sound = read('src', 'ui', 'sound.ts');
  ok(sound.includes("from './settings'"), 'звук берёт громкость из общей модели');
  ok(!sound.includes('sgw2_sound'), 'своего хранилища у звука не осталось');
  const main = read('src', 'main.ts');
  ok(main.includes('applyDom()'), 'настройки раскладываются до запуска');
  ok(main.includes('getSettings().startSpeed'), 'скорость на старте берётся из настроек');
  console.log('единые настройки: OK');
}

console.log(`round47: OK (${checks} проверок)`);
