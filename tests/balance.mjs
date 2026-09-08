#!/usr/bin/env node
// Балансовый прогон (НЕ входит в npm test — запускается вручную):
//   node tests/balance.mjs [дней] [сиды…]
// Все фракции под ИИ (игроком назначается ещё не восставшая Супер-Федерация),
// печатает контроль по годам и исход каждой партии.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tests', '.build');
mkdirSync(outDir, { recursive: true });

const days = Number(process.argv[2] ?? 3650);
const seeds = process.argv.slice(3).map(Number);
const seedList = seeds.length ? seeds : [42, 1337, 900913, 7777, 31415];

const src = `
import { createGame, planetsOf } from '${root.replace(/\\/g, '/')}/src/game/state';
import { advanceDay, moveFleets } from '${root.replace(/\\/g, '/')}/src/game/sim';
import { FACTIONS, FACTION_IDS } from '${root.replace(/\\/g, '/')}/src/data/factions';

const DAYS = ${days};
const SEEDS = ${JSON.stringify(seedList)};

for (const seed of SEEDS) {
  const s = createGame(seed);
  // Все фракции под ИИ. Одного s.player мало: createGame кладёт humans:[player],
  // а isHuman читает именно humans — при пустом humans человеком не считается
  // никто. Раньше здесь менялся только player, из-за чего Супер-Земля во всех
  // прогонах стояла столбом (за неё не работали runAI, autoPickFocus, aiBuild
  // и aiDecisions) и её стирали до нуля-одного мира. Любой вывод о гегемоне,
  // полученный до этой правки, недействителен.
  s.player = 'superFederation';
  s.humans = [];
  const timeline = [];
  // Дефициты: сколько ресурса фракция НЕ смогла потратить — главный показатель
  // того, есть ли у экономики сток. Плюс темп войны: сколько миров реально
  // меняет владельца и сколько битв идёт одновременно.
  const owner = new Map();
  for (const [id, p] of s.galaxy.planets) owner.set(id, p.owner);
  let flips = 0, battleSum = 0;
  const durations = [];
  const started = new Map();
  for (let d = 0; d < DAYS && !s.winner; d++) {
    moveFleets(s, 1);
    advanceDay(s);
    let live = 0;
    for (const [id, p] of s.galaxy.planets) {
      if (p.battle) { live++; if (!started.has(id)) started.set(id, s.day); }
      else if (started.has(id)) { durations.push(s.day - started.get(id)); started.delete(id); }
      if (owner.get(id) !== p.owner) { flips++; owner.set(id, p.owner); }
    }
    battleSum += live;
    if (s.day % 365 === 0) {
      const snap = {};
      for (const f of FACTION_IDS.concat(s.superFederationRisen ? ['superFederation'] : [])) {
        snap[f] = planetsOf(s, f).length;
      }
      snap.__prod = FACTION_IDS.map((f) => Math.round(s.factions[f].production));
      snap.__pp = FACTION_IDS.map((f) => Math.round(s.factions[f].politicalPower));
      timeline.push({ year: s.day / 365, ...snap });
    }
  }
  durations.sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : 0;
  const longWars = durations.filter((x) => x > 90).length;
  const final = {};
  for (const f of FACTION_IDS.concat(s.superFederationRisen ? ['superFederation'] : [])) {
    final[f] = planetsOf(s, f).length;
  }
  console.log('=== сид ' + seed + ' → день ' + s.day +
    (s.winner ? ' · ПОБЕДИТЕЛЬ: ' + FACTIONS[s.winner].name : ' · война продолжается'));
  for (const t of timeline) {
    console.log('  год ' + String(t.year).padStart(2) + ':',
      FACTION_IDS.map((f) => FACTIONS[f].short + ' ' + String(t[f] ?? 0).padStart(3)).join(' · '),
      t.superFederation !== undefined ? '· ФЕД ' + t.superFederation : '');
  }
  console.log('  финал:', JSON.stringify(final));
  // --- Таблица дефицитов -----------------------------------------------------
  // Неизрасходованное — это диагноз: ресурс, который некуда деть, не является
  // ресурсом. Приёмочный порог переработки — меньше 8000 производства к концу.
  const last = timeline[timeline.length - 1] ?? { __prod: [], __pp: [] };
  console.log('  не потрачено ⚒:',
    FACTION_IDS.map((f, i) => FACTIONS[f].short + ' ' + (last.__prod[i] ?? 0)).join(' · '));
  console.log('  не потрачено ⚖:',
    FACTION_IDS.map((f, i) => FACTIONS[f].short + ' ' + (last.__pp[i] ?? 0)).join(' · '));
  console.log('  темп войны: смен владельца ' + flips +
    ', боёв/день ' + (battleSum / Math.max(1, s.day)).toFixed(2) +
    ', медиана боя ' + median + ' сут, боёв длиннее 90 сут ' +
    longWars + ' из ' + durations.length);
}
`;
const entry = join(outDir, 'balance-entry.ts');
writeFileSync(entry, src);
const out = join(outDir, 'balance.cjs');
execFileSync('npx', ['esbuild', entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`, '--log-level=warning'], { cwd: root, stdio: 'inherit' });
execFileSync('node', [out], { cwd: root, stdio: 'inherit' });
rmSync(outDir, { recursive: true, force: true });
