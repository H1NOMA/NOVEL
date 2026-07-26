/**
 * Статическая проверка сценария: битые ссылки, недостижимые сцены,
 * сцены без завершения. Гоняется в тестах и может гоняться в CI
 * на каждом изменении сценария — ловит ошибки до запуска игры.
 */
import type { Scenario, SceneDef, Step } from './types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

export function validateScenario(sc: Scenario): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (where: string, message: string) => issues.push({ level: 'error', where, message });
  const warn = (where: string, message: string) => issues.push({ level: 'warning', where, message });

  if (!sc.scenes[sc.meta.start]) {
    err('meta.start', `стартовая сцена "${sc.meta.start}" не найдена`);
  }

  const referenced = new Set<string>([sc.meta.start]);
  const checkTarget = (where: string, target: string) => {
    referenced.add(target);
    if (!sc.scenes[target]) err(where, `переход в несуществующую сцену "${target}"`);
  };

  for (const [sceneId, scene] of Object.entries(sc.scenes)) {
    scene.steps.forEach((step, i) => {
      const where = `${sceneId}:${i}`;
      switch (step.type) {
        case 'say':
          if (step.who !== undefined && !sc.characters[step.who]) {
            err(where, `персонаж "${step.who}" не найден`);
          }
          break;
        case 'jump':
          checkTarget(where, step.to);
          break;
        case 'branch':
          checkTarget(where, step.then);
          if (step.else !== undefined) checkTarget(where, step.else);
          break;
        case 'choice':
          if (step.options.length === 0) err(where, 'choice без вариантов');
          step.options.forEach((o, j) => checkTarget(`${where} (вариант ${j})`, o.goto));
          break;
        default:
          break;
      }
    });

    if (!sceneTerminates(scene)) {
      err(sceneId, 'сцена может закончиться без jump/end/choice — игра упадёт при «проваливании» за последний шаг');
    }
  }

  for (const sceneId of Object.keys(sc.scenes)) {
    if (!referenced.has(sceneId)) warn(sceneId, 'сцена недостижима (на неё нет ни одной ссылки)');
  }

  return issues;
}

/** Последний шаг сцены гарантированно уводит из неё? */
function sceneTerminates(scene: SceneDef): boolean {
  const last: Step | undefined = scene.steps[scene.steps.length - 1];
  if (!last) return false;
  switch (last.type) {
    case 'jump':
    case 'end':
    case 'choice':
      return true;
    case 'branch':
      return last.else !== undefined;
    default:
      return false;
  }
}
