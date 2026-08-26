// ---------------------------------------------------------------------------
// Горячие клавиши.
//
// Ключевое решение — привязка идёт к `KeyboardEvent.code`, а не к `.key`.
// `.key` отдаёт символ ТЕКУЩЕЙ раскладки: на русской «F» приходит как «а», и
// проверка `e.key === 'f'` молча перестаёт работать. `code` описывает
// физическую клавишу и от раскладки не зависит — одна и та же кнопка работает
// в любой системе.
//
// Привязки перебиндиваются и переживают перезапуск. Конфликты разрешаются
// вытеснением: новая привязка забирает клавишу у прежнего владельца, чтобы
// нельзя было получить два действия на одной кнопке.
// ---------------------------------------------------------------------------

const KEY = 'sgw2_keys';

export type ActionId =
  | 'pause' | 'speedUp' | 'speedDown'
  | 'focusTree' | 'decisions' | 'production' | 'chronicle' | 'dossier' | 'menu'
  | 'panUp' | 'panDown' | 'panLeft' | 'panRight'
  | 'rotateLeft' | 'rotateRight' | 'zoomIn' | 'zoomOut'
  | 'home' | 'cinema'
  | 'nextFleet' | 'prevFleet' | 'clearSelection'
  | 'quickSave' | 'quickLoad';

export interface Binding {
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ActionSpec {
  id: ActionId;
  group: string;
  label: string;
  /** Привязка по умолчанию. */
  def: Binding;
  /** Действие удерживания (панорама, поворот) — реагирует на зажатие. */
  held?: boolean;
}

/** Порядок групп на экране управления. */
export const KEY_GROUPS = ['Время', 'Экраны', 'Карта', 'Флоты', 'Партия'] as const;

export const ACTIONS: ActionSpec[] = [
  { id: 'pause', group: 'Время', label: 'Пауза', def: { code: 'Space' } },
  { id: 'speedUp', group: 'Время', label: 'Быстрее', def: { code: 'Equal' } },
  { id: 'speedDown', group: 'Время', label: 'Медленнее', def: { code: 'Minus' } },

  { id: 'focusTree', group: 'Экраны', label: 'Фокусы', def: { code: 'KeyF' } },
  { id: 'decisions', group: 'Экраны', label: 'Решения', def: { code: 'KeyG' } },
  { id: 'production', group: 'Экраны', label: 'Производство', def: { code: 'KeyB' } },
  { id: 'chronicle', group: 'Экраны', label: 'Журнал войны', def: { code: 'KeyJ' } },
  { id: 'dossier', group: 'Экраны', label: 'Досье фракций', def: { code: 'KeyV' } },
  { id: 'menu', group: 'Экраны', label: 'Меню · закрыть окно', def: { code: 'Escape' } },

  { id: 'panUp', group: 'Карта', label: 'Вперёд', def: { code: 'KeyW' }, held: true },
  { id: 'panDown', group: 'Карта', label: 'Назад', def: { code: 'KeyS' }, held: true },
  { id: 'panLeft', group: 'Карта', label: 'Влево', def: { code: 'KeyA' }, held: true },
  { id: 'panRight', group: 'Карта', label: 'Вправо', def: { code: 'KeyD' }, held: true },
  { id: 'rotateLeft', group: 'Карта', label: 'Поворот влево', def: { code: 'KeyQ' }, held: true },
  { id: 'rotateRight', group: 'Карта', label: 'Поворот вправо', def: { code: 'KeyE' }, held: true },
  { id: 'zoomIn', group: 'Карта', label: 'Приблизить', def: { code: 'PageUp' }, held: true },
  { id: 'zoomOut', group: 'Карта', label: 'Отдалить', def: { code: 'PageDown' }, held: true },
  { id: 'home', group: 'Карта', label: 'К столице', def: { code: 'KeyH' } },
  { id: 'cinema', group: 'Карта', label: 'К ближайшему бою', def: { code: 'KeyC' } },

  { id: 'nextFleet', group: 'Флоты', label: 'Следующий флот', def: { code: 'Tab' } },
  { id: 'prevFleet', group: 'Флоты', label: 'Предыдущий флот', def: { code: 'Tab', shift: true } },
  { id: 'clearSelection', group: 'Флоты', label: 'Снять выделение', def: { code: 'Backquote' } },

  { id: 'quickSave', group: 'Партия', label: 'Быстрое сохранение', def: { code: 'F5' } },
  { id: 'quickLoad', group: 'Партия', label: 'Быстрая загрузка', def: { code: 'F9' } },
];

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export type KeyMap = Record<ActionId, Binding>;

function defaults(): KeyMap {
  const m = {} as KeyMap;
  for (const a of ACTIONS) m[a.id] = { ...a.def };
  return m;
}

export function loadKeyMap(): KeyMap {
  const map = defaults();
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return map;
    const saved = JSON.parse(raw) as Partial<Record<string, Binding>>;
    // Читаем только известные действия: старые ключи из прошлых версий
    // игнорируются, а новые получают значение по умолчанию.
    for (const a of ACTIONS) {
      const b = saved[a.id];
      if (b && typeof b.code === 'string' && b.code) map[a.id] = b;
    }
  } catch { /* повреждённые привязки — берём умолчания */ }
  return map;
}

export function saveKeyMap(map: KeyMap): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(map));
  } catch { /* приватный режим — привязки живут до перезапуска */ }
}

export function resetKeyMap(): KeyMap {
  try {
    storage()?.removeItem(KEY);
  } catch { /* нечего чистить */ }
  return defaults();
}

/** Совпадают ли две привязки (по клавише и набору модификаторов). */
export function sameBinding(a: Binding, b: Binding): boolean {
  return a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt;
}

/**
 * Назначить клавишу действию. Возвращает новую карту.
 * Если клавиша уже занята — прежний владелец её теряет: два действия на одной
 * кнопке молча срабатывали бы вместе.
 */
export function assignBinding(map: KeyMap, id: ActionId, b: Binding): KeyMap {
  const next = { ...map };
  for (const a of ACTIONS) {
    if (a.id !== id && sameBinding(next[a.id], b)) next[a.id] = { code: '' };
  }
  next[id] = b;
  return next;
}

const CODE_LABELS: Record<string, string> = {
  Space: 'Пробел', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace',
  Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']', Backquote: '~',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: '\'', Backslash: '\\',
  PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Insert: 'Ins', Delete: 'Del',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadEnter: 'Num Enter',
};

/** Человекочитаемая подпись клавиши. */
export function keyLabel(b: Binding | undefined): string {
  if (!b?.code) return '—';
  let name = CODE_LABELS[b.code];
  if (!name) {
    if (b.code.startsWith('Key')) name = b.code.slice(3);
    else if (b.code.startsWith('Digit')) name = b.code.slice(5);
    else if (b.code.startsWith('Numpad')) name = `Num ${b.code.slice(6)}`;
    else name = b.code;
  }
  const mods: string[] = [];
  if (b.ctrl) mods.push('Ctrl');
  if (b.alt) mods.push('Alt');
  if (b.shift) mods.push('Shift');
  return [...mods, name].join(' + ');
}

/** Привязка из события клавиатуры. */
export function bindingOf(e: KeyboardEvent): Binding {
  return { code: e.code, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey };
}

/** Клавиши, которые нельзя назначить: сами по себе они ничего не значат. */
const UNBINDABLE = new Set([
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight', 'CapsLock', 'NumLock', 'ScrollLock', 'ContextMenu',
]);

export function bindable(code: string): boolean {
  return !UNBINDABLE.has(code);
}

/** Курсор стоит в поле ввода — клавиши принадлежат ему, не игре. */
function typing(t: EventTarget | null): boolean {
  const e = t as HTMLElement | null;
  if (!e?.tagName) return false;
  return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable;
}

type Handler = () => void;
type GroupHandler = (slot: number, assign: boolean, double: boolean) => void;

/**
 * Диспетчер. Разовые действия приходят через `on`, удержания собираются в
 * `held` — сцена опрашивает их в кадре.
 */
export class Hotkeys {
  private map: KeyMap = loadKeyMap();
  private once = new Map<ActionId, Handler>();
  private groupFn: GroupHandler | null = null;
  private down = new Set<string>();
  /** Пока экран переназначения открыт, игровые действия не срабатывают. */
  private capture: ((b: Binding) => void) | null = null;
  /** Двойное нажатие цифры группы — «показать», а не просто «выбрать». */
  private lastGroup = { slot: -1, at: 0 };

  constructor() {
    window.addEventListener('keydown', this.onDown, { capture: true });
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', () => this.down.clear());
  }

  get keymap(): KeyMap {
    return this.map;
  }

  setKeyMap(map: KeyMap): void {
    this.map = map;
    saveKeyMap(map);
    this.down.clear();
  }

  on(id: ActionId, fn: Handler): void {
    this.once.set(id, fn);
  }

  /** Обработчик групп флотов: цифра — выбрать, Ctrl+цифра — назначить. */
  onGroup(fn: GroupHandler): void {
    this.groupFn = fn;
  }

  /** Перехватить следующее нажатие для переназначения. */
  captureNext(fn: (b: Binding) => void): void {
    this.capture = fn;
  }

  cancelCapture(): void {
    this.capture = null;
  }

  /** Зажата ли клавиша действия прямо сейчас (для панорамы и поворота). */
  held(id: ActionId): boolean {
    const b = this.map[id];
    return !!b?.code && this.down.has(b.code);
  }

  /** Любое из удержаний карты активно — повод прервать кинокамеру. */
  anyHeld(ids: ActionId[]): boolean {
    return ids.some((id) => this.held(id));
  }

  private onDown = (e: KeyboardEvent): void => {
    if (this.capture) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        this.capture = null;
        return;
      }
      if (!bindable(e.code)) return;
      const fn = this.capture;
      this.capture = null;
      fn(bindingOf(e));
      return;
    }
    if (typing(e.target)) return;
    if (e.repeat) {
      this.down.add(e.code);
      return;
    }
    this.down.add(e.code);

    // Группы флотов заведены отдельно от таблицы привязок: их девять пар,
    // и в списке переназначения они были бы восемнадцатью бессмысленными
    // строками вместо одной понятной.
    if (this.groupFn && /^Digit[1-9]$/.test(e.code) && !e.altKey) {
      const slot = Number(e.code.slice(5));
      const assign = e.ctrlKey || e.metaKey;
      let double = false;
      if (!assign) {
        const now = performance.now();
        double = this.lastGroup.slot === slot && now - this.lastGroup.at < 400;
        this.lastGroup = { slot, at: now };
      }
      e.preventDefault();
      this.groupFn(slot, assign, double);
      return;
    }

    const b = bindingOf(e);
    for (const a of ACTIONS) {
      const bound = this.map[a.id];
      if (!bound?.code || !sameBinding(bound, b)) continue;
      const fn = this.once.get(a.id);
      if (fn) {
        e.preventDefault();
        fn();
      } else if (a.held) {
        // Удержания перехватываем, чтобы страница не прокручивалась.
        e.preventDefault();
      }
      return;
    }
  };

  private onUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };
}
