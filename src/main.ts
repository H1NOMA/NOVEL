import './style.css';
import { createGame } from './game/state';
import { deserializeState, readSave, takePendingLoad } from './game/persist';
import { GameClock } from './game/clock';
import { GalaxyScene } from './render/scene';
import { UI } from './ui/ui';
import { preloadShipModels } from './render/shipAssets';
import { preloadPlanetModels } from './render/planetAssets';
import { applyDom, getSettings } from './ui/settings';
import { MainMenu } from './ui/mainMenu';
import { careerStart } from './game/career';
import { attachState, hostStartGame } from './net/session';
import { applySnapshot } from './net/snapshot';
import type { FactionId } from './core/types';
import type { GameState } from './game/state';

function startGame(state: GameState, opts: { host?: boolean } = {}): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;

  // Кинематографичная виньетка поверх сцены (чистый CSS-оверлей).
  const vignette = document.createElement('div');
  vignette.id = 'vignette';
  document.body.appendChild(vignette);

  const scene = new GalaxyScene(canvas, state);
  const clock = new GameClock(state);
  // Скорость на старте берётся из настроек: кто-то хочет осмотреться в паузе,
  // кто-то — сразу в бой.
  clock.setSpeed(getSettings().startSpeed);
  const ui = new UI(state, scene, clock);

  // Сетевая партия: состояние привязывается к сессии — хост начинает рассылку,
  // клиент начинает принимать срезы в этот же объект.
  attachState(state);
  if (opts.host) hostStartGame(state);

  // Отладочный крючок для автотестов и консоли (не влияет на игру).
  (window as unknown as Record<string, unknown>).__game = { state, scene, clock, ui };

  // Один цикл на симуляцию и рендер.
  //
  // Раньше их было два: свой requestAnimationFrame у часов и свой у сцены.
  // Просыпались они в разные моменты кадра, поэтому сцена то и дело рисовала
  // положение флотов, посчитанное для прошлого вызова, — отсюда микро-рывки
  // на перелётах. Теперь порядок жёсткий: сначала шаг мира, потом кадр.
  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock.frame(dt);
    scene.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Reveal the galaxy.
  const loading = document.getElementById('loading');
  setTimeout(() => {
    loading?.classList.add('hidden');
    ui.toast('НЕСИ УПРАВЛЯЕМУЮ ДЕМОКРАТИЮ', 2600);
  }, 700);
}

async function boot(): Promise<void> {
  applyDom();
  // 3D-модели флота и миров (Blender → GLB) грузятся до старта сцены, за
  // экраном загрузки; при сбое рендер откатится на процедурные силуэты.
  await Promise.all([preloadShipModels(), preloadPlanetModels()]);

  // Запрошена загрузка сейва из игры — поднимаем сразу, без меню.
  const pending = takePendingLoad();
  if (pending) {
    const raw = readSave(pending);
    if (raw) {
      try {
        startGame(deserializeState(raw));
        return;
      } catch (e) {
        console.error('Не удалось загрузить сохранение:', e);
      }
    }
  }

  const loading = document.getElementById('loading');
  loading?.classList.add('hidden');

  new MainMenu({
    newGame(faction: FactionId) {
      loading?.classList.remove('hidden');
      careerStart(faction);
      startGame(createGame(Math.floor(Math.random() * 1e9), faction));
    },
    loadGame(slot: string) {
      const raw = readSave(slot);
      if (!raw) return;
      loading?.classList.remove('hidden');
      startGame(deserializeState(raw));
    },
    hostGame(faction: FactionId) {
      loading?.classList.remove('hidden');
      careerStart(faction);
      startGame(createGame(Math.floor(Math.random() * 1e9), faction), { host: true });
    },
    joinedGame(faction: FactionId, snapshot: string) {
      loading?.classList.remove('hidden');
      careerStart(faction);
      // Клиент не генерирует галактику: каркас создаётся любым сидом и тут же
      // перезаписывается состоянием хоста.
      const state = createGame(1, faction);
      applySnapshot(state, snapshot);
      state.player = faction;
      startGame(state);
    },
  });
}

void boot();
