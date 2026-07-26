import { describe, expect, it } from 'vitest';
import { begin } from '../src/engine/interpreter';
import { makeSave, parseSave, serializeSave } from '../src/engine/saves';
import { demoScenario } from '../src/scenario/demo';

describe('saves', () => {
  it('roundtrip: состояние переживает сериализацию без потерь', () => {
    const { state } = begin(demoScenario);
    const json = serializeSave(makeSave(state, '2026-07-26T12:00:00Z'));
    const res = parseSave(json, demoScenario);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.save.state).toEqual(state);
  });

  it('caption берётся из последней реплики', () => {
    const { state } = begin(demoScenario);
    const save = makeSave(state, '2026-07-26T12:00:00Z');
    expect(save.caption.length).toBeGreaterThan(0);
  });

  it('битый JSON и чужой сценарий отклоняются', () => {
    expect(parseSave('{oops', demoScenario)).toEqual({ ok: false, reason: 'corrupt' });
    const { state } = begin(demoScenario);
    const alien = serializeSave({ ...makeSave(state, ''), scenarioId: 'другая-игра' });
    expect(parseSave(alien, demoScenario)).toEqual({ ok: false, reason: 'wrong-scenario' });
  });

  it('сейв из более новой версии сценария не грузится', () => {
    const { state } = begin(demoScenario);
    const future = serializeSave({ ...makeSave(state, ''), scenarioVersion: 999 });
    expect(parseSave(future, demoScenario)).toEqual({ ok: false, reason: 'newer-version' });
  });
});
