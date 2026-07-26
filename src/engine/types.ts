/**
 * Типы сценария и состояния игры.
 *
 * Сценарий — это чистые данные (сериализуемый JSON): его можно писать руками,
 * генерировать из редактора или конвертировать в другой движок.
 * Ядро движка не знает ничего про DOM, файлы и платформу.
 */

/** Значение игровой переменной. */
export type VarValue = number | string | boolean;

export type Vars = Record<string, VarValue>;

/**
 * Условие — сериализуемое дерево, без eval.
 * Лист: { var: "trust", gte: 2 }. Если указан только var — проверка на truthy.
 * Комбинаторы: all / any / not.
 */
export interface Condition {
  all?: Condition[];
  any?: Condition[];
  not?: Condition;
  var?: string;
  eq?: VarValue;
  ne?: VarValue;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

/** Операция над переменной: set (по умолчанию), add, toggle. */
export interface VarOp {
  var: string;
  op?: 'set' | 'add' | 'toggle';
  value?: VarValue;
}

export type SpriteSlot = 'left' | 'center' | 'right';

/** Вариант ответа в выборе. */
export interface ChoiceOption {
  text: string;
  /** Сцена, в которую ведёт выбор. */
  goto: string;
  /** Если условие ложно — вариант не показывается. */
  cond?: Condition;
  /** Операции над переменными при выборе этого варианта. */
  set?: VarOp[];
}

/**
 * Шаг сцены. Сцена — плоский список шагов; ветвление делается
 * шагами branch/jump/choice (по образцу label/jump в Ren'Py).
 */
export type Step =
  | { type: 'say'; who?: string; text: string }
  | { type: 'bg'; id: string }
  | { type: 'show'; slot?: SpriteSlot; id: string }
  | { type: 'hide'; slot: SpriteSlot }
  | { type: 'music'; id: string | null }
  | { type: 'sfx'; id: string }
  | { type: 'set'; ops: VarOp[] }
  | { type: 'branch'; cond: Condition; then: string; else?: string }
  | { type: 'choice'; prompt?: string; options: ChoiceOption[] }
  | { type: 'jump'; to: string }
  | { type: 'end'; ending: string };

export interface SceneDef {
  steps: Step[];
}

export interface CharacterDef {
  name: string;
  /** Цвет имени в текстбоксе. */
  color?: string;
}

export interface Scenario {
  meta: {
    id: string;
    title: string;
    version: number;
    /** Стартовая сцена. */
    start: string;
    /** Начальные значения переменных. */
    vars?: Vars;
  };
  characters: Record<string, CharacterDef>;
  scenes: Record<string, SceneDef>;
}

/** Что сейчас на экране (фон/спрайты/музыка) — часть состояния, чтобы сейв восстанавливал картинку. */
export interface PresentationState {
  background: string | null;
  sprites: Partial<Record<SpriteSlot, string>>;
  music: string | null;
}

export interface HistoryEntry {
  who: string | null;
  text: string;
}

/** Полное состояние прохождения. Сериализуется в сейв как есть. */
export interface GameState {
  scenarioId: string;
  scenarioVersion: number;
  /** Текущая сцена и индекс шага, на котором игра «стоит» (блокирующий шаг). */
  scene: string;
  step: number;
  vars: Vars;
  /** Прочитанные шаги ("scene:index") — для будущего режима скипа. */
  seen: string[];
  /** Бэклог реплик. */
  history: HistoryEntry[];
  presentation: PresentationState;
  /** id концовки, если игра завершена. */
  ended: string | null;
}

/** Что должен показать UI в данный момент. */
export type View =
  | { kind: 'line'; whoId: string | null; who: string | null; color: string | null; text: string }
  | { kind: 'choice'; prompt: string | null; options: { index: number; text: string }[] }
  | { kind: 'end'; ending: string };

export interface StepResult {
  state: GameState;
  view: View;
}

/** Ошибка данных сценария (битая ссылка, выход за конец сцены и т.п.). */
export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioError';
  }
}
