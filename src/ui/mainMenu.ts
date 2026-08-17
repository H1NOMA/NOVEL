import type { FactionId } from '../core/types';
import { FACTIONS, FACTION_IDS } from '../data/factions';
import { emblemDataURL } from '../render/emblems';
import { AUTOSAVE_SLOT, MANUAL_SLOTS, saveMeta } from '../game/persist';
import { getUiScale, setUiScale, UI_SCALE_MAX, UI_SCALE_MIN } from './uiScale';
import { netAvailable } from '../net/bridge';
import { careerLines, careerRank, loadCareer, resetCareer } from '../game/career';
import { logoBlock } from './logo';
import {
  claimFaction, getLobbySlots, joinGame, setLobbyHandlers, startHosting,
  leave as leaveNet,
} from '../net/session';
import type { LobbySlot } from '../net/protocol';

// ---------------------------------------------------------------------------
// Главное меню: единая точка входа в игру. Экраны переключаются внутри одного
// оверлея, фон — рендер Blender (tools/blender/menuart.py).
// ---------------------------------------------------------------------------

export interface MenuActions {
  /** Новая одиночная кампания за выбранную фракцию. */
  newGame(faction: FactionId): void;
  /** Загрузить слот сохранения. */
  loadGame(slot: string): void;
  /** Начать сетевую партию хостом. */
  hostGame(faction: FactionId): void;
  /** Присоединиться к чужой партии: состояние придёт с хоста. */
  joinedGame(faction: FactionId, snapshot: string): void;
}

type Screen = 'root' | 'faction' | 'load' | 'career' | 'settings' | 'net' | 'lobby';

const el = (tag: string, cls?: string, html?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class MainMenu {
  private root = el('div', 'mm');
  private screen: Screen = 'root';
  /** Куда ведёт выбор фракции: одиночная игра или роль хоста. */
  private factionPurpose: 'single' | 'host' = 'single';
  private netInfo = '';
  private isHost = false;

  constructor(private actions: MenuActions) {
    // Идентификатор свой: #main-menu занят внутриигровым меню паузы (ui.ts),
    // и его стили — заливка и центрирование — ломали бы стартовый экран.
    this.root.id = 'start-menu';
    document.body.appendChild(this.root);
    setLobbyHandlers({
      onLobby: () => {
        if (this.screen === 'lobby') this.render();
      },
      onStart: (faction, snapshot) => {
        this.close();
        this.actions.joinedGame(faction, snapshot);
      },
      onDropped: () => {
        this.netInfo = 'Связь с хостом потеряна.';
        this.go('net');
      },
      onReject: (reason) => {
        this.netInfo = reason;
        if (this.screen === 'lobby' || this.screen === 'net') this.render();
      },
    });
    this.render();
  }

  private go(s: Screen): void {
    this.screen = s;
    this.render();
  }

  close(): void {
    this.root.remove();
  }

  // --- Экраны ---------------------------------------------------------------

  private render(): void {
    const body =
      this.screen === 'root' ? this.rootScreen()
      : this.screen === 'faction' ? this.factionScreen()
      : this.screen === 'load' ? this.loadScreen()
      : this.screen === 'career' ? this.careerScreen()
      : this.screen === 'settings' ? this.settingsScreen()
      : this.screen === 'net' ? this.netScreen()
      : this.lobbyScreen();

    this.root.innerHTML = `
      <div class="mm-bg"></div>
      <div class="mm-veil"></div>
      <div class="mm-inner${this.screen === 'root' ? '' : ' sub'}">
        <div class="mm-head">
          ${logoBlock()}
          <div class="mm-sub">Терминал Верховного командования Супер-Земли</div>
        </div>
        ${body}
      </div>`;
    this.wire();
  }

  private rootScreen(): string {
    const auto = saveMeta(AUTOSAVE_SLOT);
    const hasSaves = !!auto || MANUAL_SLOTS.some((s) => !!saveMeta(s));
    const career = loadCareer();
    const rank = careerRank(career);
    // Порядок пунктов постоянный: недоступное гасится, но не исчезает —
    // иначе кнопки прыгают под курсором от запуска к запуску.
    const items: [string, string, string, boolean][] = [
      ['continue', 'ПРОДОЛЖИТЬ', auto ? `Автосейв · день ${auto.day}` : 'Автосейва пока нет', !!auto],
      ['new', 'НАЧАТЬ НОВУЮ ИГРУ', 'Выбрать сторону и начать войну', true],
      ['load', 'ЗАГРУЗИТЬ', hasSaves ? 'Сохранённые партии' : 'Сохранений нет', hasSaves],
      ['career', 'КАРЬЕРА', `${rank.title} · побед: ${career.wins}`, true],
      ['settings', 'НАСТРОЙКИ', 'Масштаб интерфейса, звук, сеть', true],
      ['quit', 'ВЫЙТИ', 'Завершить работу терминала', true],
    ];

    return `<div class="mm-menu">
      ${items.map(([id, label, hint, on], i) => `
        <button class="mm-btn ${on ? '' : 'off'}" data-go="${id}" ${on ? '' : 'disabled'}>
          <span class="mm-btn-idx">${String(i + 1).padStart(2, '0')}</span>
          <span class="mm-btn-text">
            <span class="mm-btn-label">${label}</span>
            <span class="mm-btn-hint">${hint}</span>
          </span>
          <span class="mm-btn-arrow">▸</span>
        </button>`).join('')}
    </div>`;
  }

  private careerScreen(): string {
    const c = loadCareer();
    const rank = careerRank(c);
    return `<div class="mm-panel wide">
      <div class="mm-panel-title">Карьера</div>
      <div class="mm-rank">
        <div class="mm-rank-title">${rank.title}</div>
        <div class="mm-rank-next">${rank.next ?? 'Выше звания нет — только новые войны.'}</div>
      </div>
      <div class="mm-stats">
        ${careerLines(c).map(([k, v]) => `
          <div class="mm-stat"><span>${k}</span><b>${v}</b></div>`).join('')}
      </div>
      ${c.wonAs.length ? `<div class="mm-set-hint">Победы одержаны за: ${c.wonAs.map((f) => FACTIONS[f].name).join(', ')}.</div>` : ''}
      <div class="mm-row">
        <button class="mm-back" data-go="root">← Назад</button>
        <button class="mm-back danger" id="mm-career-reset">Обнулить карьеру</button>
      </div>
    </div>`;
  }

  private factionScreen(): string {
    const playable = FACTION_IDS.filter((f) => FACTIONS[f].playable);
    return `<div class="mm-panel">
      <div class="mm-panel-title">${this.factionPurpose === 'host' ? 'Ваша сторона в сетевой партии' : 'Выберите сторону'}</div>
      <div class="mm-factions">
        ${playable.map((f) => `
          <button class="mm-fac" data-fac="${f}" style="--fac:${FACTIONS[f].color}">
            <img src="${emblemDataURL(f)}" alt="">
            <span class="mm-fac-name">${FACTIONS[f].name}</span>
            <span class="mm-fac-blurb">${FACTIONS[f].blurb}</span>
          </button>`).join('')}
      </div>
      <button class="mm-back" data-go="root">← Назад</button>
    </div>`;
  }

  private loadScreen(): string {
    const rows = [AUTOSAVE_SLOT, ...MANUAL_SLOTS].map((slot) => {
      const meta = saveMeta(slot);
      const name = slot === AUTOSAVE_SLOT ? 'Автосейв' : `Слот ${slot.replace('slot', '')}`;
      if (!meta) return `<div class="mm-save empty">${name} — пусто</div>`;
      return `<button class="mm-save" data-load="${slot}">
        <span>${name}</span>
        <span class="mm-save-meta">день ${meta.day} · ${meta.savedAt}</span>
      </button>`;
    }).join('');
    return `<div class="mm-panel">
      <div class="mm-panel-title">Загрузка партии</div>
      <div class="mm-saves">${rows}</div>
      <button class="mm-back" data-go="root">← Назад</button>
    </div>`;
  }

  private settingsScreen(): string {
    const scale = getUiScale();
    return `<div class="mm-panel">
      <div class="mm-panel-title">Настройки</div>
      <div class="mm-set">
        <button class="mm-btn" data-go="net">
          <span class="mm-btn-text">
            <span class="mm-btn-label">СЕТЕВАЯ ПАРТИЯ</span>
            <span class="mm-btn-hint">${netAvailable() ? 'Создать партию или подключиться' : 'Только в десктопной сборке'}</span>
          </span>
          <span class="mm-btn-arrow">▸</span>
        </button>
        <label class="mm-set-row">
          <span>Масштаб интерфейса</span>
          <input type="range" id="mm-scale" min="${UI_SCALE_MIN}" max="${UI_SCALE_MAX}"
                 step="0.05" value="${scale}">
          <b id="mm-scale-val">${Math.round(scale * 100)}%</b>
        </label>
        <div class="mm-set-hint">Тянет за собой шрифты, панели и отступы разом. Остальные настройки — в игре, кнопка ⚙.</div>
      </div>
      <button class="mm-back" data-go="root">← Назад</button>
    </div>`;
  }

  private netScreen(): string {
    if (!netAvailable()) {
      return `<div class="mm-panel">
        <div class="mm-panel-title">Сетевая партия</div>
        <div class="mm-set-hint">Сетевая игра работает только в десктопной сборке: браузеру
        неоткуда открыть серверный порт. Скачайте сборку со страницы релизов.</div>
        <button class="mm-back" data-go="root">← Назад</button>
      </div>`;
    }
    return `<div class="mm-panel">
      <div class="mm-panel-title">Сетевая партия</div>
      ${this.netInfo ? `<div class="mm-note">${this.netInfo}</div>` : ''}
      <div class="mm-net">
        <button class="mm-btn" data-go="host">
          <span class="mm-btn-text">
            <span class="mm-btn-label">СОЗДАТЬ ПАРТИЮ</span>
            <span class="mm-btn-hint">Ваш компьютер станет сервером. Симуляцию ведёт хост.</span>
          </span>
          <span class="mm-btn-arrow">▸</span>
        </button>
        <div class="mm-join">
          <input id="mm-addr" type="text" placeholder="Адрес хоста, например 192.168.1.42" autocomplete="off">
          <button class="mm-btn narrow" id="mm-join">ПОДКЛЮЧИТЬСЯ</button>
        </div>
        <div class="mm-set-hint">Хост и клиенты должны быть в одной сети. Уход хоста завершает партию.</div>
      </div>
      <button class="mm-back" data-go="root">← Назад</button>
    </div>`;
  }

  private lobbyScreen(): string {
    const slots: LobbySlot[] = getLobbySlots();
    return `<div class="mm-panel">
      <div class="mm-panel-title">Лобби</div>
      ${this.netInfo ? `<div class="mm-note">${this.netInfo}</div>` : ''}
      <div class="mm-slots">
        ${slots.map((s) => `
          <button class="mm-slot ${s.takenBy ? 'taken' : ''}" data-claim="${s.faction}"
                  style="--fac:${FACTIONS[s.faction].color}">
            <img src="${emblemDataURL(s.faction)}" alt="">
            <span class="mm-slot-name">${FACTIONS[s.faction].name}</span>
            <span class="mm-slot-who">${s.takenBy ? s.name : 'ИИ — можно занять'}</span>
          </button>`).join('')}
      </div>
      ${this.isHost
        ? `<button class="mm-btn wide" id="mm-launch">
             <span class="mm-btn-text">
               <span class="mm-btn-label">НАЧАТЬ ВОЙНУ</span>
               <span class="mm-btn-hint">Свободные места останутся за ИИ</span>
             </span>
             <span class="mm-btn-arrow">▸</span>
           </button>`
        : '<div class="mm-set-hint">Займите фракцию и дождитесь хоста.</div>'}
      <button class="mm-back" data-go="leave">← Покинуть</button>
    </div>`;
  }

  // --- События --------------------------------------------------------------

  private wire(): void {
    this.root.querySelectorAll<HTMLElement>('[data-go]').forEach((b) =>
      b.addEventListener('click', () => {
        const to = b.dataset.go!;
        if (to === 'new') {
          this.factionPurpose = 'single';
          this.go('faction');
        } else if (to === 'host') {
          this.factionPurpose = 'host';
          this.go('faction');
        } else if (to === 'continue') {
          this.actions.loadGame(AUTOSAVE_SLOT);
        } else if (to === 'quit') {
          // В десктопной сборке окно закрывается, в браузере — просто нечего делать.
          window.close();
        } else if (to === 'leave') {
          leaveNet();
          this.isHost = false;
          this.netInfo = '';
          this.go('root');
        } else {
          this.netInfo = '';
          this.go(to as Screen);
        }
      }));

    this.root.querySelectorAll<HTMLElement>('[data-fac]').forEach((b) =>
      b.addEventListener('click', async () => {
        const faction = b.dataset.fac as FactionId;
        if (this.factionPurpose === 'single') {
          this.close();
          this.actions.newGame(faction);
          return;
        }
        const res = await startHosting(faction);
        if (!res.ok) {
          this.netInfo = res.error ?? 'не удалось открыть порт';
          this.go('net');
          return;
        }
        this.isHost = true;
        this.netInfo = `Партия открыта. Адрес для подключения: ${(res.addresses ?? []).join(' · ') || 'localhost'}`;
        this.hostFaction = faction;
        this.go('lobby');
      }));

    this.root.querySelectorAll<HTMLElement>('[data-load]').forEach((b) =>
      b.addEventListener('click', () => this.actions.loadGame(b.dataset.load!)));

    this.root.querySelectorAll<HTMLElement>('[data-claim]').forEach((b) =>
      b.addEventListener('click', () => {
        if (this.isHost) return; // хост уже выбрал сторону
        claimFaction(b.dataset.claim as FactionId);
      }));

    const join = this.root.querySelector<HTMLButtonElement>('#mm-join');
    join?.addEventListener('click', async () => {
      const addr = this.root.querySelector<HTMLInputElement>('#mm-addr')?.value.trim();
      if (!addr) {
        this.netInfo = 'Введите адрес хоста.';
        this.render();
        return;
      }
      const res = await joinGame(addr, 'Игрок');
      if (!res.ok) {
        this.netInfo = res.error ?? 'не удалось подключиться';
        this.render();
        return;
      }
      this.isHost = false;
      this.netInfo = 'Подключено. Займите свободную фракцию.';
      this.go('lobby');
    });

    this.root.querySelector('#mm-launch')?.addEventListener('click', () => {
      this.close();
      this.actions.hostGame(this.hostFaction);
    });

    this.root.querySelector('#mm-career-reset')?.addEventListener('click', () => {
      resetCareer();
      this.render();
    });

    const scale = this.root.querySelector<HTMLInputElement>('#mm-scale');
    scale?.addEventListener('input', () => {
      const v = Number(scale.value);
      setUiScale(v);
      const out = this.root.querySelector('#mm-scale-val');
      if (out) out.textContent = `${Math.round(v * 100)}%`;
    });
  }

  private hostFaction: FactionId = 'superEarth';
}
