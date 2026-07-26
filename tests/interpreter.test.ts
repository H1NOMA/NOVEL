import { describe, expect, it } from 'vitest';
import { advance, begin, choose, currentView } from '../src/engine/interpreter';
import { ScenarioError, type Scenario, type StepResult } from '../src/engine/types';

/** Компактный тестовый сценарий с ветвлением и условным вариантом. */
const sc: Scenario = {
  meta: { id: 'test', title: 'Test', version: 1, start: 'a', vars: { trust: 0 } },
  characters: { npc: { name: 'НПС', color: '#fff' } },
  scenes: {
    a: {
      steps: [
        { type: 'bg', id: 'room' },
        { type: 'show', id: 'npc_sprite' },
        { type: 'say', who: 'npc', text: 'Привет.' },
        { type: 'set', ops: [{ var: 'met', value: true }] },
        {
          type: 'choice',
          options: [
            { text: 'Довериться', goto: 'b', set: [{ var: 'trust', op: 'add', value: 1 }] },
            { text: 'Секретный вариант', goto: 'b', cond: { var: 'trust', gte: 5 } }
          ]
        }
      ]
    },
    b: {
      steps: [
        { type: 'say', text: 'Развилка.' },
        { type: 'branch', cond: { var: 'trust', gte: 1 }, then: 'good', else: 'bad' }
      ]
    },
    good: { steps: [{ type: 'end', ending: 'good' }] },
    bad: { steps: [{ type: 'end', ending: 'bad' }] }
  }
};

function playToChoice(): StepResult {
  return advance(sc, begin(sc).state);
}

describe('interpreter', () => {
  it('begin прогоняет неблокирующие шаги до первой реплики и заполняет presentation', () => {
    const r = begin(sc);
    expect(r.view).toMatchObject({ kind: 'line', who: 'НПС', text: 'Привет.' });
    expect(r.state.presentation.background).toBe('room');
    expect(r.state.presentation.sprites.center).toBe('npc_sprite');
    expect(r.state.history).toHaveLength(1);
  });

  it('advance с реплики доходит до выбора, применив set по пути', () => {
    const r = playToChoice();
    expect(r.view.kind).toBe('choice');
    expect(r.state.vars['met']).toBe(true);
  });

  it('скрывает варианты с ложным условием', () => {
    const r = playToChoice();
    if (r.view.kind !== 'choice') throw new Error('ожидался choice');
    expect(r.view.options).toEqual([{ index: 0, text: 'Довериться' }]);
  });

  it('choose применяет set, переходит по goto и пишет выбор в историю', () => {
    const atChoice = playToChoice();
    const r = choose(sc, atChoice.state, 0);
    expect(r.state.vars['trust']).toBe(1);
    expect(r.view).toMatchObject({ kind: 'line', text: 'Развилка.' });
    expect(r.state.history.some((h) => h.text.includes('Довериться'))).toBe(true);
  });

  it('branch ведёт к разным концовкам в зависимости от переменной', () => {
    const atChoice = playToChoice();
    const good = advance(sc, choose(sc, atChoice.state, 0).state);
    expect(good.view).toEqual({ kind: 'end', ending: 'good' });

    // Без буста trust идём в bad: подменяем vars перед развилкой
    const r = choose(sc, atChoice.state, 0);
    const bad = advance(sc, { ...r.state, vars: { ...r.state.vars, trust: 0 } });
    expect(bad.view).toEqual({ kind: 'end', ending: 'bad' });
  });

  it('choose недоступного варианта — ошибка', () => {
    const atChoice = playToChoice();
    expect(() => choose(sc, atChoice.state, 1)).toThrow(ScenarioError); // скрыт условием
    expect(() => choose(sc, atChoice.state, 99)).toThrow(ScenarioError);
  });

  it('advance на выборе — no-op', () => {
    const atChoice = playToChoice();
    const r = advance(sc, atChoice.state);
    expect(r.state).toBe(atChoice.state);
    expect(r.view.kind).toBe('choice');
  });

  it('currentView восстанавливает экран из состояния (сценарий загрузки сейва)', () => {
    const atChoice = playToChoice();
    const restored = currentView(sc, structuredClone(atChoice.state));
    expect(restored).toEqual(atChoice.view);
  });

  it('seen помечает прочитанные реплики один раз', () => {
    const r = begin(sc);
    expect(r.state.seen).toEqual(['a:2']);
  });

  it('падение за конец сцены — понятная ошибка', () => {
    const broken: Scenario = {
      meta: { id: 'x', title: 'x', version: 1, start: 's' },
      characters: {},
      scenes: { s: { steps: [{ type: 'say', text: 'хвост' }] } }
    };
    const r = begin(broken);
    expect(() => advance(broken, r.state)).toThrow(/без jump\/end/);
  });
});
