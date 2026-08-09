import './style.css';
import { createGame } from './game/state';
import { deserializeState, readSave, takePendingLoad } from './game/persist';
import { GameClock } from './game/clock';
import { GalaxyScene } from './render/scene';
import { UI } from './ui/ui';
import { FACTIONS, FACTION_IDS } from './data/factions';
import { emblemDataURL } from './render/emblems';
import type { FactionId } from './core/types';
import type { GameState } from './game/state';

function startGame(state: GameState): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;

  // Кинематографичная виньетка поверх сцены (чистый CSS-оверлей).
  const vignette = document.createElement('div');
  vignette.id = 'vignette';
  document.body.appendChild(vignette);

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

/** Экран выбора фракции: карточки всех играбельных сторон войны. */
function showFactionSelect(onPick: (faction: FactionId) => void): void {
  const loading = document.getElementById('loading');
  loading?.classList.add('hidden');

  const overlay = document.createElement('div');
  overlay.id = 'faction-select';
  const playable = FACTION_IDS.filter((f) => FACTIONS[f].playable);
  overlay.innerHTML = `
    <div class="fs-title">ВТОРАЯ ГАЛАКТИЧЕСКАЯ ВОЙНА</div>
    <div class="fs-sub">Выберите сторону, за которую поведёте десятилетнюю войну</div>
    <div class="fs-cards">
      ${playable.map((f) => {
        const d = FACTIONS[f];
        return `<button class="fs-card" data-fac="${f}" style="--fac:${d.color}">
          <img src="${emblemDataURL(f)}" alt="">
          <div class="fs-name">${d.name}</div>
          <div class="fs-blurb">${d.blurb}</div>
          <div class="fs-special">◆ ${d.specialName}</div>
        </button>`;
      }).join('')}
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll<HTMLButtonElement>('.fs-card').forEach((b) =>
    b.addEventListener('click', () => {
      overlay.remove();
      loading?.classList.remove('hidden');
      onPick(b.dataset.fac as FactionId);
    }));
}

function boot(): void {
  // Если запрошена загрузка сейва — поднимаем состояние из него без выбора.
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
  // Новая партия: выбор фракции, затем генерация галактики.
  showFactionSelect((faction) => {
    const seed = Math.floor(Math.random() * 1e9);
    startGame(createGame(seed, faction));
  });
}

boot();
