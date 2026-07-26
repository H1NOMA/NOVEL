import { defineConfig } from 'vite';

export default defineConfig({
  // Относительные пути в билде — статика работает из файла, из Tauri/Electron и с itch.io
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022'
  }
});
