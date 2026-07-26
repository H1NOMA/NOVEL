import { describe, expect, it } from 'vitest';
import { validateScenario } from '../src/engine/validate';
import { demoScenario } from '../src/scenario/demo';
import type { Scenario } from '../src/engine/types';

describe('validateScenario', () => {
  it('демо-сценарий валиден (нет ошибок)', () => {
    const errors = validateScenario(demoScenario).filter((i) => i.level === 'error');
    expect(errors).toEqual([]);
  });

  it('ловит битые ссылки, незавершённые сцены и недостижимые сцены', () => {
    const broken: Scenario = {
      meta: { id: 'x', title: 'x', version: 1, start: 'nope' },
      characters: {},
      scenes: {
        a: {
          steps: [
            { type: 'say', who: 'ghost', text: '...' },
            { type: 'jump', to: 'missing' }
          ]
        },
        tail: { steps: [{ type: 'say', text: 'хвост без завершения' }] },
        orphan: { steps: [{ type: 'end', ending: 'x' }] }
      }
    };
    const issues = validateScenario(broken);
    const texts = issues.map((i) => `${i.level}:${i.where}:${i.message}`).join('\n');
    expect(texts).toContain('стартовая сцена');
    expect(texts).toContain('персонаж "ghost" не найден');
    expect(texts).toContain('несуществующую сцену "missing"');
    expect(texts).toMatch(/error:tail:.*без jump\/end/);
    expect(issues.some((i) => i.level === 'warning' && i.where === 'orphan')).toBe(true);
  });

  it('branch без else не считается завершением сцены', () => {
    const sc: Scenario = {
      meta: { id: 'x', title: 'x', version: 1, start: 'a' },
      characters: {},
      scenes: {
        a: { steps: [{ type: 'branch', cond: { var: 'v' }, then: 'b' }] },
        b: { steps: [{ type: 'end', ending: 'e' }] }
      }
    };
    const errors = validateScenario(sc).filter((i) => i.level === 'error');
    expect(errors.some((e) => e.where === 'a')).toBe(true);
  });
});
