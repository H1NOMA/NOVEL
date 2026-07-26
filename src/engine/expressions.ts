import type { Condition, VarOp, Vars, VarValue } from './types';
import { ScenarioError } from './types';

/** Вычисляет условие над переменными. Отсутствующая переменная — undefined (falsy, не равна ничему). */
export function evalCondition(cond: Condition, vars: Vars): boolean {
  if (cond.all) return cond.all.every((c) => evalCondition(c, vars));
  if (cond.any) return cond.any.some((c) => evalCondition(c, vars));
  if (cond.not) return !evalCondition(cond.not, vars);

  if (cond.var === undefined) {
    throw new ScenarioError(`Пустое условие: ${JSON.stringify(cond)}`);
  }
  const v = vars[cond.var];

  if (cond.eq !== undefined) return v === cond.eq;
  if (cond.ne !== undefined) return v !== cond.ne;

  if (cond.gt !== undefined || cond.gte !== undefined || cond.lt !== undefined || cond.lte !== undefined) {
    const n = typeof v === 'number' ? v : Number.NaN;
    if (cond.gt !== undefined && !(n > cond.gt)) return false;
    if (cond.gte !== undefined && !(n >= cond.gte)) return false;
    if (cond.lt !== undefined && !(n < cond.lt)) return false;
    if (cond.lte !== undefined && !(n <= cond.lte)) return false;
    return true;
  }

  // Только var — проверка на truthy
  return Boolean(v);
}

/** Применяет операции к переменным, возвращает новый объект (исходный не мутируется). */
export function applyOps(ops: VarOp[], vars: Vars): Vars {
  const next: Vars = { ...vars };
  for (const op of ops) {
    const kind = op.op ?? 'set';
    switch (kind) {
      case 'set': {
        if (op.value === undefined) throw new ScenarioError(`set без value для "${op.var}"`);
        next[op.var] = op.value;
        break;
      }
      case 'add': {
        const delta = op.value;
        if (typeof delta !== 'number') throw new ScenarioError(`add с нечисловым value для "${op.var}"`);
        const cur = next[op.var];
        next[op.var] = (typeof cur === 'number' ? cur : 0) + delta;
        break;
      }
      case 'toggle': {
        next[op.var] = !next[op.var];
        break;
      }
    }
  }
  return next;
}

/** Подстановка переменных в текст: "Привет, {name}!" */
export function interpolate(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v: VarValue | undefined = vars[name];
    return v === undefined ? m : String(v);
  });
}
