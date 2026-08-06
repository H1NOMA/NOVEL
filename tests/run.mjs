#!/usr/bin/env node
// Раннер тестов: каждый tests/*.test.ts бандлится esbuild'ом (идёт в комплекте
// с vite) в CJS и выполняется в node. Любой упавший ассерт валит прогон.
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = join(root, 'tests');
const outDir = join(testsDir, '.build');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const files = readdirSync(testsDir).filter((f) => f.endsWith('.test.ts')).sort();
if (!files.length) {
  console.error('Тестов не найдено (tests/*.test.ts)');
  process.exit(1);
}

let failed = 0;
for (const f of files) {
  const out = join(outDir, f.replace(/\.ts$/, '.cjs'));
  execFileSync('npx', [
    'esbuild', join(testsDir, f),
    '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--log-level=warning',
  ], { cwd: root, stdio: 'inherit' });
  process.stdout.write(`\n=== ${f} ===\n`);
  try {
    execFileSync('node', [out], { cwd: root, stdio: 'inherit' });
  } catch {
    failed++;
  }
}

rmSync(outDir, { recursive: true, force: true });
if (failed) {
  console.error(`\nПРОВАЛ: сьютов с ошибками — ${failed}`);
  process.exit(1);
}
console.log('\nВСЕ ТЕСТЫ ПРОШЛИ');
