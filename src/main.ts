import './ui/styles.css';
import { App } from './ui/app';
import { demoScenario } from './scenario/demo';
import { validateScenario } from './engine/validate';

const issues = validateScenario(demoScenario);
for (const issue of issues) {
  const log = issue.level === 'error' ? console.error : console.warn;
  log(`[scenario] ${issue.where}: ${issue.message}`);
}
if (issues.some((i) => i.level === 'error')) {
  throw new Error('Сценарий не прошёл валидацию, см. консоль');
}

new App(demoScenario, document.getElementById('app')!);
