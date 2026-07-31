import './style.css';
import { createGame } from './game/state';
import { GameClock } from './game/clock';
import { GalaxyScene } from './render/scene';
import { UI } from './ui/ui';

function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const seed = Math.floor(Math.random() * 1e9);

  const state = createGame(seed);
  const scene = new GalaxyScene(canvas, state);
  const clock = new GameClock(state);
  const ui = new UI(state, scene, clock);

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
    ui.toast('SPREAD MANAGED DEMOCRACY · Press 1× / 2× / 3× to begin', 3200);
  }, 700);
}

boot();
