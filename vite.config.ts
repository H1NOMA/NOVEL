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
    // Babylon целиком ~2,5 МБ (около 500 КБ в gzip) — это ожидаемо для
    // движка, шумное предупреждение не нужно. Игра ставится настольным
    // приложением и грузится с диска, а не по сети, поэтому вес движка здесь
    // ничего не стоит: важнее, что он даёт из коробки.
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        // Движок — в отдельный чанк: игровой код обновляется чаще него.
        manualChunks(id) {
          if (id.includes('node_modules/@babylonjs')) return 'babylon';
          return undefined;
        }
      }
    }
  }
});
