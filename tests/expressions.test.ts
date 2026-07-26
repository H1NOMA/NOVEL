import { describe, expect, it } from 'vitest';
import { applyOps, evalCondition, interpolate } from '../src/engine/expressions';
import { ScenarioError } from '../src/engine/types';

describe('evalCondition', () => {
  it('сравнения чисел', () => {
    const vars = { trust: 2 };
    expect(evalCondition({ var: 'trust', gte: 2 }, vars)).toBe(true);
    expect(evalCondition({ var: 'trust', gt: 2 }, vars)).toBe(false);
    expect(evalCondition({ var: 'trust', lt: 3 }, vars)).toBe(true);
    expect(evalCondition({ var: 'trust', eq: 2 }, vars)).toBe(true);
    expect(evalCondition({ var: 'trust', ne: 2 }, vars)).toBe(false);
  });

  it('truthy-проверка при одном var', () => {
    expect(evalCondition({ var: 'has_key' }, { has_key: true })).toBe(true);
    expect(evalCondition({ var: 'has_key' }, { has_key: false })).toBe(false);
    expect(evalCondition({ var: 'missing' }, {})).toBe(false);
  });

  it('отсутствующая переменная в числовом сравнении — false', () => {
    expect(evalCondition({ var: 'missing', gte: 0 }, {})).toBe(false);
  });

  it('комбинаторы all/any/not', () => {
    const vars = { a: 1, b: 0 };
    expect(evalCondition({ all: [{ var: 'a' }, { var: 'b' }] }, vars)).toBe(false);
    expect(evalCondition({ any: [{ var: 'a' }, { var: 'b' }] }, vars)).toBe(true);
    expect(evalCondition({ not: { var: 'b' } }, vars)).toBe(true);
  });

  it('пустое условие — ошибка сценария', () => {
    expect(() => evalCondition({}, {})).toThrow(ScenarioError);
  });
});

describe('applyOps', () => {
  it('set/add/toggle, без мутации исходных vars', () => {
    const vars = { trust: 1, flag: false };
    const next = applyOps(
      [
        { var: 'trust', op: 'add', value: 2 },
        { var: 'flag', op: 'toggle' },
        { var: 'name', value: 'Ая' }
      ],
      vars
    );
    expect(next).toEqual({ trust: 3, flag: true, name: 'Ая' });
    expect(vars).toEqual({ trust: 1, flag: false });
  });

  it('add к несуществующей переменной стартует с 0', () => {
    expect(applyOps([{ var: 'x', op: 'add', value: 5 }], {})).toEqual({ x: 5 });
  });
});

describe('interpolate', () => {
  it('подставляет переменные и не трогает неизвестные', () => {
    expect(interpolate('Привет, {name}! Счёт: {score}', { name: 'Гость', score: 3 })).toBe(
      'Привет, Гость! Счёт: 3'
    );
    expect(interpolate('{unknown}', {})).toBe('{unknown}');
  });
});
