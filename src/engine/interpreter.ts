/**
 * Интерпретатор сценария.
 *
 * Модель исполнения: сцена — плоский список шагов. Неблокирующие шаги
 * (bg/show/hide/music/set/branch/jump) выполняются подряд, пока интерпретатор
 * не «упрётся» в блокирующий шаг: say (реплика), choice (выбор) или end (концовка).
 * state.scene/state.step всегда указывают на блокирующий шаг, который сейчас
 * на экране, — поэтому сейв в любой момент корректно восстанавливается.
 *
 * Все функции чистые: принимают состояние, возвращают новое.
 */
import type { GameState, Scenario, Step, StepResult, View, ChoiceOption } from './types';
import { ScenarioError } from './types';
import { applyOps, evalCondition, interpolate } from './expressions';

const HISTORY_LIMIT = 300;

/** Начать новую игру. */
export function begin(sc: Scenario): StepResult {
  const state: GameState = {
    scenarioId: sc.meta.id,
    scenarioVersion: sc.meta.version,
    scene: sc.meta.start,
    step: 0,
    vars: { ...(sc.meta.vars ?? {}) },
    seen: [],
    history: [],
    presentation: { background: null, sprites: {}, music: null },
    ended: null
  };
  return settle(sc, state);
}

/** Игрок нажал «дальше» на реплике. На выборе и концовке — no-op. */
export function advance(sc: Scenario, state: GameState): StepResult {
  const step = currentStep(sc, state);
  if (step === null || step.type !== 'say') {
    return { state, view: currentView(sc, state) };
  }
  return settle(sc, { ...state, step: state.step + 1 });
}

/** Игрок выбрал вариант (index — из View.options, т.е. индекс в исходном массиве options). */
export function choose(sc: Scenario, state: GameState, index: number): StepResult {
  const step = currentStep(sc, state);
  if (step === null || step.type !== 'choice') {
    throw new ScenarioError(`choose() вне шага choice (${state.scene}:${state.step})`);
  }
  const option = step.options[index];
  if (option === undefined || !optionVisible(option, state)) {
    throw new ScenarioError(`Недоступный вариант выбора #${index} (${state.scene}:${state.step})`);
  }
  let next: GameState = {
    ...state,
    vars: option.set ? applyOps(option.set, state.vars) : state.vars,
    history: pushHistory(state.history, { who: null, text: `➤ ${option.text}` })
  };
  next = jumpTo(sc, next, option.goto);
  return settle(sc, next);
}

/** Текущий View без изменения состояния (например, после загрузки сейва). */
export function currentView(sc: Scenario, state: GameState): View {
  if (state.ended !== null) return { kind: 'end', ending: state.ended };
  const step = currentStep(sc, state);
  if (step === null) {
    throw new ScenarioError(`Состояние вне блокирующего шага (${state.scene}:${state.step})`);
  }
  return viewOf(sc, state, step);
}

// ---------------------------------------------------------------------------

function currentStep(sc: Scenario, state: GameState): Step | null {
  if (state.ended !== null) return null;
  const scene = sc.scenes[state.scene];
  if (!scene) throw new ScenarioError(`Сцена "${state.scene}" не найдена`);
  return scene.steps[state.step] ?? null;
}

function jumpTo(sc: Scenario, state: GameState, sceneId: string): GameState {
  if (!sc.scenes[sceneId]) throw new ScenarioError(`Переход в несуществующую сцену "${sceneId}"`);
  return { ...state, scene: sceneId, step: 0 };
}

/** Выполнять неблокирующие шаги, пока не встретится say/choice/end. */
function settle(sc: Scenario, input: GameState): StepResult {
  let state = input;
  // Предохранитель от бесконечных циклов jump/branch в битом сценарии
  for (let guard = 0; guard < 10_000; guard++) {
    const scene = sc.scenes[state.scene];
    if (!scene) throw new ScenarioError(`Сцена "${state.scene}" не найдена`);
    const step = scene.steps[state.step];
    if (step === undefined) {
      throw new ScenarioError(
        `Сцена "${state.scene}" закончилась без jump/end (шаг ${state.step}). ` +
          `Последним шагом сцены должен быть jump, end, branch с else или choice.`
      );
    }

    switch (step.type) {
      case 'say': {
        const key = `${state.scene}:${state.step}`;
        const view = viewOf(sc, state, step);
        if (view.kind !== 'line') throw new ScenarioError('unreachable');
        state = {
          ...state,
          seen: state.seen.includes(key) ? state.seen : [...state.seen, key],
          history: pushHistory(state.history, { who: view.who, text: view.text })
        };
        return { state, view };
      }
      case 'choice':
      case 'end':
        return { state, view: viewOf(sc, state, step) };

      case 'bg':
        state = { ...state, presentation: { ...state.presentation, background: step.id }, step: state.step + 1 };
        break;
      case 'show': {
        const slot = step.slot ?? 'center';
        state = {
          ...state,
          presentation: { ...state.presentation, sprites: { ...state.presentation.sprites, [slot]: step.id } },
          step: state.step + 1
        };
        break;
      }
      case 'hide': {
        const sprites = { ...state.presentation.sprites };
        delete sprites[step.slot];
        state = { ...state, presentation: { ...state.presentation, sprites }, step: state.step + 1 };
        break;
      }
      case 'music':
        state = { ...state, presentation: { ...state.presentation, music: step.id }, step: state.step + 1 };
        break;
      case 'sfx':
        // Одноразовый эффект, в состоянии не хранится; UI может подписаться позже
        state = { ...state, step: state.step + 1 };
        break;
      case 'set':
        state = { ...state, vars: applyOps(step.ops, state.vars), step: state.step + 1 };
        break;
      case 'branch':
        if (evalCondition(step.cond, state.vars)) {
          state = jumpTo(sc, state, step.then);
        } else if (step.else !== undefined) {
          state = jumpTo(sc, state, step.else);
        } else {
          state = { ...state, step: state.step + 1 };
        }
        break;
      case 'jump':
        state = jumpTo(sc, state, step.to);
        break;
    }
  }
  throw new ScenarioError(`Похоже на бесконечный цикл переходов (сцена "${state.scene}")`);
}

function viewOf(sc: Scenario, state: GameState, step: Step): View {
  switch (step.type) {
    case 'say': {
      const ch = step.who !== undefined ? sc.characters[step.who] : undefined;
      if (step.who !== undefined && !ch) {
        throw new ScenarioError(`Персонаж "${step.who}" не найден (${state.scene}:${state.step})`);
      }
      return {
        kind: 'line',
        whoId: step.who ?? null,
        who: ch ? interpolate(ch.name, state.vars) : null,
        color: ch?.color ?? null,
        text: interpolate(step.text, state.vars)
      };
    }
    case 'choice':
      return {
        kind: 'choice',
        prompt: step.prompt ?? null,
        options: step.options
          .map((o, index) => ({ option: o, index }))
          .filter(({ option }) => optionVisible(option, state))
          .map(({ option, index }) => ({ index, text: interpolate(option.text, state.vars) }))
      };
    case 'end':
      return { kind: 'end', ending: step.ending };
    default:
      throw new ScenarioError(`viewOf: шаг ${step.type} не является блокирующим`);
  }
}

function optionVisible(option: ChoiceOption, state: GameState): boolean {
  return option.cond === undefined || evalCondition(option.cond, state.vars);
}

function pushHistory(history: GameState['history'], entry: GameState['history'][number]) {
  const next = [...history, entry];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}
