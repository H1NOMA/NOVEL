import { defineConfig } from 'vite';

export default defineConfig({
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
