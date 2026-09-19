import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Версия сборки.
//
// В релизе её задаёт тег, которым запущена сборка (RELEASE_TAG в CI), в
// остальных случаях берётся из package.json. Показывается в углу главного
// меню: игроку нужно знать, ту ли сборку он запустил, — особенно когда в
// партии кто-то один обновился, а кто-то нет.
// ---------------------------------------------------------------------------
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const VERSION = (process.env.RELEASE_TAG || '').trim().replace(/^v/, '') || pkg.version;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(VERSION),
  },
  // Относительные пути в билде — статика работает из файла, из Tauri/Electron и с itch.io
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    // three.js целиком ~510 КБ — это ожидаемо, шумное предупреждение не нужно.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // three.js — в отдельный чанк: игровой код обновляется чаще движка.
        manualChunks: { three: ['three'] }
      }
    }
  }
});
