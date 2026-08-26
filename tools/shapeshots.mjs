// ---------------------------------------------------------------------------
// Снимки форм галактики для экрана выбора.
//
// Карточка формы обязана показывать ТУ САМУЮ галактику, которую игрок получит,
// а не рисунок «в духе». Поэтому здесь запускается настоящая сборка игры, для
// каждой формы начинается партия, камера уводится в зенит, интерфейс гасится —
// и кадр сохраняется в src/assets/galaxy.
//
// Запуск (playwright ставится временно, в зависимостях игры его нет):
//   npm i -D playwright && node tools/shapeshots.mjs && npm rm -D playwright
// ---------------------------------------------------------------------------

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHAPES = ['disc', 'spiral', 'ring', 'clusters', 'bar'];
const OUT = join(process.cwd(), 'src', 'assets', 'galaxy');
const PORT = 5391;
/** Кадр снимается крупным и ужимается — так превью остаётся резким. */
const W = 1280;
const H = 960;

mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--no-sandbox'],
});

try {
  for (const shape of SHAPES) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForTimeout(1400);

    // Меню: новая игра → сторона → форма.
    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find((b) => /нов/i.test(b.textContent || ''))?.click());
    await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelector('[data-fac="superEarth"]')?.click());
    await page.waitForTimeout(600);
    await page.evaluate((s) => document.querySelector(`[data-shape="${s}"]`)?.click(), shape);

    // Ждём, пока галактика построится и модели догрузятся.
    await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
    await page.waitForTimeout(7000);

    // Интерфейс прочь, камера в зенит, вся карта в кадре.
    await page.evaluate(() => {
      document.getElementById('ui')?.setAttribute('style', 'display:none');
      document.getElementById('loading')?.classList.add('hidden');
      document.getElementById('vignette')?.remove();
      document.getElementById('tutorial')?.remove();
      const g = window.__game;
      g.state.speed = 0;
      g.scene.stopCinema?.();
      g.scene.setSelected(null);
      g.scene.target.set(0, 0, 0);
      g.scene.yaw = 0;
      // Почти отвесно: строго 90° даёт вырожденную матрицу вида.
      g.scene.pitch = 1.545;
      // Вся карта в кадре с запасом: превью обрезается по 4:3 карточки.
      g.scene.distance = 62;
    });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(OUT, `${shape}.png`) });
    console.log('снято:', shape);
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
