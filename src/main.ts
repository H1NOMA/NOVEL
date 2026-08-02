import './style.css';
import { createGame } from './game/state';
import { deserializeState, readSave, takePendingLoad } from './game/persist';
import { GameClock } from './game/clock';
import { GalaxyScene } from './render/scene';
import { UI } from './ui/ui';

function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const seed = Math.floor(Math.random() * 1e9);

  // Если запрошена загрузка сейва — поднимаем состояние из него.
  let state = createGame(seed);
  const pending = takePendingLoad();
  if (pending) {
    const raw = readSave(pending);
    if (raw) {
      try {
        state = deserializeState(raw);
      } catch (e) {
        console.error('Не удалось загрузить сохранение:', e);
      }
    }
  }
  const scene = new GalaxyScene(canvas, state);
  const clock = new GameClock(state);
  const ui = new UI(state, scene, clock);

  // Отладочный крючок для автотестов и консоли (не влияет на игру).
  (window as unknown as Record<string, unknown>).__game = { state, scene, clock, ui };

  // Render loop (visuals run every frame regardless of sim speed).
  const renderLoop = (): void => {
    scene.render();
    requestAnimationFrame(renderLoop);
  };
  requestAnimationFrame(renderLoop);

  // Simulation clock (advances days according to speed).
  clock.start();

  // Reveal the galaxy.
  const loading = document.getElementById('loading');
  setTimeout(() => {
    loading?.classList.add('hidden');
    ui.toast('НЕСИ УПРАВЛЯЕМУЮ ДЕМОКРАТИЮ · Нажмите 1× / 2× / 3×, чтобы начать', 3200);
  }, 700);
}

boot();
