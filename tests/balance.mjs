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
  s.player = 'superFederation'; // все основные фракции — под ИИ
  const timeline = [];
  for (let d = 0; d < DAYS && !s.winner; d++) {
    moveFleets(s, 1);
    advanceDay(s);
    if (s.day % 365 === 0) {
      const snap = {};
      for (const f of FACTION_IDS.concat(s.superFederationRisen ? ['superFederation'] : [])) {
        snap[f] = planetsOf(s, f).length;
      }
      timeline.push({ year: s.day / 365, ...snap });
    }
  }
  const final = {};
  for (const f of FACTION_IDS.concat(s.superFederationRisen ? ['superFederation'] : [])) {
    final[f] = planetsOf(s, f).length;
  }
  console.log('=== сид ' + seed + ' → день ' + s.day +
    (s.winner ? ' · ПОБЕДИТЕЛЬ: ' + FACTIONS[s.winner].name : ' · война продолжается'));
  for (const t of timeline) {
    console.log('  год ' + t.year + ':',
      FACTION_IDS.map((f) => FACTIONS[f].short + ' ' + (t[f] ?? 0)).join(' · '),
      t.superFederation !== undefined ? '· ФЕД ' + t.superFederation : '');
  }
  console.log('  финал:', JSON.stringify(final));
}
`;
const entry = join(outDir, 'balance-entry.ts');
writeFileSync(entry, src);
const out = join(outDir, 'balance.cjs');
execFileSync('npx', ['esbuild', entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`, '--log-level=warning'], { cwd: root, stdio: 'inherit' });
execFileSync('node', [out], { cwd: root, stdio: 'inherit' });
rmSync(outDir, { recursive: true, force: true });
