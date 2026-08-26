import type { FactionId } from '../core/types';
import { FACTIONS, FACTION_IDS, factionColor } from '../data/factions';
import { emblemDataURL } from '../render/emblems';
import { AUTOSAVE_SLOT, MANUAL_SLOTS, saveMeta } from '../game/persist';
import { netAvailable } from '../net/bridge';
import { careerLines, careerRank, loadCareer, resetCareer } from '../game/career';
import { logoBlock } from './logo';
import { SHAPE_ART } from './shapeArt';
import { DEFAULT_SHAPE, GALAXY_SHAPES, type GalaxyShape } from '../game/galaxyShapes';
import { SettingsPanel } from './settingsPanel';
import {
  claimFaction, findParties, getHostAdapters, getHostAddress, getLobbySlots, getPartyCode,
  getPartyMembers, joinGame, kickPeer, setHostAddress, setLobbyHandlers, startHosting,
  leave as leaveNet,
} from '../net/session';
import { adapterPicker, partyCodeBlock, rosterList } from './party';
import type { LobbySlot } from '../net/protocol';
import type { FoundParty } from '../net/bridge';

// ---------------------------------------------------------------------------
// Главное меню: единая точка входа в игру. Экраны переключаются внутри одного
// оверлея, фон — рендер Blender (tools/blender/menuart.py).
// ---------------------------------------------------------------------------

export interface MenuActions {
  /** Новая одиночная кампания за выбранную фракцию в галактике выбранной формы. */
  newGame(faction: FactionId, shape: GalaxyShape): void;
  /** Загрузить слот сохранения. */
  loadGame(slot: string): void;
  /** Начать сетевую партию хостом. */
  hostGame(faction: FactionId, shape: GalaxyShape): void;
  /** Присоединиться к чужой партии: состояние придёт с хоста. */
  joinedGame(faction: FactionId, snapshot: string): void;
}

type Screen = 'root' | 'faction' | 'shape' | 'load' | 'career' | 'settings' | 'net' | 'lobby';

const el = (tag: string, cls?: string, html?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class MainMenu {
  private root = el('div', 'mm');
  /** Контейнер сменного содержимого; оболочка строится один раз. */
  private body!: HTMLElement;
  private screen: Screen = 'root';
  /** Куда ведёт выбор фракции: одиночная игра или роль хоста. */
  private factionPurpose: 'single' | 'host' = 'single';
  /** Сторона, выбранная на прошлом экране: форму галактики выбирают после неё. */
  private pickedFaction: FactionId | null = null;
  private netInfo = '';
  private isHost = false;
  /** Найденные в сети партии и признак идущего поиска. */
  private foundParties: FoundParty[] = [];
  private scanning = false;

  constructor(private actions: MenuActions) {
    // Идентификатор свой: #main-menu занят внутриигровым меню паузы (ui.ts),
    // и его стили — заливка и центрирование — ломали бы стартовый экран.
    this.root.id = 'start-menu';
    // Оболочка — фон, вуаль и логотип — собирается ОДИН раз. Раньше каждый
    // переход между экранами переписывал innerHTML целиком: фоновая картинка
    // пересоздавалась, анимация наезда начиналась заново, логотип
    // раскодировался снова. Отсюда и рывки на каждом клике.
    this.root.innerHTML = `
      <div class="mm-bg"></div>
      <div class="mm-veil"></div>
      <div class="mm-inner">
        <div class="mm-head">${logoBlock()}</div>
        <div class="mm-body"></div>
      </div>
      <div class="mm-version">версия ${__APP_VERSION__}</div>`;
    this.body = this.root.querySelector<HTMLElement>('.mm-body')!;
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
      : this.screen === 'shape' ? this.shapeScreen()
      : this.screen === 'load' ? this.loadScreen()
      : this.screen === 'career' ? this.careerScreen()
      : this.screen === 'settings' ? this.settingsScreen()
      : this.screen === 'net' ? this.netScreen()
      : this.lobbyScreen();

    const inner = this.root.querySelector<HTMLElement>('.mm-inner')!;
    inner.classList.toggle('sub', this.screen !== 'root');
    inner.classList.toggle('shapes', this.screen === 'shape');
    // Меняется только тело экрана. Класс появления снимается и ставится
    // заново, чтобы анимация проигралась и на повторном заходе на тот же экран.
    this.body.innerHTML = body;
    this.body.classList.remove('mm-enter');
    void this.body.offsetWidth; // перезапуск анимации: нужен рефлоу
    this.body.classList.add('mm-enter');
    this.wire();
  }

  private rootScreen(): string {
    const auto = saveMeta(AUTOSAVE_SLOT);
    const hasSaves = !!auto || MANUAL_SLOTS.some((s) => !!saveMeta(s));
    // Порядок пунктов постоянный: недоступное гасится, но не исчезает —
    // иначе кнопки прыгают под курсором от запуска к запуску.
    const items: [string, string, boolean][] = [
      ['continue', 'ПРОДОЛЖИТЬ', !!auto],
      ['net', 'СЕТЕВАЯ ИГРА', netAvailable()],
      ['new', 'НАЧАТЬ НОВУЮ ИГРУ', true],
      ['load', 'ЗАГРУЗИТЬ', hasSaves],
      ['career', 'КАРЬЕРА', true],
      ['settings', 'НАСТРОЙКИ', true],
      ['quit', 'ВЫЙТИ', true],
    ];

    // Кнопки без подписей: одна надпись по центру, стрелка по наведению.
    // Высота фиксированная, поэтому строки стоят ровной колонкой.
    return `<div class="mm-menu">
      ${items.map(([id, label, on]) => `
        <button class="mm-btn plain ${on ? '' : 'off'}" data-go="${id}" ${on ? '' : 'disabled'}>
          <span class="mm-btn-label">${label}</span>
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
          <button class="mm-fac" data-fac="${f}" style="--fac:${factionColor(f)}">
            <img src="${emblemDataURL(f)}" alt="">
            <span class="mm-fac-name">${FACTIONS[f].name}</span>
          </button>`).join('')}
      </div>
      <button class="mm-back" data-go="root">← Назад</button>
    </div>`;
  }

  /**
   * Форма галактики. Картинки — настоящие снимки этих галактик, снятые с
   * верхней камеры без единого элемента интерфейса: выбирать форму по
   * описанию бессмысленно, её надо видеть.
   */
  private shapeScreen(): string {
    return `<div class="mm-panel wide">
      <div class="mm-panel-title">Форма галактики</div>
      <div class="mm-shapes">
        ${GALAXY_SHAPES.map((g) => `
          <button class="mm-shape" data-shape="${g.id}">
            <img src="${SHAPE_ART[g.id]}" alt="">
            <span class="mm-shape-name">${g.label}</span>
            <span class="mm-shape-blurb">${g.blurb}</span>
          </button>`).join('')}
      </div>
      <button class="mm-back" data-go="faction">← Назад</button>
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

  /**
   * Настройки — тот же экран, что в паузе. Раньше здесь жил один ползунок
   * масштаба, а всё остальное было доступно только из запущенной партии.
   */
  private settingsScreen(): string {
    return `<div class="mm-panel wide">
      <div class="mm-panel-title">Настройки</div>
      <div id="mm-settings" class="st-host"></div>
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
    // Партии в своей сети находятся сами — код нужен только тем, кто играет
    // через VPN или не попал в широковещание.
    const found = this.foundParties.map((f) => `
      <button class="mm-found" data-join-addr="${f.address}" data-join-port="${f.port}">
        <span class="mm-found-name">${f.host}</span>
        <span class="mm-found-at">${f.address}</span>
        <span class="mm-found-n">${f.players}</span>
      </button>`).join('');

    return `<div class="mm-panel wide">
      <div class="mm-panel-title">Сетевая партия</div>
      ${this.netInfo ? `<div class="mm-note">${this.netInfo}</div>` : ''}
      <div class="mm-net">
        <button class="mm-btn" data-go="host">
          <span class="mm-btn-label">СОЗДАТЬ ПАРТИЮ</span>
          <span class="mm-btn-arrow">▸</span>
        </button>
        <div class="mm-row">
          <div class="mm-panel-title">Партии рядом</div>
          <button class="mm-back" id="mm-rescan">${this.scanning ? 'Поиск…' : '⟳ Обновить'}</button>
        </div>
        <div class="mm-found-list">
          ${found || `<div class="mm-found empty">${this.scanning ? 'Поиск…' : 'Ничего не найдено'}</div>`}
        </div>
        <div class="mm-join">
          <input id="mm-addr" type="text" placeholder="КОД ПАРТИИ ИЛИ АДРЕС" autocomplete="off"
                 spellcheck="false" maxlength="24">
          <button class="mm-btn narrow" id="mm-join">ПОДКЛЮЧИТЬСЯ</button>
        </div>
      </div>
      <button class="mm-back" data-go="root">← Назад</button>
    </div>`;
  }

  private lobbyScreen(): string {
    const slots: LobbySlot[] = getLobbySlots();
    const code = getPartyCode();
    return `<div class="mm-panel wide">
      <div class="mm-panel-title">Лобби</div>
      ${this.netInfo ? `<div class="mm-note">${this.netInfo}</div>` : ''}
      ${code ? partyCodeBlock(code) : ''}
      ${this.isHost ? adapterPicker(getHostAdapters(), getHostAddress()) : ''}
      ${rosterList(getPartyMembers(), this.isHost)}
      <div class="mm-slots">
        ${slots.map((s) => `
          <button class="mm-slot ${s.takenBy ? 'taken' : ''}" data-claim="${s.faction}"
                  style="--fac:${factionColor(s.faction)}">
            <img src="${emblemDataURL(s.faction)}" alt="">
            <span class="mm-slot-name">${FACTIONS[s.faction].name}</span>
            <span class="mm-slot-who">${s.takenBy ? s.name : 'ИИ — можно занять'}</span>
          </button>`).join('')}
      </div>
      ${this.isHost
        ? `<button class="mm-btn wide" id="mm-launch">
             <span class="mm-btn-label">НАЧАТЬ ВОЙНУ</span>
             <span class="mm-btn-arrow">▸</span>
           </button>`
        : ''}
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
        } else if (to === 'net') {
          this.netInfo = '';
          this.go('net');
          void this.scanParties();
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

    // Сторона выбрана — дальше форма галактики, и только потом старт.
    this.root.querySelectorAll<HTMLElement>('[data-fac]').forEach((b) =>
      b.addEventListener('click', () => {
        this.pickedFaction = b.dataset.fac as FactionId;
        this.go('shape');
      }));

    this.root.querySelectorAll<HTMLElement>('[data-shape]').forEach((b) =>
      b.addEventListener('click', async () => {
        const shape = b.dataset.shape as GalaxyShape;
        const faction = this.pickedFaction;
        if (!faction) return this.go('faction');
        if (this.factionPurpose === 'single') {
          this.close();
          this.actions.newGame(faction, shape);
          return;
        }
        const res = await startHosting(faction);
        if (!res.ok) {
          this.netInfo = res.error ?? 'не удалось открыть порт';
          this.go('net');
          return;
        }
        this.isHost = true;
        // Адрес больше не диктуют вслух: он упакован в код партии.
        this.netInfo = res.code ? '' : 'Не удалось определить адрес этой машины.';
        this.hostFaction = faction;
        this.hostShape = shape;
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
    const input = this.root.querySelector<HTMLInputElement>('#mm-addr');
    const tryJoin = (): void => {
      const addr = input?.value.trim();
      if (!addr) {
        this.netInfo = 'Введите код партии.';
        this.render();
        return;
      }
      void this.connectTo(addr);
    };
    join?.addEventListener('click', tryJoin);
    // Enter в поле — то же, что нажать кнопку: код вводят с клавиатуры.
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryJoin();
    });

    this.root.querySelector('#mm-rescan')?.addEventListener('click', () => void this.scanParties());

    this.root.querySelectorAll<HTMLElement>('[data-join-addr]').forEach((b) =>
      b.addEventListener('click', () => void this.connectTo(
        `${b.dataset.joinAddr}:${b.dataset.joinPort}`)));

    // Хост переключает сеть партии: код пересчитывается под выбранный адаптер.
    this.root.querySelectorAll<HTMLElement>('[data-adapter]').forEach((b) =>
      b.addEventListener('click', () => {
        setHostAddress(b.dataset.adapter!);
        this.render();
      }));

    this.root.querySelectorAll<HTMLElement>('[data-kick]').forEach((b) =>
      b.addEventListener('click', () => {
        kickPeer(b.dataset.kick!);
        this.render();
      }));

    this.root.querySelector('#party-code')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(getPartyCode() ?? '');
    });

    this.root.querySelector('#mm-launch')?.addEventListener('click', () => {
      this.close();
      this.actions.hostGame(this.hostFaction, this.hostShape);
    });

    this.root.querySelector('#mm-career-reset')?.addEventListener('click', () => {
      resetCareer();
      this.render();
    });

    // Настройки монтируются в свой контейнер — вёрстка и модель общие с паузой.
    const host = this.root.querySelector<HTMLElement>('#mm-settings');
    if (host) new SettingsPanel(host).render();
  }

  /** Опрос сети: показываем «Поиск…», затем список найденного. */
  private async scanParties(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    if (this.screen === 'net') this.render();
    this.foundParties = await findParties();
    this.scanning = false;
    if (this.screen === 'net') this.render();
  }

  /** Подключение по коду, адресу или найденной партии. */
  private async connectTo(target: string): Promise<void> {
    this.netInfo = 'Подключение…';
    this.render();
    const res = await joinGame(target, 'Игрок');
    if (!res.ok) {
      this.netInfo = res.error ?? 'не удалось подключиться';
      this.render();
      return;
    }
    this.isHost = false;
    this.netInfo = '';
    this.go('lobby');
  }

  private hostFaction: FactionId = 'superEarth';
  /** Форма галактики, выбранная хостом для сетевой партии. */
  private hostShape: GalaxyShape = DEFAULT_SHAPE;
}
