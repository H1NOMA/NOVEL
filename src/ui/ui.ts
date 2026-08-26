import type { FactionId, Planet } from '../core/types';
import { bus } from '../core/emitter';
import { FACTIONS, FACTION_GEN, FACTION_IDS, SPECIALS, factionColor } from '../data/factions';
import { FOCUS_TREES } from '../data/focus';
import { BIOMES } from '../data/biomes';
import { canSelectFocus, cyberstanLost, selectFocus } from '../game/focus';
import { focusIconURL } from '../render/focusIcons';
import { orderFleetTo, garrisonReinforce, lockedInBattle, splitFleet, disbandFleet } from '../game/units';
import { buildShipyard, cancelQueue, formFleetFromYard, queueShip, storedHulls, takeStoredShips, yardsOf, SHIPYARD_COST } from '../game/shipyards';
import { canEnter } from '../game/supply';
import { fleetsAt, fleetsOf, planetsOf, type GameState } from '../game/state';
import { buildDepot, DEPOT_COST } from '../game/supply';
import { buildE711Station, buildSpecialDock, E711_STATION_COST, enableE711Mining, fireSuperweapon, installTermicide, plantGloomSeed, produceDivision, raiseSpire, rebuildSpecial, sectorFullyOwned, SPECIAL_DOCK_COST, SPECIAL_REBUILD_COST, specialDockWorld, superShotReadyIn, TERMICIDE_COST } from '../game/decisions';
import { DIVISION_COST, DIVISION_SIZE, SHIP_CLASSES, type ShipClassId } from '../data/troops';
import { troopsOf } from '../data/troops';
import { AUTOSAVE_SLOT, MANUAL_SLOTS, requestLoad, saveGame, saveMeta, setAutosaveDays } from '../game/persist';
import { bonusesFor, buyBonus, canBuyBonus, timesBought } from '../game/politics';
import { buyTruce, hostileNow, truceActive, truceCost } from '../game/diplomacy';
import { atWar, canNegotiate, cedePlanet, declareWar, makePeace, relationLabel, relationOf, CEDE_COST, PEACE_THRESHOLD, WAR_THRESHOLD } from '../game/relations';
import { GALAXY_MODIFIERS } from '../data/modifiers';
import { OBJECTIVES } from '../game/objectives';
import { commanderOf, cycleCommander } from '../game/commanders';
import { PHASE_LABEL } from '../game/combat';
import { canSabotage, canUprising, opReadyIn, reconActive, runRecon, runSabotage, runUprising, SPEC_OPS } from '../game/specops';
import { buildShield, buildStation, SHIELD_COST, STATION_COST } from '../game/defense';
import { nextRankIn, rankOf } from '../game/veterancy';
import { SoundEngine } from './sound';
import { Hotkeys } from './hotkeys';
import { partyCodeBlock, rosterList } from './party';
import { currentRole, getPartyCode, getPartyMembers, kickPeer } from '../net/session';
import { SettingsPanel } from './settingsPanel';
import { applyDom, getSettings, onSettings } from './settings';
import { markTutorialDone, TUTORIAL_STEPS, tutorialDone } from './tutorial';
import { resolveChoice } from '../game/events';
import { TIMELINE_EVENTS } from '../data/events';
import { emblemDataURL } from '../render/emblems';
import { unitIcon } from '../render/unitIcons';

/** Подпись роли подразделения в карточке (третья строка, как «место» у флота). */
const ROLE_LABEL: Record<string, string> = {
  elite: 'Элита',
  mass: 'Линейные',
  special: 'Особые',
};

/** Короткие имена супероружия — полное уходит в подсказку карточки. */
const SPECIAL_SHORT: Record<string, string> = {
  dss: 'ДКС',
  starDestroyer: 'АКС',
  monolith: 'Монолит',
  superColony: 'Суперколония',
};

/** Экранирование для подсказок: в описаниях встречаются кавычки. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
import { portraitDataURL, RULERS } from '../render/portraits';
import type { GameClock } from '../game/clock';
import type { GalaxyScene } from '../render/scene';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// Иконки вкладок сил — собственные силуэты (вид сверху / анфас), без эмодзи.
/** Супер-эсминец сверху: три носовых пилона, широкая середина, скобы кормы. */
const ICON_DESTROYER = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <rect x="11.1" y="1" width="1.8" height="7.5" rx="0.6"/>
  <rect x="7.7" y="3.2" width="1.6" height="5" rx="0.6"/>
  <rect x="14.7" y="3.2" width="1.6" height="5" rx="0.6"/>
  <rect x="8" y="8" width="8" height="9.5" rx="1.2"/>
  <rect x="5.8" y="10.2" width="12.4" height="4.2" rx="1.2"/>
  <rect x="6.2" y="17.8" width="3" height="5" rx="0.9"/>
  <rect x="14.8" y="17.8" width="3" height="5" rx="0.9"/>
  <rect x="10.5" y="18.2" width="3" height="3.6" rx="0.8"/>
</svg>`;
/** Шлем десантника анфас: купол, визор и дыхательные блоки. */
const ICON_HELMET = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M4 12.5a8 8 0 0 1 16 0V19a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 19z"/>
  <rect x="6.3" y="11.6" width="11.4" height="3.7" rx="1.85" fill="var(--panel-solid)"/>
  <rect x="7.9" y="17.3" width="2.7" height="2.7" rx="0.7" fill="var(--panel-solid)"/>
  <rect x="13.4" y="17.3" width="2.7" height="2.7" rx="0.7" fill="var(--panel-solid)"/>
</svg>`;

export class UI {
  private root: HTMLElement;
  private hud!: HTMLElement;
  private sideBtns!: HTMLElement;
  private chipsEl!: HTMLElement;
  private dossierEl!: HTMLElement;
  /** Раскрыто ли меню политических бонусов в досье. */
  private bonusesOpen = false;
  private panel!: HTMLElement;
  private focusOverlay!: HTMLElement;
  private logEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private focusTab: FactionId = 'superEarth';
  private toastTimer = 0;
  private decisionsEl!: HTMLElement;
  private productionEl!: HTMLElement;
  private menuEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private bannerTimer = 0;
  private eventEl!: HTMLElement;
  private eventTimer = 0;
  /** Позиция карточки планеты (сохраняется между открытиями). */
  private cardPos: { x: number; y: number } | null = null;
  private spireMode = false;
  private gloomMode = false;
  private termicideMode = false;
  /** Активный режим выбора цели спецоперации (id операции или null). */
  private opMode: string | null = null;
  /** Голос Верховного командования (англ. диктор). */
  /** Синтезированный звук: эмбиент, блипы, сирены. */
  private sound = new SoundEngine();
  /** Горячие клавиши: привязки к физическим клавишам, независимо от раскладки. */
  private hotkeys = new Hotkeys();
  /** Группы флотов (Ctrl+цифра назначает, цифра выбирает). */
  private groups = new Map<number, string[]>();
  /** Панель туториала (null — пройден или пропущен). */
  private tutorialEl: HTMLElement | null = null;
  private tutorialStep = 0;
  /** Стек кликабельных боевых оповещений. */
  private alertsEl!: HTMLElement;
  /** Оверлей журнала войны. */
  private chronicleEl!: HTMLElement;
  /** Индекс для перебора битв кнопкой кинокамеры. */
  private cinemaIdx = 0;
  /** Последняя ненулевая скорость — пауза возвращает именно её. */
  private lastSpeed: 1 | 2 | 3 = 1;
  /** Скорость до открытия меню (восстанавливается при закрытии). */
  private menuPrevSpeed: 0 | 1 | 2 | 3 = 0;
  // --- нижняя панель сил и групповое управление ---
  private forcesEl!: HTMLElement;
  private fleetDetailEl!: HTMLElement;
  private boxActionsEl!: HTMLElement;
  private forcesTab: 'fleet' | 'army' | 'special' = 'fleet';
  private forcesOpen = true;
  /** Мультивыбор соединений (Shift+клик по карточкам). */
  private selectedFleets = new Set<string>();
  /** Планеты, охваченные рамкой выделения. */
  private boxPlanets: string[] = [];
  /** Соединение, открытое в левой панели состава. */
  private detailFleet: string | null = null;

  constructor(private state: GameState, private scene: GalaxyScene, private clock: GameClock) {
    this.root = document.getElementById('ui')!;
    this.build();
    this.wire();
    this.renderAll();
    // Разложить сохранённые настройки: документ, сцена, звук.
    const st = getSettings();
    applyDom(st);
    this.scene.setQuality(st.quality);
    this.scene.setBloomEnabled(st.bloom);
    setAutosaveDays(st.autosaveDays);
    // Звук стартует по первому жесту (политика браузеров); блип на кнопках.
    this.sound.armOnFirstGesture();
    this.root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest?.('button')) this.sound.click();
    });
    // Туториал: только свежая партия и только если ещё не пройден.
    if (!tutorialDone() && this.state.day <= 2) this.startTutorial();
  }

  // ---------------- Туториал ----------------

  private startTutorial(): void {
    this.tutorialEl = el('div');
    this.tutorialEl.id = 'tutorial';
    this.root.append(this.tutorialEl);
    this.renderTutorial();
    bus.on('tick', () => this.tickTutorial());
  }

  private renderTutorial(): void {
    if (!this.tutorialEl) return;
    const step = TUTORIAL_STEPS[this.tutorialStep];
    if (!step) return;
    this.tutorialEl.innerHTML = `
      <div class="tut-head">УЧЕБНАЯ ДИРЕКТИВА · ШАГ ${this.tutorialStep + 1}/${TUTORIAL_STEPS.length}</div>
      <div class="tut-text">${step.text}</div>
      <button class="mini-btn" id="tut-skip">Пропустить обучение</button>`;
    this.tutorialEl.querySelector('#tut-skip')?.addEventListener('click', () => this.finishTutorial(true));
  }

  private tickTutorial(): void {
    if (!this.tutorialEl) return;
    const step = TUTORIAL_STEPS[this.tutorialStep];
    if (!step) return;
    if (step.done(this.state)) {
      this.tutorialStep++;
      if (this.tutorialStep >= TUTORIAL_STEPS.length) {
        this.finishTutorial(false);
      } else {
        this.sound.chime();
        this.renderTutorial();
      }
    }
  }

  private finishTutorial(skipped: boolean): void {
    markTutorialDone();
    this.tutorialEl?.remove();
    this.tutorialEl = null;
    if (!skipped) {
      this.toast('ОБУЧЕНИЕ ЗАВЕРШЕНО · НЕСИ ДЕМОКРАТИЮ');
      this.sound.chime();
    }
  }

  private build(): void {
    this.hud = el('div'); this.hud.id = 'hud';
    this.sideBtns = el('div'); this.sideBtns.id = 'side-btns';
    this.chipsEl = el('div'); this.chipsEl.id = 'fac-chips';
    this.dossierEl = el('div'); this.dossierEl.id = 'dossier'; this.dossierEl.classList.add('hidden');
    this.panel = el('div'); this.panel.id = 'planet-panel'; this.panel.classList.add('hidden');
    this.focusOverlay = el('div'); this.focusOverlay.id = 'focus-overlay'; this.focusOverlay.classList.add('hidden');
    this.logEl = el('div'); this.logEl.id = 'log';
    this.toastEl = el('div'); this.toastEl.id = 'toast';
    this.decisionsEl = el('div'); this.decisionsEl.id = 'decisions'; this.decisionsEl.classList.add('hidden');
    this.productionEl = el('div'); this.productionEl.id = 'production'; this.productionEl.classList.add('hidden');
    this.menuEl = el('div'); this.menuEl.id = 'main-menu'; this.menuEl.classList.add('hidden');
    this.bannerEl = el('div'); this.bannerEl.id = 'defeat-banner'; this.bannerEl.classList.add('hidden');
    this.eventEl = el('div'); this.eventEl.id = 'event-banner'; this.eventEl.classList.add('hidden');
    this.forcesEl = el('div'); this.forcesEl.id = 'forces-dock';
    this.fleetDetailEl = el('div'); this.fleetDetailEl.id = 'fleet-detail'; this.fleetDetailEl.classList.add('hidden');
    this.boxActionsEl = el('div'); this.boxActionsEl.id = 'box-actions'; this.boxActionsEl.classList.add('hidden');
    this.alertsEl = el('div'); this.alertsEl.id = 'combat-alerts';
    this.chronicleEl = el('div'); this.chronicleEl.id = 'chronicle-overlay'; this.chronicleEl.classList.add('hidden');

    // Кнопки фокусов/решений/производства — под шапкой слева.
    // Без title-подсказок: что делает кнопка, показывает её экран, а клавиши
    // перечислены в настройках. Всплывашки только загромождали карту.
    this.sideBtns.innerHTML = `
      <button class="hud-btn-sq" id="focus-btn">◈</button>
      <button class="hud-btn-sq" id="decisions-btn">⚙</button>
      <button class="hud-btn-sq" id="production-btn">⚒</button>
      <button class="hud-btn-sq" id="chronicle-btn">📜</button>
      <button class="hud-btn-sq" id="cinema-btn">🎥</button>`;
    this.sideBtns.querySelector('#focus-btn')!.addEventListener('click', () => this.toggleFocus());
    this.sideBtns.querySelector('#decisions-btn')!.addEventListener('click', () => this.toggleDecisions());
    this.sideBtns.querySelector('#production-btn')!.addEventListener('click', () => this.toggleProduction());
    this.sideBtns.querySelector('#cinema-btn')!.addEventListener('click', () => this.cinemaNext());
    this.sideBtns.querySelector('#chronicle-btn')!.addEventListener('click', () => this.toggleChronicle());

    this.root.append(this.hud, this.sideBtns, this.chipsEl, this.dossierEl, this.panel, this.focusOverlay, this.decisionsEl, this.productionEl, this.menuEl, this.bannerEl, this.eventEl, this.fleetDetailEl, this.boxActionsEl, this.forcesEl, this.alertsEl, this.chronicleEl, this.logEl, this.toastEl);
  }

  private wire(): void {
    bus.on('planetSelected', ({ id }) => this.onPlanetSelected(id));
    bus.on('stateChanged', () => this.renderDynamic());
    bus.on('tick', () => this.renderClock());
    bus.on('superFederationRose', () => {
      this.scene.refreshOwners();
      this.toast('СУПЕР-ФЕДЕРАЦИЯ ВОССТАЛА', 4000);
      this.renderAll();
    });
    bus.on('focusCompleted', () => this.renderAll());
    bus.on('factionDefeated', ({ faction, by }) => this.showDefeatBanner(faction as FactionId, by as FactionId | null));
    bus.on('gameEvent', ({ title, text }) => this.showEventBanner(title, text));
    bus.on('planetsBoxSelected', ({ ids }) => this.onBoxSelected(ids));
    bus.on('planetRightClicked', ({ id, queue }) => this.onPlanetRightClicked(id, !!queue));
    bus.on('combatAlert', (a) => this.pushAlert(a));
    bus.on('gameEvent', () => this.sound.chime());

    this.bindKeys();

    // Настройки правятся из двух мест (главное меню и пауза) — сцена и звук
    // подписаны на модель и перестраиваются, кто бы их ни изменил.
    onSettings((s) => {
      this.scene.setQuality(s.quality);
      this.scene.setBloomEnabled(s.bloom);
      this.sound.applyVolumes();
      setAutosaveDays(s.autosaveDays);
      // Смена палитры перекрашивает уже построенную карту и панели.
      this.scene.refreshOwners();
      this.renderAll();
    });
  }

  // ---------------- Горячие клавиши ----------------

  private bindKeys(): void {
    const hk = this.hotkeys;
    hk.on('pause', () => this.togglePause());
    hk.on('speedUp', () => this.stepSpeed(+1));
    hk.on('speedDown', () => this.stepSpeed(-1));

    hk.on('focusTree', () => this.toggleFocus());
    hk.on('decisions', () => this.toggleDecisions());
    hk.on('production', () => this.toggleProduction());
    hk.on('chronicle', () => this.toggleChronicle());
    hk.on('dossier', () => this.toggleDossier());
    hk.on('menu', () => {
      // Esc снимает верхний слой: сначала окна, потом выделение, и только
      // на пустом экране открывает меню.
      if (this.closeTopOverlay()) return;
      if (this.hasSelection()) {
        this.clearSelection();
        return;
      }
      this.toggleMenu();
    });

    hk.on('home', () => this.cameraHome());
    hk.on('cinema', () => this.cinemaNext());
    hk.on('nextFleet', () => this.cycleFleet(+1));
    hk.on('prevFleet', () => this.cycleFleet(-1));
    hk.on('clearSelection', () => this.clearSelection());

    hk.on('quickSave', () => {
      if (saveGame(this.state, MANUAL_SLOTS[0]!, 'Быстрое')) this.toast('СОХРАНЕНО');
    });
    hk.on('quickLoad', () => {
      if (!saveMeta(MANUAL_SLOTS[0]!)) return;
      requestLoad(MANUAL_SLOTS[0]!);
      location.reload();
    });

    hk.onGroup((slot, assign, double) => this.fleetGroup(slot, assign, double));
    this.scene.attachHotkeys(hk);
  }

  /** Закрыть самое верхнее открытое окно. Возвращает true, если было что закрывать. */
  private closeTopOverlay(): boolean {
    for (const e of [this.chronicleEl, this.focusOverlay, this.dossierEl,
      this.decisionsEl, this.productionEl, this.fleetDetailEl]) {
      if (!e.classList.contains('hidden')) {
        e.classList.add('hidden');
        if (e === this.fleetDetailEl) this.detailFleet = null;
        return true;
      }
    }
    return false;
  }

  /** Снять всё выделение разом: флоты, рамку и открытую карточку мира. */
  private clearSelection(): void {
    this.selectedFleets.clear();
    this.state.selectedFleet = null;
    this.detailFleet = null;
    this.fleetDetailEl.classList.add('hidden');
    this.boxPlanets = [];
    this.boxActionsEl.classList.add('hidden');
    this.scene.setBoxSelected([]);
    this.state.selectedPlanet = null;
    this.scene.setSelected(null);
    this.renderPanel();
    this.renderForces();
  }

  /** Есть ли вообще что снимать — от этого зависит, откроет ли Esc меню. */
  private hasSelection(): boolean {
    return this.selectedFleets.size > 0 || !!this.state.selectedFleet
      || !!this.state.selectedPlanet || this.boxPlanets.length > 0;
  }

  /** Шаг скорости: пауза ↔ ×1 ↔ ×2 ↔ ×3, как принято в жанре. */
  private stepSpeed(delta: number): void {
    const next = Math.max(0, Math.min(3, this.state.speed + delta)) as 0 | 1 | 2 | 3;
    if (next === this.state.speed) return;
    if (next > 0) this.lastSpeed = next as 1 | 2 | 3;
    this.clock.setSpeed(next);
    this.renderClock();
  }

  /** Камера к своей столице — быстрый способ вернуться домой с края карты. */
  private cameraHome(): void {
    const own = planetsOf(this.state, this.state.player);
    const home = own.find((p) => p.isCapital) ?? own[0];
    if (!home) return;
    this.scene.stopCinema();
    this.scene.focusOn(home.id);
    this.state.selectedPlanet = home.id;
    this.scene.setSelected(home.id);
    this.renderPanel();
  }

  /** Перебор своих соединений: выбирает следующее и ведёт к нему камеру. */
  private cycleFleet(dir: number): void {
    const own = fleetsOf(this.state, this.state.player);
    if (!own.length) return;
    const cur = this.state.selectedFleet;
    const i = own.findIndex((f) => f.id === cur);
    const next = own[((i + dir) % own.length + own.length) % own.length]!;
    this.selectedFleets.clear();
    this.state.selectedFleet = next.id;
    this.detailFleet = next.id;
    this.scene.stopCinema();
    if (next.at) this.scene.focusOn(next.at);
    this.renderForces();
    this.renderFleetDetail();
  }

  /**
   * Группы флотов, как в любой RTS: Ctrl+цифра запоминает выделение, цифра
   * возвращает его, двойное нажатие ведёт к группе камеру. Мёртвые id
   * отсеиваются при каждом обращении — расформированный флот не воскресает.
   */
  private fleetGroup(slot: number, assign: boolean, double: boolean): void {
    if (assign) {
      const sel = this.selectedFleets.size
        ? [...this.selectedFleets]
        : this.state.selectedFleet ? [this.state.selectedFleet] : [];
      if (!sel.length) return;
      this.groups.set(slot, sel);
      this.toast(`ГРУППА ${slot} · ${sel.length}`);
      this.renderForces();
      return;
    }
    const alive = (this.groups.get(slot) ?? []).filter((id) => {
      const f = this.state.fleets.get(id);
      return !!f && f.faction === this.state.player;
    });
    if (!alive.length) {
      this.groups.delete(slot);
      return;
    }
    this.groups.set(slot, alive);
    this.selectedFleets = new Set(alive);
    this.state.selectedFleet = alive[0]!;
    this.detailFleet = alive[0]!;
    if (double) {
      const at = this.state.fleets.get(alive[0]!)?.at;
      if (at) {
        this.scene.stopCinema();
        this.scene.focusOn(at);
      }
    }
    this.renderForces();
    this.renderFleetDetail();
  }

  renderAll(): void {
    this.renderHud();
    this.renderPanel();
    this.renderLog();
    this.renderForces();
    if (!this.dossierEl.classList.contains('hidden')) this.renderDossier();
    if (!this.focusOverlay.classList.contains('hidden')) this.renderFocus();
  }

  private renderDynamic(): void {
    const sel = this.state.selectedPlanet;
    if (sel && this.state.galaxy.planets.get(sel)?.abyss && this.state.player !== 'illuminate') {
      this.state.selectedPlanet = null;
      this.scene.setSelected(null);
    }
    this.renderHud();
    this.renderPanel();
    this.renderLog();
    this.renderForces();
    if (!this.dossierEl.classList.contains('hidden')) this.renderDossier();
    if (this.detailFleet) this.renderFleetDetail();
    if (!this.decisionsEl.classList.contains('hidden')) this.renderDecisions();
    if (!this.productionEl.classList.contains('hidden')) this.renderProduction();
    // owners may have shifted this day
    this.scene.refreshOwners();
    if (this.state.selectedPlanet) this.scene.setSelected(this.state.selectedPlanet);
    if (this.state.winner) this.showWinner();
  }

  /** Установить скорость и запомнить её для возврата из паузы. */
  private setSpeedRemember(speed: 1 | 2 | 3): void {
    this.lastSpeed = speed;
    this.clock.setSpeed(speed);
    this.renderClock();
  }

  /** Пауза с памятью: повторное нажатие возвращает прежнюю скорость. */
  private togglePause(): void {
    if (this.state.speed === 0) {
      this.clock.setSpeed(this.lastSpeed);
    } else {
      this.lastSpeed = this.state.speed as 1 | 2 | 3;
      this.clock.setSpeed(0);
    }
    this.renderClock();
  }

  // ---------------- HUD ----------------

  private renderHud(): void {
    const s = this.state;
    const fs = s.factions[s.player];

    // Мини-индикатор текущего фокуса: имя, прогресс-бар, клик открывает древо.
    const focusInd = (() => {
      if (!fs.activeFocus) {
        return '<span class="hud-ind hud-focus" id="hud-focus">◈ <span style="color:var(--fed)">нет фокуса</span></span>';
      }
      const node = FOCUS_TREES[s.player].find((n) => n.id === fs.activeFocus!.id);
      const total = node?.cost ?? 1;
      const pct = Math.max(0, Math.min(100, (1 - fs.activeFocus.remaining / total) * 100));
      return `<span class="hud-ind hud-focus" id="hud-focus">◈ <b>${node?.title ?? '?'}</b>
        <span class="hud-tag">${Math.ceil(fs.activeFocus.remaining)} дн</span>
        <span class="focus-mini"><span style="width:${pct.toFixed(0)}%"></span></span></span>`;
    })();

    // Показатели подписаны прямо в строке, а не всплывашкой по наведению:
    // цифра без имени ничего не значит, а наводить мышь на каждую — не дело.
    const ind = (icon: string, tag: string, value: string, color?: string): string =>
      `<span class="hud-ind">${icon} <span class="hud-tag">${tag}</span> <b${color ? ` style="color:${color}"` : ''}>${value}</b></span>`;

    const stabColor = fs.stability > 60 ? 'var(--ok)' : fs.stability > 35 ? 'var(--gold)' : 'var(--alr)';
    const inds = [
      focusInd,
      ind('⚖', 'ПВ', fs.politicalPower.toFixed(0)),
      s.player === 'superEarth' ? ind('☼', 'СТАБ', `${fs.stability.toFixed(0)}%`, stabColor) : '',
      ind('⚔', 'ВОЙНА', `${fs.warSupport.toFixed(0)}%`),
      ind('⚒', 'ПРОИЗВ', fs.production.toFixed(0), 'var(--gold)'),
      fs.flags.e711Mining ? ind('⛽', 'Е-711', fs.resources.e711.toFixed(0), 'var(--gold)') : '',
      fs.resources.minerals > 0 ? ind('⛏', 'РУДА', fs.resources.minerals.toFixed(0)) : '',
    ].filter(Boolean).join('');

    this.hud.innerHTML = `
      <button id="flag-btn"><img src="${emblemDataURL(s.player)}" alt=""></button>
      <div class="hud-inds">${inds}</div>
      <div class="hud-clock" style="margin-left:auto">
        <div class="hud-day">ДЕНЬ ${s.day}</div>
        <div class="speed-btns" id="speed">
          <button class="speed-btn" data-s="0">II</button>
          <button class="speed-btn" data-s="1">1×</button>
          <button class="speed-btn" data-s="2">2×</button>
          <button class="speed-btn" data-s="3">3×</button>
        </div>
      </div>`;

    this.hud.querySelector('#flag-btn')!.addEventListener('click', () => this.toggleDossier());
    this.hud.querySelector('#hud-focus')?.addEventListener('click', () => this.toggleFocus());
    this.hud.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const v = Number(b.dataset.s) as 0 | 1 | 2 | 3;
        if (v === 0) this.togglePause();
        else this.setSpeedRemember(v);
      });
    });
    this.renderClock();
    this.renderChips();
  }

  /** Счёт планет по фракциям — строкой под шапкой справа. */
  private renderChips(): void {
    const s = this.state;
    this.chipsEl.innerHTML = FACTION_IDS.concat(s.superFederationRisen ? ['superFederation'] : [])
      .map((f) => {
        const alive = planetsOf(s, f).length > 0 || fleetsOf(s, f).length > 0;
        const count = planetsOf(s, f).length;
        return `<div class="fac-chip ${alive ? '' : 'dead'}">
          <span class="fac-dot" style="background:${factionColor(f)}"></span>
          ${FACTIONS[f].short} <b style="color:${factionColor(f)}">${count}</b></div>`;
      }).join('');
  }

  private renderClock(): void {
    const day = this.hud.querySelector('.hud-day');
    if (day) day.textContent = `ДЕНЬ ${this.state.day}`;
    this.hud.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.s) === this.state.speed);
    });
  }

  // ---------------- Показатели (теперь в шапке) ----------------

  private renderStability(): void {
    // Показатели фракции живут в шапке; отдельной панели больше нет.
    this.renderHud();
    if (!this.dossierEl.classList.contains('hidden')) this.renderDossier();
  }

  // ---------------- Досье фракции ----------------

  private toggleDossier(): void {
    const hidden = this.dossierEl.classList.toggle('hidden');
    if (!hidden) this.renderDossier();
  }

  private renderDossier(): void {
    const s = this.state;
    const f = s.player;
    const fs = s.factions[f];
    const def = FACTIONS[f];
    const ruler = RULERS[f];
    const worlds = planetsOf(s, f).length;
    const fleets = fleetsOf(s, f).length;
    const focus = fs.activeFocus
      ? `${FOCUS_TREES[f].find((n) => n.id === fs.activeFocus!.id)?.title ?? '?'} · ещё ${Math.ceil(fs.activeFocus.remaining)} дн`
      : '<span style="color:var(--muted)">не выбран</span>';

    const bonuses = bonusesFor(f).map((b) => {
      const bought = timesBought(s, f, b.id);
      const can = canBuyBonus(s, f, b.id);
      const soldOut = !b.repeatable && bought > 0;
      const art = unitIcon(`pol_${b.id}`);
      return `<div class="bonus-row" title="${esc(b.desc)}">
        ${art ? `<img class="row-art" src="${art}" alt="">` : ''}
        <div class="grow">
          <b>${b.name}</b>${bought ? ` <span class="bonus-count">×${bought}</span>` : ''}
          <div class="hint" style="margin-top:2px">${b.desc}</div>
        </div>
        <button class="mini-btn ${can ? '' : 'off'}" data-bonus="${b.id}" ${can ? '' : 'disabled'}>
          ${soldOut ? '✓' : `${b.cost} ПВ`}</button>
      </div>`;
    }).join('');

    this.dossierEl.innerHTML = `
      <div class="pc-head"><span class="pc-title" style="color:${def.color}">ДОСЬЕ · ${def.name.toUpperCase()}</span>
        <button class="pc-close" id="dos-close">✕</button></div>
      <div class="pc-body">
        <div class="dossier-top">
          <img class="dossier-portrait" src="${portraitDataURL(f)}" alt="">
          <div>
            <b>${ruler.name}</b>
            <div class="hint" style="margin-top:2px">${ruler.title}</div>
            <div class="hint" style="margin-top:6px">${def.blurb}</div>
          </div>
        </div>
        <div class="pp-stat"><span>Миры под контролем</span><b>${worlds}</b></div>
        <div class="pp-stat"><span>Боевые соединения</span><b>${fleets}</b></div>
        <div class="pp-stat"><span>Резервы войск</span><b>${fs.manpower.toFixed(0)}</b></div>
        <div class="pp-stat"><span>Промышленность</span><b>${fs.industry.toFixed(0)}</b></div>
        <div class="pp-stat"><span>Политическая власть</span><b style="color:var(--gold)">⚖ ${fs.politicalPower.toFixed(0)}</b></div>
        <div class="pp-section">Экономика · в день</div>
        ${(() => {
          const ws = planetsOf(s, f);
          const prodIn = 0.4 * (fs.industry + ws.reduce((a, p) => a + p.value, 0) * 0.3);
          const minIn = ws.reduce((a, p) => a + (p.supplied && p.minerals > 0 ? p.minerals * (f === 'automatons' ? 0.22 : 0.11) : 0), 0);
          const upkeep = fleetsOf(s, f).reduce((a, fl) => a + fl.ships + fl.dreadnoughts * 2 + fl.battleships * 4, 0) * 0.05;
          return `
            <div class="pp-stat"><span>Производство</span><b style="color:#6fe39a">+${prodIn.toFixed(1)}</b></div>
            <div class="pp-stat"><span>Добыча ископаемых</span><b style="color:#6fe39a">+${minIn.toFixed(2)} ⛏ (запас ${fs.resources.minerals.toFixed(0)})</b></div>
            <div class="pp-stat"><span>Содержание флота</span><b style="color:var(--fed)">−${upkeep.toFixed(1)}</b></div>`;
        })()}
        <div class="pp-section">Текущий фокус</div>
        <div class="hint" style="margin-top:2px">◈ ${focus}</div>
        <button class="mini-btn wide" id="dos-focus">◈ Открыть древо фокусов</button>
        <div class="pp-section bonus-toggle" id="dos-bonuses-toggle">
          ${this.bonusesOpen ? '▾' : '▸'} Политические решения <span style="color:var(--gold)">⚖ ${fs.politicalPower.toFixed(0)} ПВ</span>
        </div>
        <div id="dos-bonuses" ${this.bonusesOpen ? '' : 'style="display:none"'}>${bonuses}</div>
        ${s.modifiers.length ? `<div class="pp-section">Условия кампании</div>
        ${s.modifiers.map((id) => {
          const m = GALAXY_MODIFIERS.find((g) => g.id === id);
          return m ? `<div class="dec-item"><b style="color:var(--gold)">◈ ${m.name}</b>
            <div class="hint" style="margin-top:2px">${m.desc}</div></div>` : '';
        }).join('')}` : ''}
        <div class="pp-section">Спецоперации</div>
        ${SPEC_OPS.map((op) => {
          const ready = opReadyIn(s, f, op.id);
          const can = ready === 0 && fs.politicalPower >= op.cost;
          const active = this.opMode === op.id;
          const art = unitIcon(`op_${op.id}`);
          return `<div class="bonus-row" title="${esc(op.desc)}">
            ${art ? `<img class="row-art" src="${art}" alt="">` : ''}
            <div class="grow"><b>${op.name}</b>
              <div class="hint" style="margin-top:2px">${op.desc}</div></div>
            <button class="mini-btn ${active ? 'sel' : can ? '' : 'off'}" data-op="${op.id}" ${can || active ? '' : 'disabled'}>
              ${active ? '✓ ЦЕЛЬ?' : ready > 0 ? `${ready} дн` : `${op.cost} ПВ`}</button>
          </div>`;
        }).join('')}
        <div class="hint">Выберите операцию, затем щёлкните планету-цель и подтвердите в её карточке.</div>
        <div class="pp-section">Дипломатия</div>
        ${FACTION_IDS.filter((f2) => f2 !== f && s.factions[f2].alive).map((f2) => {
          const active = truceActive(s, f, f2);
          const rel = relationOf(s, f, f2);
          const war = atWar(s, f, f2);
          const vassal = s.puppets?.[f2] === f;
          const master = s.puppets?.[f] === f2;
          const canTalk = canNegotiate(f, f2);
          const canTruce = fs.politicalPower >= truceCost(s) && !active && war && canTalk;
          const canPeace = war && canTalk && rel > PEACE_THRESHOLD;
          // Шкала симпатии: цвет и ширина сразу показывают, к чему идёт дело.
          const pct = Math.round((rel + 100) / 2);
          const relColor = rel <= WAR_THRESHOLD ? 'var(--alr)' : rel < -20 ? 'var(--fed)' : rel < 20 ? 'var(--muted)' : 'var(--ok)';
          const status = vassal ? 'ваша марионетка'
            : master ? 'вы под её протекторатом'
            : war ? 'ВОЙНА' : canTalk ? relationLabel(rel) : 'рой не ведёт переговоров';
          return `<div class="bonus-row" title="Симпатия ${rel.toFixed(0)}">
            <div class="grow"><b style="color:${factionColor(f2)}">${FACTIONS[f2].name}</b>
              <span style="color:${relColor};font-size:0.7rem"> · ${status}</span>
              <div class="rel-bar"><i style="width:${pct}%;background:${relColor}"></i></div>
            </div>
            ${canPeace ? `<button class="mini-btn" data-peace="${f2}">МИР</button>`
              : canTruce ? `<button class="mini-btn" data-truce="${f2}">ПЕРЕМИРИЕ · ${truceCost(s)} ПВ</button>`
              : active ? '<span style="color:var(--ok)">перемирие</span>'
              : !war && canTalk ? `<button class="mini-btn ${fs.politicalPower >= 40 ? '' : 'off'}" data-declare="${f2}" ${fs.politicalPower >= 40 ? '' : 'disabled'}>ВОЙНА</button>`
              : ''}</div>`;
        }).join('')}
        ${(() => {
          const beaten = s.trophies?.[f] ?? [];
          if (!beaten.length) return '';
          return `<div class="pp-section">Трофейные технологии</div>
            <div class="hint">Взяв столицу, вы получили доступ к чужим школам: ${beaten.map((v) => FACTIONS[v].name).join(', ')}. Трофейные фокусы открыты в древе.</div>`;
        })()}
        <div class="pp-section">Цели кампании</div>
        ${OBJECTIVES.map((o) => {
          const done = s.doneObjectives.includes(o.id);
          return `<div class="pp-stat"><span title="${o.desc}">${done ? '✓' : '◇'} ${o.title}</span><b style="color:${done ? '#6fe39a' : 'var(--muted)'}">${done ? 'выполнено' : '+' + o.reward + ' ПВ'}</b></div>`;
        }).join('')}
      </div>`;

    this.dossierEl.querySelector('#dos-close')?.addEventListener('click', () => this.dossierEl.classList.add('hidden'));
    this.dossierEl.querySelector('#dos-focus')?.addEventListener('click', () => {
      this.dossierEl.classList.add('hidden');
      this.toggleFocus();
    });
    this.dossierEl.querySelector('#dos-bonuses-toggle')?.addEventListener('click', () => {
      this.bonusesOpen = !this.bonusesOpen;
      this.renderDossier();
    });
    this.dossierEl.querySelectorAll<HTMLButtonElement>('[data-truce]').forEach((b) =>
      b.addEventListener('click', () => {
        if (buyTruce(this.state, b.dataset.truce as FactionId)) {
          this.sound.chime();
          this.toast('ПЕРЕМИРИЕ ЗАКЛЮЧЕНО');
          this.renderDossier();
          this.renderHud();
        }
      }));
    // Объявление войны стоит политвласти: решение должно быть весомым.
    this.dossierEl.querySelectorAll<HTMLButtonElement>('[data-declare]').forEach((b) =>
      b.addEventListener('click', () => {
        const s2 = this.state;
        const target = b.dataset.declare as FactionId;
        const fs2 = s2.factions[s2.player];
        if (fs2.politicalPower < 40) return;
        if (declareWar(s2, s2.player, target, 'решение верховного командования')) {
          fs2.politicalPower -= 40;
          this.sound.siren();
          this.toast('ВОЙНА ОБЪЯВЛЕНА');
          this.renderDossier();
          this.renderHud();
        }
      }));
    this.dossierEl.querySelectorAll<HTMLButtonElement>('[data-peace]').forEach((b) =>
      b.addEventListener('click', () => {
        if (makePeace(this.state, this.state.player, b.dataset.peace as FactionId)) {
          this.sound.chime();
          this.toast('МИР ПОДПИСАН');
          this.renderDossier();
          this.renderHud();
        }
      }));
    this.dossierEl.querySelectorAll<HTMLButtonElement>('[data-bonus]').forEach((b) =>
      b.addEventListener('click', () => {
        if (buyBonus(this.state, this.state.player, b.dataset.bonus!)) {
          this.toast('ПОЛИТИЧЕСКОЕ РЕШЕНИЕ ПРИНЯТО');
          this.renderDossier();
          this.renderHud();
        }
      }));
    this.dossierEl.querySelectorAll<HTMLButtonElement>('[data-op]').forEach((b) =>
      b.addEventListener('click', () => {
        const op = b.dataset.op!;
        this.opMode = this.opMode === op ? null : op;
        this.toast(this.opMode
          ? 'РЕЖИМ ОПЕРАЦИИ: ЩЁЛКНИТЕ ПЛАНЕТУ-ЦЕЛЬ'
          : 'РЕЖИМ ОПЕРАЦИИ ОТМЕНЁН');
        this.renderDossier();
        this.renderPanel();
      }));
  }

  // ---------------- Planet panel ----------------

  private onPlanetSelected(id: string | null): void {
    // ЛКМ — только информация о планете. Все приказы флотам — через ПКМ.
    const s = this.state;
    s.selectedPlanet = id;
    this.scene.setSelected(id);
    this.renderPanel();
  }

  private renderPanel(): void {
    const s = this.state;
    const id = s.selectedPlanet;
    if (!id) { this.panel.classList.add('hidden'); return; }
    const p = s.galaxy.planets.get(id);
    if (!p || (p.abyss && s.player !== 'illuminate')) { this.panel.classList.add('hidden'); return; }
    this.panel.classList.remove('hidden');

    if (p.shattered) {
      // Поле обломков: минимальная карточка (флоты игрока могут улететь).
      const hereFleets = fleetsAt(s, id).filter((f) => f.faction === s.player);
      let sh = `
        <div class="pc-head" id="pc-drag">
          <span class="pc-title">☄ ${p.name}</span>
          <button class="pc-close" id="pc-close">✕</button>
        </div>
        <div class="pc-body">
        <div class="pp-sub">ПОЛЕ ОБЛОМКОВ · ${p.sector}</div>
        <div class="hint">Планета уничтожена орбитальным залпом. Линии снабжения мертвы; здесь больше нечего захватывать.</div>`;
      hereFleets.forEach((f) => {
        sh += `<div class="fleet-row ${s.selectedFleet === f.id ? 'sel' : ''}">
          <div class="grow"><div>${f.special ? '◆ ' + SPECIALS[f.faction].name : '🚀 Супер-эсминец'}</div></div>
          <button class="mini-btn" data-act="select" data-fleet="${f.id}">${s.selectedFleet === f.id || this.selectedFleets.has(f.id) ? '✓ ВЫБРАН' : 'ВЫБРАТЬ'}</button>
        </div>`;
      });
      sh += `</div>`;
      this.panel.innerHTML = sh;
      this.applyCardPos();
      this.wireCard(p);
      return;
    }

    const here = fleetsAt(s, id);
    const playerFleets = here.filter((f) => f.faction === s.player);
    // Туман войны: чужие флоты известны на своих планетах, в битвах
    // и в секторах, вскрытых разведоперацией.
    const intel = p.owner === s.player || !!p.battle || s.playerDefeated || !!s.winner || reconActive(s, p.sector);
    const enemyFleets = intel ? here.filter((f) => f.faction !== s.player) : [];

    // Контроль над планетой: при битве — шкала освобождения, иначе 100% владельца.
    const b = p.battle;
    const controlPct = b ? 100 - b.liberation : 100;
    const attackerPct = b ? b.liberation : 0;

    let html = `
      <div class="pc-head" id="pc-drag">
        <span class="pc-title">${p.name}${p.isCapital ? ' ★' : ''}</span>
        <button class="pc-close" id="pc-close">✕</button>
      </div>
      <div class="pc-body">
      <div class="pp-sub">${p.isCapital ? 'СТОЛИЧНЫЙ МИР · ' : ''}${p.sector} · ${BIOMES[p.biome].label}${p.gloom ? ' · ВО МРАКЕ' : ''}${reconActive(s, p.sector) ? ' · <span style="color:var(--gold)">👁 СЕКТОР РАЗВЕДАН</span>' : ''}${p.scarred ? ' · ⚱ ШРАМЫ ВОЙНЫ' : ''}</div>
      <div class="pp-owner"><span class="fac-dot" style="background:${factionColor(p.owner)}"></span>${FACTIONS[p.owner].name}</div>

      <div class="pp-section">Контроль</div>
      <div class="ctrl-bar">
        <span style="width:${controlPct}%;background:${factionColor(p.owner)}"></span>
        ${b ? `<span style="width:${attackerPct}%;background:${factionColor(b.attacker)}"></span>` : ''}
      </div>
      <div class="ctrl-row">
        <span style="color:${factionColor(p.owner)}">${FACTIONS[p.owner].short} ${controlPct.toFixed(0)}%</span>
        ${b ? `<span style="color:${factionColor(b.attacker)}">${FACTIONS[b.attacker].short} ${attackerPct.toFixed(0)}%</span>` : ''}
      </div>
      ${b ? `<div class="hint">⚔ Битва идёт ${b.days}-й день${b.phase ? ` · фаза: <b style="color:var(--gold)">${PHASE_LABEL[b.phase]}</b>` : ''}${(b.landed ?? 0) >= 1 ? ` · десант на земле: <b style="color:${factionColor(b.attacker)}">${(b.landed ?? 0).toFixed(0)}</b>` : ''}</div>` : ''}
      ${(() => {
        // Снабжение атаки игрока: с какого плацдарма идёт и не перерезано ли.
        if (!b || b.attacker !== s.player) return '';
        const att = here.filter((f) => f.faction === s.player && f.origin);
        for (const f of att) {
          const o = s.galaxy.planets.get(f.origin!);
          if (!o) continue;
          const ok = o.owner === s.player && o.supplied && !o.shattered && p.links.includes(o.id);
          const blocked = ok && fleetsAt(s, o.id).some((h) => hostileNow(s, h.faction, s.player));
          return `<div class="pp-stat"><span>Снабжение атаки</span><b>${
            !ok ? '<span style="color:var(--fed)">⛔ плацдарм потерян</span>'
            : blocked ? `<span style="color:var(--fed)">⛔ ${o.name} блокирован врагом</span>`
            : `✓ с ${o.name}`}</b></div>`;
        }
        return '';
      })()}

      <div class="pp-stat"><span>Снабжение</span><b>${p.supplied ? (p.depot ? '▣ Точка снабжения' : '✓ Обеспечено') : '<span style="color:var(--fed)">⛔ ОКРУЖЕНИЕ</span>'}</b></div>
      <div class="pp-stat"><span>Гарнизон</span><b>${p.garrison.toFixed(0)}</b></div>
      <div class="pp-stat"><span>Укрепления</span><b>${'▮'.repeat(p.fortification)}${'▯'.repeat(5 - p.fortification)}</b></div>
      <div class="pp-stat"><span>Стратегическая ценность</span><b>${p.value}</b></div>
      <div class="pp-stat"><span>Корабли на орбите</span><b><span style="color:var(--se)">${playerFleets.length}</span> / <span style="color:var(--aut)">${intel ? enemyFleets.length : '?'}</span></b></div>
      ${p.puppetOf ? `<div class="pp-stat"><span>Статус</span><b style="color:var(--gold)">Марионетка ${FACTIONS[p.puppetOf].name === 'Супер-Земля' ? 'Супер-Земли' : FACTIONS[p.puppetOf].name} — сопротивления нет</b></div>` : ''}
      ${p.minerals > 0 ? `<div class="pp-stat"><span>Ископаемые</span><b>${'⛏'.repeat(p.minerals)} +${(p.minerals * (p.owner === 'automatons' ? 0.22 : 0.11)).toFixed(2)}/д${p.biome === 'magma' ? ' · магмовый мир' : ''}</b></div>` : ''}
      ${p.e711Rich ? `<div class="pp-stat"><span>Е-711</span><b style="color:var(--gold)">Богатые залежи</b></div>` : p.origin === 'terminids' && p.owner === 'superEarth' ? `<div class="pp-stat"><span>Е-711</span><b>Следы залежей</b></div>` : ''}
      ${(p.wreckage ?? 0) > 1 ? `<div class="pp-stat"><span>Орбита</span><b>☄ Поле обломков (${(p.wreckage ?? 0).toFixed(0)} корп.)</b></div>` : ''}
      ${p.buildings.length ? `<div class="pp-stat"><span>Сооружения</span><b>${p.buildings.map((bld) => bld === 'incinFactory' ? '🏭 Фабрика испепеляющего отряда' : bld === 'jetFactory' ? '🏭 Фабрика реактивного батальона' : bld === 'termicide' ? '☠ Система термицида' : bld === 'specialDock' ? '◆ Особая верфь и сервисный док' : bld === 'e711Station' ? '⛽ Станция добычи Е-711' : bld === 'shieldGen' ? '🛡 Планетарный щит' : bld === 'orbStation' ? '🛰 Орбитальная станция' : bld).join('<br>')}</b></div>` : ''}`;

    if (p.shipyard) {
      const q = p.shipyard.queue;
      const qdef = q ? SHIP_CLASSES.find((c) => c.id === q.cls) : null;
      html += `<div class="pp-stat"><span>⚓ Верфь</span><b>${q && qdef ? `${qdef.name} · ${q.daysLeft} дн` : storedHulls(p.shipyard) > 0 ? `Склад: ${storedHulls(p.shipyard)} корп.` : 'Стапель свободен'}</b></div>`;
    }
    if (p.owner === s.player && !p.depot) {
      const can = s.factions[s.player].production >= DEPOT_COST;
      html += `<button class="mini-btn wide ${can ? '' : 'off'}" data-act="depot" ${can ? '' : 'disabled'}>▣ Построить точку снабжения (${DEPOT_COST} пр. · есть ${s.factions[s.player].production.toFixed(0)})</button>`;
      // Добровольная передача мира: дорогой, но сильный дипломатический жест.
      if (!p.isCapital && !p.battle) {
        const takers = FACTION_IDS.filter((f2) => f2 !== s.player && s.factions[f2].alive && canNegotiate(s.player, f2));
        if (takers.length) {
          const canCede = s.factions[s.player].politicalPower >= CEDE_COST;
          html += `<div class="pp-section">Передать мир</div>
            <div class="hint">Дар соседу резко улучшает отношения. Столицу и планету под огнём передать нельзя.</div>
            <div class="cede-row">${takers.map((f2) => `<button class="mini-btn ${canCede ? '' : 'off'}" data-cede="${f2}" ${canCede ? '' : 'disabled'} title="Передать ${p.name} фракции «${FACTIONS[f2].name}» за ${CEDE_COST} ПВ" style="border-color:${factionColor(f2)}">${FACTIONS[f2].short}</button>`).join('')}</div>`;
        }
      }
    }
    if (p.owner === s.player && !p.shipyard && p.supplied) {
      const can = s.factions[s.player].production >= SHIPYARD_COST;
      html += `<button class="mini-btn wide ${can ? '' : 'off'}" data-act="yard" ${can ? '' : 'disabled'}>⚓ Построить верфь (${SHIPYARD_COST} пр.)</button>`;
    }
    // Оборонительные сооружения: щит и орбитальная станция.
    if (p.owner === s.player && p.supplied && !p.buildings.includes('shieldGen')) {
      const can = s.factions[s.player].production >= SHIELD_COST;
      html += `<button class="mini-btn wide ${can ? '' : 'off'}" data-act="shield" ${can ? '' : 'disabled'}>🛡 Планетарный щит (${SHIELD_COST} пр.) — вторжение вязнет вдвое</button>`;
    }
    if (p.owner === s.player && p.supplied && !p.buildings.includes('orbStation')) {
      const can = s.factions[s.player].production >= STATION_COST;
      html += `<button class="mini-btn wide ${can ? '' : 'off'}" data-act="station" ${can ? '' : 'disabled'}>🛰 Орбитальная станция (${STATION_COST} пр.) — бьёт по чужим флотам</button>`;
    }
    // Спецоперации: активный режим подсвечивает пригодные цели.
    if (this.opMode === 'sabotage' && canSabotage(s, s.player, p)) {
      html += `<button class="mini-btn wide" data-act="op-sabotage" style="border-color:var(--gold)">🗡 ДИВЕРСИЯ: взорвать верфь ${p.name}</button>`;
    }
    if (this.opMode === 'recon' && !reconActive(s, p.sector)) {
      html += `<button class="mini-btn wide" data-act="op-recon" style="border-color:var(--gold)">👁 РАЗВЕДКА: вскрыть сектор ${p.sector}</button>`;
    }
    if (this.opMode === 'uprising' && canUprising(s, s.player, p)) {
      html += `<button class="mini-btn wide" data-act="op-uprising" style="border-color:var(--gold)">✊ АГИТАЦИЯ: поднять восстание на ${p.name}</button>`;
    }
    // Сервисный док супероружия: нужны чертежи, единственный на фракцию.
    if (p.owner === s.player && s.factions[s.player].specialUnlocked && p.supplied
        && !specialDockWorld(s, s.player) && !p.buildings.includes('specialDock')) {
      const can = s.factions[s.player].production >= SPECIAL_DOCK_COST;
      html += `<button class="mini-btn wide ${can ? '' : 'off'}" data-act="specialdock" ${can ? '' : 'disabled'}>◆ Особая верфь и сервисный док (${SPECIAL_DOCK_COST} пр.) — восстановление супероружия вдвое дешевле</button>`;
    }
    // Станция добычи Е-711 на жучьей марионетке.
    if (s.player === 'superEarth' && p.puppetOf === 'superEarth' && !p.buildings.includes('e711Station')) {
      const can = s.factions.superEarth.production >= E711_STATION_COST;
      html += `<button class="mini-btn wide ${can ? '' : 'off'}" data-act="e711station" ${can ? '' : 'disabled'}>⛽ Станция добычи Е-711 (${E711_STATION_COST} пр. · +0.7/д)</button>`;
    }
    if (this.spireMode && p.owner === 'illuminate' && s.player === 'illuminate') {
      html += `<button class="mini-btn wide" data-act="spire">▲ Воздвигнуть экзошпиль</button>`;
    }
    if (this.gloomMode && s.player === 'terminids' && p.owner === 'terminids' && !p.gloom && sectorFullyOwned(s, p.id, 'terminids')) {
      html += `<button class="mini-btn wide" data-act="gloomseed">☁ Заронить зачаток Мрака (60 дн)</button>`;
    }
    if (this.termicideMode && s.player === 'superEarth' && p.owner === 'superEarth' && !p.buildings.includes('termicide')) {
      html += `<button class="mini-btn wide" data-act="termicide">☠ Установить термицид (${TERMICIDE_COST} пр.)</button>`;
    }
    // Планетарный залп: своя станция на орбите чужой планеты.
    const stationHere = playerFleets.some((f) => f.special);
    if (stationHere && p.owner !== s.player && (s.player === 'superEarth' || s.player === 'automatons')) {
      const ready = superShotReadyIn(s, s.player);
      html += ready === 0
        ? `<button class="mini-btn wide" data-act="fire" style="border-color:var(--fed);color:var(--fed)">☄ ОРБИТАЛЬНЫЙ ЗАЛП — УНИЧТОЖИТЬ ПЛАНЕТУ</button>`
        : `<button class="mini-btn wide off" disabled>☄ Орудие перезаряжается: ещё ${ready} дн</button>`;
    }

    if (p.cities.length) {
      html += `<div class="pp-section">Города</div>`;
      p.cities.forEach((c) => {
        const spec = c.spec === 'yard' ? '⚓ верфь −25% срока' : c.spec === 'academy' ? '🎓 академия +пополнение' : c.spec === 'mine' ? '⛏ шахта +руда' : '';
        html += `<div class="pp-stat"><span>🏙 ${c.name}${spec ? ` <span style="color:var(--muted);font-size:0.7rem">· ${spec}</span>` : ''}</span><b><span class="fac-dot" style="background:${factionColor(c.holder)}"></span> ${FACTIONS[c.holder].short}</b></div>`;
      });
    }

    // Заготовка атаки: со своего мира на смежный вражеский.
    if (p.owner === s.player) {
      const hostiles = p.links
        .map((lid) => s.galaxy.planets.get(lid)!)
        .filter((n) => n && hostileNow(s, s.player, n.owner) && !n.shattered && canEnter(s, s.player, n));
      const plansFrom = s.attackPlans.filter((pl) => pl.from === p.id);
      if (hostiles.length || plansFrom.length) {
        html += `<div class="pp-section">Заготовка атаки</div>`;
        for (const pl of plansFrom) {
          const t = s.galaxy.planets.get(pl.to)!;
          html += `<div class="fleet-row"><div class="grow">⇶ План: <b style="color:${factionColor(t.owner)}">${t.name}</b></div>
            <button class="mini-btn" data-act="launch" data-target="${pl.to}">▶ АТАКА</button>
            <button class="mini-btn" data-act="unplan" data-target="${pl.to}">✕</button></div>`;
        }
        for (const h of hostiles) {
          if (plansFrom.some((pl) => pl.to === h.id)) continue;
          html += `<button class="mini-btn wide" data-act="plan" data-target="${h.id}">⇶ Планировать атаку: ${h.name} (${FACTIONS[h.owner].short})</button>`;
        }
        if (playerFleets.length === 0) {
          html += `<div class="hint">Разместите здесь соединения — атака пойдёт с этого плацдарма.</div>`;
        }
      }
    }

    html += `<div class="pp-section">Ваши силы здесь</div>`;
    if (playerFleets.length === 0) html += `<div class="hint">Ваших флотов на орбите нет.</div>`;
    playerFleets.forEach((f) => {
      const selCls = s.selectedFleet === f.id || this.selectedFleets.has(f.id) ? 'sel' : '';
      const badge = f.special ? `<span style="color:var(--gold)">◆ ${f.special === 'ark' ? 'Ковчег автоматонов' : SPECIALS[f.faction].name}</span>` : '🚀 Супер-эсминец';
      const rank = rankOf(f);
      html += `<div class="fleet-row ${selCls}" data-fleet="${f.id}">
        <div class="grow"><div>${badge}${rank.badge ? ` <span style="color:var(--gold)" title="${rank.name}">${rank.badge}</span>` : ''}</div>
          <div style="color:var(--muted);font-size:0.7rem">Эсминцы ${f.ships.toFixed(0)}${f.dreadnoughts ? ' · ДРД ' + f.dreadnoughts.toFixed(0) : ''}${f.battleships ? ' · ЛКР ' + f.battleships.toFixed(0) : ''} · Пехота ${f.infantry.toFixed(0)}</div></div>
        <button class="mini-btn" data-act="select" data-fleet="${f.id}">${s.selectedFleet === f.id || this.selectedFleets.has(f.id) ? '✓ ВЫБРАН' : 'ВЫБРАТЬ'}</button>
        ${(p.owner === s.player || (p.battle && p.battle.attacker === s.player)) && f.infantry > 0 ? `<button class="mini-btn" data-act="deploy" data-fleet="${f.id}">ВЫСАДИТЬ</button>` : ''}
        ${p.owner === s.player && p.shipyard && storedHulls(p.shipyard) > 0 ? `<button class="mini-btn" data-act="takeyard" data-fleet="${f.id}">⚓ С ВЕРФИ</button>` : ''}
      </div>`;
    });

    if (enemyFleets.length) {
      html += `<div class="pp-section">Противник на орбите</div>`;
      enemyFleets.forEach((f) => {
        html += `<div class="fleet-row"><div class="grow"><div style="color:${factionColor(f.faction)}">
          ${f.special ? '◆ ' + (f.special === 'ark' ? 'Ковчег автоматонов' : SPECIALS[f.faction].name) : 'Флот ' + FACTION_GEN[f.faction]}</div>
          <div style="color:var(--muted);font-size:0.7rem">Корабли ${f.ships.toFixed(0)} · Пехота ${f.infantry.toFixed(0)}</div></div></div>`;
      });
    }

    html += `<div class="hint">${s.selectedFleet || this.selectedFleets.size
      ? 'Силы выбраны — ПКМ по планете отдаст приказ на перелёт/вторжение.'
      : 'ВЫБРАТЬ — один флот, Shift+ВЫБРАТЬ — несколько. Приказ — ПКМ по цели. ЛКМ только открывает информацию.'}</div>
      </div>`;

    this.panel.innerHTML = html;
    this.applyCardPos();
    this.wireCard(p);
  }

  /** Позиционирование и перетаскивание карточки. */
  private applyCardPos(): void {
    if (this.cardPos) {
      this.panel.style.left = `${this.cardPos.x}px`;
      this.panel.style.top = `${this.cardPos.y}px`;
      this.panel.style.transform = 'none';
    } else {
      this.panel.style.left = '50%';
      this.panel.style.top = '50%';
      this.panel.style.transform = 'translate(-50%, -50%)';
    }
  }

  private wireCard(p: Planet): void {
    const s = this.state;
    this.panel.querySelector('#pc-close')?.addEventListener('click', () => {
      s.selectedPlanet = null;
      this.scene.setSelected(null);
      this.renderPanel();
    });

    // Перетаскивание за заголовок.
    const head = this.panel.querySelector<HTMLElement>('#pc-drag');
    if (head) {
      head.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).id === 'pc-close') return;
        e.preventDefault();
        const rect = this.panel.getBoundingClientRect();
        const offX = e.clientX - rect.left;
        const offY = e.clientY - rect.top;
        const move = (ev: PointerEvent) => {
          this.cardPos = {
            x: Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - offX)),
            y: Math.max(0, Math.min(window.innerHeight - 80, ev.clientY - offY)),
          };
          this.applyCardPos();
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    }

    this.panel.querySelectorAll<HTMLButtonElement>('[data-cede]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cedePlanet(s, s.player, btn.dataset.cede as FactionId, p.id)) {
          this.sound.chime();
          this.toast('МИР ПЕРЕДАН СОЮЗНИКУ');
          this.renderPanel();
          this.renderHud();
        }
      });
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'depot') {
          if (buildDepot(s, s.player, p.id)) {
            this.toast('ТОЧКА СНАБЖЕНИЯ РАЗВЁРНУТА');
            this.renderPanel();
            this.renderStability();
          }
          return;
        }
        if (act === 'yard') {
          if (buildShipyard(s, s.player, p.id)) {
            this.toast('ВЕРФЬ РАЗВЁРНУТА · ЗАКАЗЫ — В «⚒ ПРОИЗВОДСТВО»');
            this.renderPanel();
          }
          return;
        }
        if (act === 'shield') {
          if (buildShield(s, s.player, p.id)) {
            this.toast('ПЛАНЕТАРНЫЙ ЩИТ РАЗВЁРНУТ');
            this.renderPanel();
            this.renderHud();
          }
          return;
        }
        if (act === 'station') {
          if (buildStation(s, s.player, p.id)) {
            this.toast('ОРБИТАЛЬНАЯ СТАНЦИЯ СОБРАНА');
            this.renderPanel();
            this.renderHud();
          }
          return;
        }
        if (act === 'op-sabotage' || act === 'op-recon' || act === 'op-uprising') {
          const op = act.slice(3);
          const done = op === 'sabotage' ? runSabotage(s, s.player, p.id)
            : op === 'recon' ? runRecon(s, s.player, p.id)
            : runUprising(s, s.player, p.id);
          if (done) {
            this.opMode = null;
            this.sound.chime();
            this.toast(op === 'sabotage' ? '🗡 ДИВЕРСИЯ ВЫПОЛНЕНА' : op === 'recon' ? '👁 СЕКТОР ВСКРЫТ НА 30 ДНЕЙ' : '✊ ВОССТАНИЕ ПОДНЯТО');
            this.scene.refreshOwners();
            this.renderPanel();
            this.renderHud();
            if (!this.dossierEl.classList.contains('hidden')) this.renderDossier();
          } else {
            this.toast('ОПЕРАЦИЯ НЕВОЗМОЖНА: НЕТ ПВ ИЛИ КУЛДАУН');
          }
          return;
        }
        if (act === 'specialdock') {
          if (buildSpecialDock(s, s.player, p.id)) {
            this.toast('СЕРВИСНЫЙ ДОК СУПЕРОРУЖИЯ РАЗВЁРНУТ');
            this.renderPanel();
            this.renderHud();
          }
          return;
        }
        if (act === 'e711station') {
          if (buildE711Station(s, p.id)) {
            this.toast('СТАНЦИЯ ДОБЫЧИ Е-711 РАЗВЁРНУТА');
            this.renderPanel();
            this.renderHud();
          }
          return;
        }
        if (act === 'plan') {
          const to = btn.dataset.target!;
          if (!s.attackPlans.some((pl) => pl.from === p.id && pl.to === to)) {
            s.attackPlans.push({ from: p.id, to });
            this.toast('АТАКА ЗАГОТОВЛЕНА · РАЗМЕЩАЙТЕ СИЛЫ НА ПЛАЦДАРМЕ');
          }
          this.renderPanel();
          return;
        }
        if (act === 'unplan') {
          s.attackPlans = s.attackPlans.filter((pl) => !(pl.from === p.id && pl.to === btn.dataset.target));
          this.toast('ПЛАН АТАКИ ОТМЕНЁН');
          this.renderPanel();
          return;
        }
        if (act === 'launch') {
          const to = btn.dataset.target!;
          const dest = s.galaxy.planets.get(to);
          if (!dest) return;
          let sent = 0;
          for (const f of fleetsAt(s, p.id).filter((fl) => fl.faction === s.player)) {
            if (orderFleetTo(s, f, to, true)) sent++;
          }
          this.toast(sent
            ? `АТАКА НАЧАЛАСЬ: ${sent} СОЕД. → ${dest.name}`
            : 'НА ПЛАЦДАРМЕ НЕТ СОЕДИНЕНИЙ');
          this.renderPanel();
          this.renderForces();
          return;
        }
        if (act === 'fire') {
          if (fireSuperweapon(s, s.player, p.id)) {
            this.sound.thud();
            this.toast(`☄ ${p.name} — ПЛАНЕТА УНИЧТОЖЕНА`, 3500);
            this.scene.refreshOwners();
            this.renderPanel();
          }
          return;
        }
        if (act === 'gloomseed') {
          if (plantGloomSeed(s, p.id)) {
            this.gloomMode = false;
            this.toast('ЗАЧАТОК МРАКА ЗАРОНЁН');
            this.renderPanel();
          }
          return;
        }
        if (act === 'termicide') {
          if (installTermicide(s, p.id)) {
            this.termicideMode = false;
            this.toast('ТЕРМИЦИД РАЗВЁРНУТ');
            this.renderPanel();
          }
          return;
        }
        if (act === 'spire') {
          if (raiseSpire(s, p.id)) {
            this.spireMode = false;
            this.toast('ЭКЗОШПИЛЬ ВОЗДВИГНУТ');
            this.renderPanel();
          }
          return;
        }
        const fid = btn.dataset.fleet!;
        const fleet = s.fleets.get(fid);
        if (!fleet) return;
        if (act === 'select') {
          if ((e as MouseEvent).shiftKey) {
            // Shift+ЛКМ: набираем несколько соединений, затем ПКМ по цели.
            if (this.selectedFleets.has(fid)) this.selectedFleets.delete(fid);
            else this.selectedFleets.add(fid);
          } else {
            s.selectedFleet = s.selectedFleet === fid ? null : fid;
          }
          this.renderPanel();
          this.renderForces();
        } else if (act === 'deploy') {
          garrisonReinforce(s, fleet);
          this.scene.refreshOwners();
          this.renderPanel();
        } else if (act === 'takeyard') {
          if (takeStoredShips(s, fleet)) {
            this.toast('КОРАБЛИ ПРИНЯТЫ С ВЕРФИ');
            this.renderPanel();
            this.renderForces();
          }
        }
      });
    });
  }

  // ---------------- Нижняя панель сил (флот / армия / спецтех) ----------------

  /** В какой группе состоит соединение (для значка на карточке). */
  private groupOf(fid: string): number | null {
    for (const [slot, ids] of this.groups) if (ids.includes(fid)) return slot;
    return null;
  }

  /** Человекочитаемое имя соединения. */
  private fleetName(fid: string): string {
    const f = this.state.fleets.get(fid);
    if (!f) return fid;
    if (f.special === 'ark') return 'КОВЧЕГ АВТОМАТОНОВ';
    if (f.special) return SPECIALS[f.faction].name;
    const n = Number(fid.replace('f_', ''));
    return `Соединение №${Number.isFinite(n) ? n + 1 : '?'}`;
  }

  private renderForces(): void {
    const s = this.state;
    const tabs = [
      { id: 'fleet' as const, icon: ICON_DESTROYER, title: 'Флот' },
      { id: 'army' as const, icon: ICON_HELMET, title: 'Наземные войска' },
      { id: 'special' as const, icon: '◆', title: 'Особые технологии' },
    ];
    let cards = '';
    if (this.forcesOpen) {
      if (this.forcesTab === 'fleet') {
        const fleets = fleetsOf(s, s.player);
        cards = fleets.map((f) => {
          const at = s.galaxy.planets.get(f.transit ? f.transit.to : f.at);
          const where = f.transit ? `→ ${at?.name ?? '?'}` : at?.name ?? '?';
          const multi = this.selectedFleets.has(f.id);
          const open = this.detailFleet === f.id;
          const rank = rankOf(f);
          const qn = f.orderQueue?.length ?? 0;
          const hulls = f.ships + f.dreadnoughts + f.battleships;
          // Крупный значок тяжелейшего класса: ✦ линкор, ◈ дредноут, силуэт эсминца.
          const clsIcon = f.special ? '◆' : f.battleships >= 1 ? '✦' : f.dreadnoughts >= 1 ? '◈' : ICON_DESTROYER;
          const num = this.fleetName(f.id).replace('Соединение ', '');
          // Номер группы прямо на карточке — так видно, что цифры на клавиатуре
          // вообще что-то делают, и не нужно ничего объяснять словами.
          const slot = this.groupOf(f.id);
          return `<div class="force-card ${open ? 'open' : ''} ${multi ? 'multi' : ''}" data-card-fleet="${f.id}">
            ${slot ? `<div class="fc-group">${slot}</div>` : ''}
            <div class="fc-ico">${clsIcon}</div>
            <div class="fc-name">${num}${f.commander ? ' ★' : ''}${rank.badge ? ` <span style="color:var(--gold)" title="${rank.name}">${rank.badge}</span>` : ''}${multi ? ' <span class="fc-check">✓</span>' : ''}</div>
            <div class="fc-comp">${hulls.toFixed(0)} корп · ${f.infantry.toFixed(0)} пех</div>
            <div class="fc-loc">${f.transit ? '⇢ ' : ''}${where}${qn ? ` <b style="color:var(--gold)">+${qn}</b>` : ''}</div>
          </div>`;
        }).join('') || '<div class="force-empty">Флотов нет — стройте корабли на верфях (⚒)</div>';
      } else if (this.forcesTab === 'army') {
        const fs = s.factions[s.player];
        cards = troopsOf(s.player).map((t) => {
          const pool = fs.units[t.id] ?? 0;
          const art = unitIcon(t.id);
          return `<div class="force-card static">
            <div class="fc-ico">${art ? `<img class="fc-art" src="${art}" alt="">` : '⛊'}</div>
            <div class="fc-name">${t.name}</div>
            <div class="fc-comp">${pool.toFixed(0)}</div>
            <div class="fc-loc">${ROLE_LABEL[t.role]}</div>
          </div>`;
        }).join('');
      } else {
        const fs = s.factions[s.player];
        const sp = SPECIALS[s.player];
        const station = fleetsOf(s, s.player).find((f) => f.special);
        // Короткая строка для карточки и полная — под ней.
        let state: string;
        let where: string;
        if (!fs.specialUnlocked) {
          state = 'НЕ ОТКРЫТА';
          where = 'откройте в древе фокусов';
        } else if (fs.lostSpecial) {
          state = '<b style="color:var(--fed)">УНИЧТОЖЕНА</b>';
          where = 'восстановление в «Решениях»';
        } else if (station) {
          const at = s.galaxy.planets.get(station.transit ? station.transit.to : station.at);
          state = 'В СТРОЮ';
          where = `${station.transit ? '⇢ ' : ''}${at?.name ?? '?'}`;
        } else {
          state = 'НЕТ СВЯЗИ';
          where = 'положение неизвестно';
        }
        const ready = superShotReadyIn(s, s.player);
        const art = unitIcon(sp.id);
        const dead = fs.specialUnlocked && fs.lostSpecial;
        // Карточка супероружия — та же геометрия, что у флотской: значок сверху,
        // название, состояние. Полное имя и описание уходят в подсказку.
        cards = `<div class="force-card static ${dead ? 'lost' : ''}" title="${esc(sp.name)} — ${esc(sp.blurb)}">
            <div class="fc-ico">${art ? `<img class="fc-art" src="${art}" alt="">` : '◆'}</div>
            <div class="fc-name">${SPECIAL_SHORT[sp.id] ?? sp.name}</div>
            <div class="fc-comp">${state}</div>
            <div class="fc-loc">${where}</div>
          </div>`;
        if (fs.specialUnlocked && !fs.lostSpecial && (s.player === 'superEarth' || s.player === 'automatons')) {
          cards += `<div class="force-card static" title="Планетарный залп супероружия">
            <div class="fc-ico">☄</div>
            <div class="fc-name">Залп</div>
            <div class="fc-comp">${ready === 0 ? '<b style="color:var(--gold)">ЗАРЯЖЕН</b>' : ready + ' дн'}</div>
            <div class="fc-loc">${ready === 0 ? 'готов к удару' : 'перезарядка'}</div>
          </div>`;
        }
      }
    }
    this.forcesEl.innerHTML = `
      <div class="forces-cards" ${this.forcesOpen ? '' : 'style="display:none"'}>${cards}</div>
      <div class="forces-tabs">
        ${tabs.map((t) => `<button class="forces-tab ${this.forcesOpen && this.forcesTab === t.id ? 'active' : ''}" data-tab="${t.id}" title="${t.title}">${t.icon}</button>`).join('')}
      </div>`;

    this.forcesEl.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        const tab = b.dataset.tab as 'fleet' | 'army' | 'special';
        if (this.forcesOpen && this.forcesTab === tab) this.forcesOpen = false;
        else { this.forcesOpen = true; this.forcesTab = tab; }
        this.renderForces();
      }));
    this.forcesEl.querySelectorAll<HTMLElement>('[data-card-fleet]').forEach((card) =>
      card.addEventListener('click', (ev) => {
        const fid = card.dataset.cardFleet!;
        if (ev.shiftKey) {
          // Мультивыбор: щёлкаем несколько карточек с Shift.
          if (this.selectedFleets.has(fid)) this.selectedFleets.delete(fid);
          else this.selectedFleets.add(fid);
          this.renderForces();
          return;
        }
        this.detailFleet = this.detailFleet === fid ? null : fid;
        this.state.selectedFleet = this.detailFleet;
        const f = this.state.fleets.get(fid);
        if (f && !f.transit) this.scene.focusOn(f.at);
        this.renderForces();
        this.renderFleetDetail();
      }));
  }

  /** Левая панель: состав открытого соединения и операции над ним. */
  private renderFleetDetail(): void {
    const s = this.state;
    const f = this.detailFleet ? s.fleets.get(this.detailFleet) : null;
    if (!f) {
      this.fleetDetailEl.classList.add('hidden');
      this.detailFleet = null;
      return;
    }
    this.fleetDetailEl.classList.remove('hidden');
    const at = s.galaxy.planets.get(f.transit ? f.transit.to : f.at);
    const yard = !f.transit && at && at.owner === s.player ? at.shipyard : undefined;
    const hulls = f.ships + f.dreadnoughts + f.battleships;
    this.fleetDetailEl.innerHTML = `
      <div class="pc-head"><span class="pc-title">${f.special ? '◆ ' : ''}${this.fleetName(f.id)}</span>
        <button class="pc-close" id="fd-close">✕</button></div>
      <div class="pc-body">
        <div class="pp-sub">${f.transit ? `В пути → ${at?.name ?? '?'}` : `На орбите: ${at?.name ?? '?'}`}${lockedInBattle(s, f) ? ' · <span style="color:var(--fed)">⚔ СКОВАНО БОЕМ</span>' : ''}</div>
        <div class="pp-stat"><span>Супер-эсминцы</span><b>${f.ships.toFixed(0)}</b></div>
        <div class="pp-stat"><span>Дредноуты</span><b>${f.dreadnoughts.toFixed(0)}</b></div>
        <div class="pp-stat"><span>Линкоры-флагманы</span><b>${f.battleships.toFixed(0)}</b></div>
        <div class="pp-stat"><span>Пехота на борту</span><b>${f.infantry.toFixed(0)}</b></div>
        ${f.special ? `<div class="hint">◆ Несёт супероружие фракции.</div>` : ''}
        ${(() => {
          const rank = rankOf(f);
          const next = nextRankIn(f);
          return `<div class="pp-stat"><span>Выучка</span><b style="color:var(--gold)">${rank.badge ? rank.badge + ' ' : ''}${rank.name}</b></div>
            <div class="hint" style="margin-top:2px">Опыт ${(f.xp ?? 0).toFixed(0)}${next !== null ? ` · до следующего ранга ${next.toFixed(0)}` : ' · максимальный ранг'}${rank.mult > 1 ? ` · бой и захват +${Math.round((rank.mult - 1) * 100)}%` : ''}</div>`;
        })()}
        ${(() => { const c = commanderOf(f); return c ? `<div class="pp-stat"><span>Командир</span><b style="color:var(--gold)">${c.name}</b></div><div class="hint" style="margin-top:2px">${c.perk}</div>` : ''; })()}
        ${(() => {
          const q = f.orderQueue ?? [];
          if (!q.length) return '';
          return `<div class="pp-section">Очередь приказов</div>
            ${q.map((o, i) => {
              const t = s.galaxy.planets.get(o.target);
              return `<div class="pp-stat"><span>${i + 1}. ⇢ ${t?.name ?? '?'}</span><b style="color:${t ? factionColor(t.owner) : 'var(--muted)'}">${t ? FACTIONS[t.owner].short : ''}</b></div>`;
            }).join('')}
            <button class="mini-btn wide" id="fd-clearqueue">✕ Очистить очередь</button>`;
        })()}
        <div class="pp-section">Операции</div>
        <button class="mini-btn wide" id="fd-commander">★ ${commanderOf(f) ? 'Сменить/снять командира' : 'Назначить командира'}</button>
        <button class="mini-btn wide ${hulls >= 2 && !f.transit ? '' : 'off'}" id="fd-split" ${hulls >= 2 && !f.transit ? '' : 'disabled'}>⑂ Разделить пополам</button>
        ${yard && storedHulls(yard) > 0 ? `<button class="mini-btn wide" id="fd-take">⚓ Принять корабли с верфи (${storedHulls(yard)} корп.)</button>` : ''}
        <button class="mini-btn wide ${!f.transit && !f.special && at?.owner === s.player ? '' : 'off'}" id="fd-disband" ${!f.transit && !f.special && at?.owner === s.player ? '' : 'disabled'}>✕ Расформировать</button>
        <div class="hint">ПКМ по планете — приказ на перелёт/вторжение. Shift+ПКМ — добавить цель в очередь. Shift+клик по карточкам внизу — выбор нескольких соединений.</div>
      </div>`;

    this.fleetDetailEl.querySelector('#fd-close')?.addEventListener('click', () => {
      this.detailFleet = null;
      this.renderFleetDetail();
      this.renderForces();
    });
    this.fleetDetailEl.querySelector('#fd-clearqueue')?.addEventListener('click', () => {
      f.orderQueue = undefined;
      this.toast('ОЧЕРЕДЬ ПРИКАЗОВ ОЧИЩЕНА');
      this.renderFleetDetail();
      this.renderForces();
    });
    this.fleetDetailEl.querySelector('#fd-commander')?.addEventListener('click', () => {
      const c = cycleCommander(s, f);
      this.toast(c ? `КОМАНДИР: ${c.name.toUpperCase()}` : 'КОМАНДИР СНЯТ');
      this.renderFleetDetail();
      this.renderForces();
    });
    this.fleetDetailEl.querySelector('#fd-split')?.addEventListener('click', () => {
      const nf = splitFleet(s, f);
      if (nf) {
        this.toast('СОЕДИНЕНИЕ РАЗДЕЛЕНО');
        this.renderFleetDetail();
        this.renderForces();
      }
    });
    this.fleetDetailEl.querySelector('#fd-take')?.addEventListener('click', () => {
      if (takeStoredShips(s, f)) {
        this.toast('КОРАБЛИ ПРИНЯТЫ С ВЕРФИ');
        this.renderFleetDetail();
        this.renderForces();
      }
    });
    this.fleetDetailEl.querySelector('#fd-disband')?.addEventListener('click', () => {
      if (disbandFleet(s, f)) {
        this.toast('СОЕДИНЕНИЕ РАСФОРМИРОВАНО');
        this.detailFleet = null;
        this.selectedFleets.delete(f.id);
        this.renderFleetDetail();
        this.renderForces();
        this.renderStability();
      }
    });
  }

  // ---------------- Рамка выделения и групповые приказы ----------------

  private onBoxSelected(ids: string[]): void {
    this.boxPlanets = ids;
    this.scene.setBoxSelected(ids);
    if (!ids.length) {
      this.boxActionsEl.classList.add('hidden');
      return;
    }
    this.boxActionsEl.classList.remove('hidden');
    this.boxActionsEl.innerHTML = `
      <span>Выделено планет: <b>${ids.length}</b></span>
      <button class="mini-btn" id="box-distribute">⇶ РАСПРЕДЕЛИТЬ ВОЙСКА</button>
      <button class="pc-close" id="box-clear">✕</button>`;
    this.boxActionsEl.querySelector('#box-distribute')?.addEventListener('click', () => this.distributeFleets());
    this.boxActionsEl.querySelector('#box-clear')?.addEventListener('click', () => this.onBoxSelected([]));
  }

  /** Равномерно распределить флоты игрока по выделенным планетам. */
  private distributeFleets(): void {
    const s = this.state;
    const targets = this.boxPlanets
      .map((id) => s.galaxy.planets.get(id)!)
      .filter((p) => p && !p.shattered && canEnter(s, s.player, p));
    if (!targets.length) {
      this.toast('НЕТ ДОСТУПНЫХ ПЛАНЕТ В ВЫДЕЛЕНИИ');
      return;
    }
    // Супероружие в авторазвод не идёт — им командуют только вручную.
    const fleets = fleetsOf(s, s.player).filter((f) => !f.special);
    if (!fleets.length) {
      this.toast('НЕТ СОЕДИНЕНИЙ ДЛЯ РАСПРЕДЕЛЕНИЯ');
      return;
    }
    const load = new Map<string, number>(targets.map((p) => [p.id, 0]));
    let sent = 0;
    // Крупные соединения назначаем первыми — распределение выходит ровнее.
    const byPower = [...fleets].sort((a, b) =>
      (b.ships + b.dreadnoughts * 3 + b.battleships * 6) - (a.ships + a.dreadnoughts * 3 + a.battleships * 6));
    for (const f of byPower) {
      const from = s.galaxy.planets.get(f.transit ? f.transit.from : f.at);
      if (!from) continue;
      // Наименее нагруженная цель; при равенстве — ближайшая.
      const best = [...targets].sort((a, b) => {
        const la = load.get(a.id)!, lb = load.get(b.id)!;
        if (la !== lb) return la - lb;
        const da = Math.hypot(a.pos.x - from.pos.x, a.pos.y - from.pos.y);
        const db = Math.hypot(b.pos.x - from.pos.x, b.pos.y - from.pos.y);
        return da - db;
      })[0]!;
      const invade = hostileNow(s, s.player, best.owner) && best.owner !== s.player;
      if (f.at === best.id && !f.transit) {
        load.set(best.id, load.get(best.id)! + 1);
        continue;
      }
      if (orderFleetTo(s, f, best.id, invade)) {
        load.set(best.id, load.get(best.id)! + 1);
        sent++;
      }
    }
    this.toast(sent ? `ВОЙСКА РАСПРЕДЕЛЕНЫ: ${sent} СОЕДИНЕНИЙ → ${targets.length} ПЛАНЕТ` : 'НЕТ МАРШРУТОВ К ЦЕЛЯМ');
    this.onBoxSelected([]);
    this.renderForces();
  }

  /** ПКМ по планете: приказ всем выбранным соединениям (или одному выбранному).
   *  Shift+ПКМ — добавить цель в ОЧЕРЕДЬ приказов, не отменяя текущий. */
  private onPlanetRightClicked(id: string, queue = false): void {
    const s = this.state;
    const dest = s.galaxy.planets.get(id);
    if (!dest || dest.shattered) return;
    const picks = this.selectedFleets.size
      ? [...this.selectedFleets]
      : s.selectedFleet ? [s.selectedFleet] : [];
    if (!picks.length) return;
    const invade = hostileNow(s, s.player, dest.owner) && dest.owner !== s.player;
    let sent = 0;
    let queued = 0;
    let locked = 0;
    for (const fid of picks) {
      const f = s.fleets.get(fid);
      if (!f || f.faction !== s.player) continue;
      if (lockedInBattle(s, f)) { locked++; continue; }
      // Планировщик: занятый флот с Shift копит маршрут из целей.
      const busy = !!f.transit || (f.order && f.order.kind !== 'idle');
      if (queue && busy) {
        f.orderQueue = f.orderQueue ?? [];
        if (f.orderQueue.length < 6 && !f.orderQueue.some((q) => q.target === id)) {
          f.orderQueue.push({ target: id });
          queued++;
        }
        continue;
      }
      // Прямой приказ отменяет старую очередь — у флота новый план.
      if (!queue) f.orderQueue = undefined;
      if (orderFleetTo(s, f, id, invade)) sent++;
    }
    if (queued) {
      this.toast(`⇢ ЦЕЛЬ ДОБАВЛЕНА В ОЧЕРЕДЬ: ${dest.name} · ${queued} СОЕД.`);
      this.renderForces();
      if (this.detailFleet) this.renderFleetDetail();
      return;
    }
    if (sent) {
      this.toast(`ПРИКАЗ: ${invade ? 'ВТОРЖЕНИЕ' : 'ПЕРЕЛЁТ'} · ${dest.name} · ${sent} СОЕД.`);
      this.selectedFleets.clear();
      this.renderForces();
    } else if (locked) {
      this.toast('⚔ СОЕДИНЕНИЯ СКОВАНЫ БОЕМ — ОРБИТУ НЕ ПОКИНУТЬ');
    } else {
      this.toast('НЕТ МАРШРУТА СНАБЖЕНИЯ');
    }
  }

  // ---------------- Decisions ----------------

  private toggleDecisions(): void {
    const hidden = this.decisionsEl.classList.toggle('hidden');
    if (!hidden) this.renderDecisions();
  }

  private renderDecisions(): void {
    const s = this.state;
    const fs = s.factions[s.player];
    let html = `<div class="pc-head"><span class="pc-title">⚙ РЕШЕНИЯ</span>
      <button class="pc-close" id="dec-close">✕</button></div><div class="pc-body">`;

    html += `<div class="dec-item">
      <b>▣ Точки снабжения</b>
      <div class="hint">Стройте на своих планетах через карточку планеты (${DEPOT_COST} производства). Точка ускоряет пополнение гарнизона планеты и всех соседних своих миров.</div>
    </div>`;

    if (fs.specialUnlocked && fs.lostSpecial) {
      const can = fs.production >= SPECIAL_REBUILD_COST;
      html += `<div class="dec-item"><b style="color:var(--fed)">⚠ ${SPECIALS[s.player].name} — уничтожена</b>
        <div class="hint">Супероружие существует в единственном экземпляре. Восстановление — колоссальные затраты.</div>
        <button class="mini-btn wide ${can ? '' : 'off'}" id="dec-rebuild" ${can ? '' : 'disabled'}>Восстановить (${SPECIAL_REBUILD_COST} пр. · есть ${fs.production.toFixed(0)})</button></div>`;
    }

    if (s.player === 'superEarth' && !fs.flags.e711Mining) {
      const hasTermWorlds = s.galaxy.order.some((pid) => {
        const p = s.galaxy.planets.get(pid)!;
        return p.owner === 'superEarth' && (p.origin === 'terminids' || p.e711Rich);
      });
      if (hasTermWorlds) {
        const can = fs.production >= 40;
        html += `<div class="dec-item"><b>⛽ Развернуть добычу Е-711</b>
          <div class="hint">Освобождённые терминидские миры дают топливо для супер-эсминцев — а миры, вышедшие из Мрака, особенно богаты. Ускоряет производство флота.</div>
          <button class="mini-btn wide ${can ? '' : 'off'}" id="dec-e711" ${can ? '' : 'disabled'}>Развернуть (40 пр. · есть ${fs.production.toFixed(0)})</button></div>`;
      }
    }
    if (fs.flags.e711Mining) {
      html += `<div class="dec-item"><b>⛽ Добыча Е-711 — активна</b>
        <div class="hint">Запас: ${fs.resources.e711.toFixed(0)}. Топливо ускоряет производство флота.</div></div>`;
    }

    if (fs.flags.gloomTravel) {
      html += `<div class="dec-item"><b>☁ Прорыв Мрака — активен</b>
        <div class="hint">Флоты фракции могут входить в миры, окутанные Мраком.</div></div>`;
    }

    if (fs.flags.gloomSpread) {
      html += `<div class="dec-item"><b>☁ Зачаток Мрака</b>
        <div class="hint">Ставится через карточку своей планеты — но только в секторе, ПОЛНОСТЬЮ захваченном роем. Мрак зреет 60 дней. Зреет сейчас: ${s.gloomSeeds.length}.</div>
        <button class="mini-btn wide ${this.gloomMode ? 'sel' : ''}" id="dec-gloom">${this.gloomMode ? '✓ Режим выбора активен' : 'Выбрать планету'}</button></div>`;
    }

    if (fs.flags.termicide) {
      html += `<div class="dec-item"><b>☠ Система распространения термицида</b>
        <div class="hint">Ставится на своих планетах (${TERMICIDE_COST} пр.). Атакующий планету рой получает тяжелейшие потери.</div>
        <button class="mini-btn wide ${this.termicideMode ? 'sel' : ''}" id="dec-termicide">${this.termicideMode ? '✓ Режим выбора активен' : 'Выбрать планету'}</button></div>`;
    }



    if (fs.flags.abyss) {
      html += `<div class="dec-item"><b>▲ Экзошпиль Бездны</b>
        <div class="hint">Включите режим и нажмите «Воздвигнуть экзошпиль» в карточке своей планеты. Через 30 дней мир уйдёт в Бездну.</div>
        <button class="mini-btn wide ${this.spireMode ? 'sel' : ''}" id="dec-spire">${this.spireMode ? '✓ Режим выбора активен' : 'Выбрать планету'}</button></div>`;
    }

    html += `</div>`;
    this.decisionsEl.innerHTML = html;
    this.decisionsEl.querySelector('#dec-close')?.addEventListener('click', () => this.decisionsEl.classList.add('hidden'));
    this.decisionsEl.querySelector('#dec-gloom')?.addEventListener('click', () => {
      this.gloomMode = !this.gloomMode;
      this.renderDecisions();
      this.renderPanel();
    });
    this.decisionsEl.querySelector('#dec-termicide')?.addEventListener('click', () => {
      this.termicideMode = !this.termicideMode;
      this.renderDecisions();
      this.renderPanel();
    });

    this.decisionsEl.querySelector('#dec-rebuild')?.addEventListener('click', () => {
      if (rebuildSpecial(this.state, this.state.player)) {
        this.toast('СУПЕРОРУЖИЕ ВОССТАНОВЛЕНО');
        this.renderDecisions();
        this.renderStability();
      }
    });
    this.decisionsEl.querySelector('#dec-e711')?.addEventListener('click', () => {
      if (enableE711Mining(this.state)) {
        this.toast('ДОБЫЧА Е-711 РАЗВЁРНУТА');
        this.renderDecisions();
        this.renderStability();
      }
    });
    this.decisionsEl.querySelector('#dec-spire')?.addEventListener('click', () => {
      this.spireMode = !this.spireMode;
      this.renderDecisions();
      this.renderPanel();
    });
  }

  // ---------------- Focus tree ----------------

  private toggleFocus(): void {
    const hidden = this.focusOverlay.classList.toggle('hidden');
    if (!hidden) this.renderFocus();
  }

  /** Человекочитаемые строки эффектов фокуса. */
  private effectLines(n: (typeof FOCUS_TREES)['superEarth'][number]): string[] {
    const out: string[] = [];
    for (const e of n.effects) {
      switch (e.kind) {
        case 'warSupport': out.push(`${e.amount > 0 ? '+' : ''}${e.amount} поддержки войны`); break;
        case 'recruitment': out.push(`+${e.amount}% к пополнению войск`); break;
        case 'industry': out.push(`+${e.amount} промышленности`); break;
        case 'shipCap': out.push(`+${e.amount} к лимиту боевых соединений`); break;
        case 'combat': out.push(`+${Math.round(e.amount * 100)}% к боевой силе`); break;
        case 'fortify': out.push(`+${e.amount} к укреплениям миров`); break;
        case 'stability': out.push(`${e.amount > 0 ? '+' : ''}${e.amount} стабильности`); break;
        case 'manpower': out.push(`+${e.amount} массовой пехоты в пул`); break;
        case 'fleet': out.push(`Новое соединение: ${e.ships} кораблей, ${e.infantry} пехоты`); break;
        case 'unlockSpecial': out.push('Открывает СУПЕРОРУЖИЕ фракции'); break;
        case 'spawnSuperFederation': out.push('Поднимает Супер-Федерацию'); break;
        case 'arkArrival': out.push('Из тьмы прибывает КОВЧЕГ АВТОМАТОНОВ'); break;
        case 'production': out.push(`+${e.amount} очков производства разом`); break;
        case 'politicalPower': out.push(`+${e.amount} политической власти`); break;
        case 'resources': out.push(`Ресурсы: +${e.minerals} ⛏${e.e711 ? ` · +${e.e711} ⛽` : ''}`); break;
        case 'garrisonAll': out.push(`+${e.amount} гарнизона НА ВСЕХ мирах`); break;
        case 'fortifyAll': out.push(`+${e.amount} укреплений НА ВСЕХ мирах`); break;
        case 'xpAll': out.push(`+${e.amount} опыта всем соединениям`); break;
        case 'revealAll': out.push(`Разведка ВСЕЙ галактики на ${e.days} дн`); break;
        case 'truceAll': out.push(`Перемирие со всеми на ${e.days} дн`); break;
        case 'freeDefenses': out.push(`Щит и станция на ${e.count} ценнейших мирах`); break;
        case 'recallFleets': out.push('Все флоты мгновенно возвращаются к столице'); break;
        case 'gloomSurge': out.push('Все зачатки Мрака созревают НЕМЕДЛЕННО'); break;
        case 'heavyFleet': out.push(`Тяжёлое соединение: ${e.ships} ЭСМ, ${e.dreadnoughts} ДРД, ${e.battleships} ЛКР, ${e.infantry} пехоты`); break;
        case 'flag':
          out.push({
            gloomTravel: 'Флоты входят в миры, окутанные Мраком',
            gloomSpread: 'Решение: зачатки Мрака в полных секторах',
            abyss: 'Решение: экзошпили Бездны',
            e711Mining: 'Решение: добыча топлива Е-711',
            termicide: 'Решение: системы термицида',
            arkPrepared: 'Готовит ПРОЕКТ «КОВЧЕГ» на случай разгрома',
            arkGhost: '', arkDone: '',
          }[e.flag] || 'Особая способность');
          break;
        case 'custom': break;
      }
    }
    return out.filter(Boolean);
  }

  /** Дальняя связь: линию рисуем ТОЛЬКО к соседнему ряду и не дальше одной
   *  колонки вбок — всё остальное показывается текстовым требованием в окне
   *  фокуса. Длинные дуги «в никуда» через всё древо не рисуются. */
  private isRemoteRequire(n: { x: number; y: number }, r: { x: number; y: number }): boolean {
    return Math.abs(n.x - r.x) >= 2 || n.y - r.y !== 1;
  }

  /** Плавающее окно с описанием фокуса поверх древа. */
  private renderFocusInfo(focusId: string): void {
    const n = FOCUS_TREES[this.focusTab].find((f) => f.id === focusId);
    const box = this.focusOverlay.querySelector<HTMLElement>('#focus-info');
    if (!n || !box) return;
    const fs = this.state.factions[this.focusTab];
    const done = fs.completedFocus.includes(n.id);
    const active = fs.activeFocus?.id === n.id;
    const selectable = this.focusTab === this.state.player && canSelectFocus(this.state, this.focusTab, n);
    const status = done
      ? '<span style="color:#3ad07a">✓ Завершён</span>'
      : active
        ? `<span style="color:var(--gold)">▶ Выполняется · ещё ${Math.ceil(fs.activeFocus!.remaining)} дн</span>`
        : `${n.cost} дней`;

    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="fi-head">
        <img class="fi-icon" src="${focusIconURL(n)}" alt="">
        <div class="grow">
          <div class="fi-title">${n.title}</div>
          <div class="fi-status">${status}</div>
        </div>
        <button class="pc-close" id="fi-close">✕</button>
      </div>
      <div class="fi-desc">${n.desc}</div>
      ${(() => {
        // Требования из других веток (без линий) + невыполненные обычные.
        const tree = FOCUS_TREES[this.focusTab];
        const reqs = n.requires
          .map((rid) => tree.find((m) => m.id === rid))
          .filter((r): r is NonNullable<typeof r> => !!r)
          .filter((r) => this.isRemoteRequire(n, r) || !fs.completedFocus.includes(r.id));
        if (!reqs.length) return '';
        return `<div class="fi-reqs">Требуется: ${reqs.map((r) => {
          const ok = fs.completedFocus.includes(r.id);
          return `<span style="color:${ok ? '#3ad07a' : 'var(--fed)'}">${ok ? '✓' : '✕'} «${r.title}»</span>`;
        }).join(' · ')}</div>`;
      })()}
      ${this.effectLines(n).length ? `<div class="fi-effects">${this.effectLines(n).map((l) => `<div>◆ ${l}</div>`).join('')}</div>` : ''}
      ${selectable ? `<button class="mini-btn wide" id="fi-select">▶ НАЗНАЧИТЬ ФОКУС</button>` : ''}`;

    box.querySelector('#fi-close')?.addEventListener('click', () => box.classList.add('hidden'));
    box.querySelector('#fi-select')?.addEventListener('click', () => {
      if (selectFocus(this.state, this.state.player, n.id)) {
        this.toast('ФОКУС НАЗНАЧЕН');
        this.renderFocus();
        this.renderFocusInfo(n.id);
        this.renderHud();
      }
    });
  }

  private renderFocus(): void {
    const nodes = FOCUS_TREES[this.focusTab];
    const maxX = Math.max(...nodes.map((n) => n.x));
    const maxY = Math.max(...nodes.map((n) => n.y));
    const W = 126, H = 148;
    const NW = 104; // ширина узла
    const cw = (maxX + 1) * W + 40;
    const ch = (maxY + 1) * H + 60;
    const fs = this.state.factions[this.focusTab];

    const tabs = FACTION_IDS.map((f) =>
      `<div class="focus-tab ${f === this.focusTab ? 'active' : ''}" data-fac="${f}" style="border-color:${factionColor(f)}">${FACTIONS[f].short}</div>`
    ).join('');

    // connectors: от низа иконки родителя к верху узла-потомка.
    // Дальние связи (через всё древо) НЕ рисуются — они остаются логическим
    // требованием и показываются текстом в окне фокуса. Линии к скрытым
    // узлам (ветка Ковчега до падения Киберстана) тоже не рисуются.
    const arkShown = cyberstanLost(this.state);
    const hiddenNode = (m: { branch?: string }) => m.branch === 'ark' && !arkShown;
    const cx = (n: { x: number }) => n.x * W + 20 + NW / 2;
    let svg = `<svg class="focus-svg" width="${cw}" height="${ch}">`;
    for (const n of nodes) {
      if (hiddenNode(n)) continue;
      for (const req of n.requires) {
        const r = nodes.find((m) => m.id === req);
        if (!r) continue;
        if (hiddenNode(r)) continue;
        if (this.isRemoteRequire(n, r)) continue;
        const x1 = cx(r), y1 = r.y * H + 20 + 118;
        const x2 = cx(n), y2 = n.y * H + 20;
        const done = fs.completedFocus.includes(req);
        svg += `<path d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}"
          fill="none" stroke="${done ? '#3ad07a' : '#3a4d6e'}" stroke-width="2"/>`;
      }
    }
    svg += `</svg>`;

    let html = `<div class="focus-head">
      <h2>◈ НАЦИОНАЛЬНЫЙ ФОКУС</h2>
      <div class="focus-tabs">${tabs}</div>
      <button class="hud-btn" id="focus-close" style="margin-left:auto">✕ ЗАКРЫТЬ</button>
    </div><div class="focus-scroll"><div class="focus-canvas" style="width:${cw}px;height:${ch}px">${svg}`;

    const arkVisible = cyberstanLost(this.state);
    for (const n of nodes) {
      if (n.branch === 'ark' && !arkVisible) continue;
      const done = fs.completedFocus.includes(n.id);
      const active = fs.activeFocus?.id === n.id;
      const selectable = this.focusTab === this.state.player && canSelectFocus(this.state, this.focusTab, n);
      let cls = 'focus-node';
      if (n.branch === 'federation') cls += ' fed';
      if (done) cls += ' done';
      else if (active) cls += ' active';
      else if (selectable) cls += ' available';
      else cls += ' locked';
      const left = n.x * W + 20, top = n.y * H + 20;
      html += `<div class="${cls}" data-focus="${n.id}" style="left:${left}px;top:${top}px;width:${NW}px">
        <div class="fn-badge">${done ? '✓' : active ? '▶' : ''}</div>
        <img class="fn-icon" src="${focusIconURL(n)}" alt="" draggable="false">
        <div class="fn-name">${n.title}</div>
      </div>`;
    }
    html += `</div></div><div id="focus-info" class="hidden"></div>`;
    this.focusOverlay.innerHTML = html;

    this.focusOverlay.querySelector('#focus-close')!.addEventListener('click', () => this.focusOverlay.classList.add('hidden'));
    this.focusOverlay.querySelectorAll<HTMLElement>('.focus-tab').forEach((t) =>
      t.addEventListener('click', () => { this.focusTab = t.dataset.fac as FactionId; this.renderFocus(); }));
    // Клик по любому узлу открывает плавающее окно с описанием и кнопкой.
    this.focusOverlay.querySelectorAll<HTMLElement>('.focus-node').forEach((node) =>
      node.addEventListener('click', () => this.renderFocusInfo(node.dataset.focus!)));
  }

  // ---------------- Производство ----------------

  private toggleProduction(): void {
    const hidden = this.productionEl.classList.toggle('hidden');
    if (!hidden) this.renderProduction();
  }

  private renderProduction(): void {
    const s = this.state;
    const fs = s.factions[s.player];
    let html = `<div class="pc-head"><span class="pc-title">⚒ ПРОИЗВОДСТВО</span>
      <button class="pc-close" id="prod-close">✕</button></div><div class="pc-body">
      <div class="hint" style="margin-top:0">Производство: <b style="color:var(--gold)">${fs.production.toFixed(0)}</b> · Ископаемые: <b>⛏ ${fs.resources.minerals.toFixed(0)}</b></div>
      <div class="dec-item"><b>Пехотные дивизии (${DIVISION_COST} пр. → +${DIVISION_SIZE})</b>`;
    for (const t of troopsOf(s.player)) {
      if (t.id === 'greatFleet') continue;
      const can = fs.production >= DIVISION_COST;
      html += `<button class="mini-btn wide ${can ? '' : 'off'}" data-div="${t.id}" ${can ? '' : 'disabled'}>${t.name} · в пуле ${(fs.units[t.id] ?? 0).toFixed(0)}</button>`;
    }
    html += `</div>`;

    // --- Верфи: корабли строятся только здесь и только вручную. ---
    const yards = yardsOf(s, s.player);
    html += `<div class="dec-item"><b>⚓ Верфи (${yards.length})</b>
      <div class="hint">Верфь строится через карточку своей планеты (${SHIPYARD_COST} пр.). Один стапель — один заказ. Готовые корпуса ждут на складе: их забирает флот с орбиты, либо формируется новое соединение.</div>`;
    if (!yards.length) {
      html += `<div class="hint" style="color:var(--fed)">Верфей нет. Откройте карточку своей планеты и постройте первую.</div>`;
    }
    for (const p of yards) {
      const y = p.shipyard!;
      const q = y.queue;
      const qdef = q ? SHIP_CLASSES.find((c) => c.id === q.cls) : null;
      html += `<div class="yard-row">
        <div class="yard-head"><b>⚓ ${p.name}</b>${p.supplied ? '' : ' <span style="color:var(--fed)">⛔ без снабжения</span>'}</div>
        <div class="yard-status">${q && qdef
          ? `Стапель: ${qdef.name} — ещё ${q.daysLeft} дн <button class="mini-btn" data-cancel="${p.id}">ОТМЕНИТЬ</button>`
          : 'Стапель свободен'}</div>
        <div class="yard-status">Склад: ЭСМ ${y.stored.ships} · ДРД ${y.stored.dreadnoughts} · ЛКР ${y.stored.battleships}</div>
        <div class="yard-btns">`;
      for (const c of SHIP_CLASSES) {
        const can = !q && fs.production >= c.cost && fs.resources.minerals >= c.minerals;
        html += `<button class="mini-btn ${can ? '' : 'off'}" data-queue="${p.id}:${c.id}" ${can ? '' : 'disabled'} title="${c.desc} · ${c.days} дн · ${c.cost} пр. + ${c.minerals} ⛏">${c.name.split(' ')[0]} ${c.cost}·⛏${c.minerals}</button>`;
      }
      if (storedHulls(y) > 0) {
        html += `<button class="mini-btn" data-form="${p.id}">➕ СОЕДИНЕНИЕ</button>`;
      }
      html += `<button class="mini-btn ${y.repeat ? 'sel' : ''}" data-repeat="${p.id}" title="Автоматически закладывать ту же серию, пока хватает ресурсов">${y.repeat ? '🔁 ПОВТОР: ВКЛ' : '🔁 ПОВТОР'}</button>`;
      html += `</div></div>`;
    }
    html += `</div></div>`;
    this.productionEl.innerHTML = html;

    this.productionEl.querySelector('#prod-close')?.addEventListener('click', () => this.productionEl.classList.add('hidden'));
    this.productionEl.querySelectorAll<HTMLButtonElement>('[data-div]').forEach((b) =>
      b.addEventListener('click', () => {
        if (produceDivision(this.state, this.state.player, b.dataset.div!)) {
          this.toast('ДИВИЗИЯ СФОРМИРОВАНА');
          this.renderProduction();
          this.renderStability();
        } else this.toast('НЕВОЗМОЖНО: НЕТ РЕСУРСОВ ИЛИ УСЛОВИЙ');
      }));
    this.productionEl.querySelectorAll<HTMLButtonElement>('[data-queue]').forEach((b) =>
      b.addEventListener('click', () => {
        const [pid, cls] = b.dataset.queue!.split(':');
        if (queueShip(this.state, this.state.player, pid!, cls as ShipClassId)) {
          this.toast('ЗАКАЗ ПОСТАВЛЕН НА СТАПЕЛЬ');
          this.renderProduction();
        }
      }));
    this.productionEl.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((b) =>
      b.addEventListener('click', () => {
        if (cancelQueue(this.state, this.state.player, b.dataset.cancel!)) {
          this.toast('ЗАКАЗ ОТМЕНЁН (ВОЗВРАТ 50%)');
          this.renderProduction();
        }
      }));
    this.productionEl.querySelectorAll<HTMLButtonElement>('[data-repeat]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = this.state.galaxy.planets.get(b.dataset.repeat!);
        if (!p?.shipyard) return;
        // Повторяется последний заложенный класс (или эсминцы по умолчанию).
        p.shipyard.repeat = p.shipyard.repeat ? undefined : (p.shipyard.queue?.cls ?? 'destroyer');
        this.renderProduction();
      }));
    this.productionEl.querySelectorAll<HTMLButtonElement>('[data-form]').forEach((b) =>
      b.addEventListener('click', () => {
        if (formFleetFromYard(this.state, this.state.player, b.dataset.form!)) {
          this.toast('НОВОЕ СОЕДИНЕНИЕ СФОРМИРОВАНО');
          this.renderProduction();
          this.renderForces();
        } else this.toast('НЕВОЗМОЖНО: ЛИМИТ ФЛОТОВ ИЛИ ПУСТОЙ СКЛАД');
      }));
  }

  // ---------------- Главное меню (Escape) ----------------

  private toggleMenu(): void {
    const opening = this.menuEl.classList.contains('hidden');
    this.menuEl.classList.toggle('hidden');
    if (opening) {
      this.menuPrevSpeed = this.state.speed;
      this.clock.setSpeed(0);
      this.renderClock();
      this.renderMenu();
    } else if (this.menuPrevSpeed > 0) {
      // Закрытие меню возвращает скорость, шедшую до его открытия.
      this.clock.setSpeed(this.menuPrevSpeed);
      this.renderClock();
    }
  }

  private renderMenu(): void {
    // Сетевая партия: код виден всё время, список игроков — с кнопкой
    // исключения у хоста.
    const code = getPartyCode();
    const members = getPartyMembers();
    const isHost = currentRole() === 'host';
    const slotRow = (slot: string, canSave: boolean): string => {
      const meta = saveMeta(slot);
      const label = slot === AUTOSAVE_SLOT ? 'Автосейв' : `Слот ${slot.slice(-1)}`;
      return `<div class="save-row">
        <span class="save-name">${label}</span>
        <span class="save-when">${meta ? `день ${meta.day} · ${meta.savedAt}` : '—'}</span>
        ${canSave ? `<button class="mini-btn" data-save="${slot}">СОХРАНИТЬ</button>` : ''}
        ${meta ? `<button class="mini-btn" data-load="${slot}">ЗАГРУЗИТЬ</button>` : ''}
      </div>`;
    };

    // Слева партия, справа настройки. Фальшивых слотов «пригласить друга»
    // больше нет: сетевая игра живёт в главном меню, а здесь они годами
    // занимали половину экрана надписью «СКОРО».
    this.menuEl.innerHTML = `
      <div class="menu-inner">
        <div class="menu-left">
          ${code ? partyCodeBlock(code) : ''}
          ${members.length ? `<div class="menu-title">Игроки</div>${rosterList(members, isHost)}` : ''}
          <div class="menu-title">Партия</div>
          <button class="menu-btn" id="menu-continue">Продолжить</button>
          <button class="menu-btn" id="menu-new">Новая игра</button>
          <div class="menu-title">Сохранения</div>
          <div class="save-list">
            ${slotRow(AUTOSAVE_SLOT, false)}
            ${MANUAL_SLOTS.map((sl) => slotRow(sl, true)).join('')}
          </div>
          <button class="menu-quit" id="menu-quit">Выйти из игры</button>
        </div>
        <div class="menu-right">
          <div class="menu-title">Настройки</div>
          <div id="menu-settings" class="st-host"></div>
        </div>
      </div>`;

    this.menuEl.querySelectorAll<HTMLButtonElement>('[data-kick]').forEach((b) =>
      b.addEventListener('click', () => {
        if (kickPeer(b.dataset.kick!)) {
          this.toast('ИГРОК ИСКЛЮЧЁН');
          this.renderMenu();
        }
      }));
    this.menuEl.querySelector('#party-code')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(getPartyCode() ?? '');
      this.toast('КОД СКОПИРОВАН');
    });

    this.menuEl.querySelector('#menu-continue')!.addEventListener('click', () => this.toggleMenu());
    this.menuEl.querySelector('#menu-new')!.addEventListener('click', () => location.reload());
    this.menuEl.querySelector('#menu-quit')!.addEventListener('click', () => window.close());
    this.menuEl.querySelectorAll<HTMLButtonElement>('[data-save]').forEach((b) =>
      b.addEventListener('click', () => {
        const slot = b.dataset.save!;
        if (saveGame(this.state, slot, `Слот ${slot.slice(-1)}`)) {
          this.toast('ИГРА СОХРАНЕНА');
          this.renderMenu();
        }
      }));
    this.menuEl.querySelectorAll<HTMLButtonElement>('[data-load]').forEach((b) =>
      b.addEventListener('click', () => {
        requestLoad(b.dataset.load!);
        location.reload();
      }));

    // Тот же экран настроек, что и в главном меню: одна модель, одна вёрстка.
    const host = this.menuEl.querySelector<HTMLElement>('#menu-settings')!;
    new SettingsPanel(host, { hotkeys: this.hotkeys }).render();
  }

  // ---------------- Журнал войны ----------------

  private toggleChronicle(): void {
    const opening = this.chronicleEl.classList.contains('hidden');
    this.chronicleEl.classList.toggle('hidden');
    if (opening) this.renderChronicle();
  }

  /** График контроля галактики: полилинии числа планет по фракциям. */
  private chronicleChart(): string {
    const s = this.state;
    const hist = s.history;
    if (hist.length < 2) return '<div class="hint">График появится после первого месяца войны.</div>';
    const W = 760, H = 220, PAD = 34;
    const days = hist.map((h) => h.day);
    const minD = days[0]!, maxD = Math.max(days[days.length - 1]!, minD + 1);
    const factions = FACTION_IDS.concat(s.superFederationRisen ? ['superFederation'] : []);
    const maxN = Math.max(4, ...hist.flatMap((h) => factions.map((f) => h.control[f] ?? 0)));
    const x = (d: number) => PAD + ((d - minD) / (maxD - minD)) * (W - PAD * 2);
    const y = (n: number) => H - 22 - (n / maxN) * (H - 42);
    let svg = `<svg class="chron-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
    // сетка: горизонтали четвертей и годовые отметки
    for (let i = 0; i <= 4; i++) {
      const yy = y((maxN / 4) * i);
      svg += `<line x1="${PAD}" y1="${yy}" x2="${W - PAD}" y2="${yy}" stroke="rgba(255,255,255,0.08)"/>`;
      svg += `<text x="${PAD - 6}" y="${yy + 3}" text-anchor="end" class="chron-tick">${Math.round((maxN / 4) * i)}</text>`;
    }
    for (let d = Math.ceil(minD / 365) * 365; d <= maxD; d += 365) {
      svg += `<line x1="${x(d)}" y1="${y(0)}" x2="${x(d)}" y2="${y(maxN)}" stroke="rgba(255,255,255,0.07)"/>`;
      svg += `<text x="${x(d)}" y="${H - 6}" text-anchor="middle" class="chron-tick">Год ${d / 365}</text>`;
    }
    for (const f of factions) {
      const pts = hist.map((h) => `${x(h.day).toFixed(1)},${y(h.control[f] ?? 0).toFixed(1)}`).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="${factionColor(f)}" stroke-width="2"/>`;
    }
    svg += `</svg>`;
    const legend = factions.map((f) => {
      const last = hist[hist.length - 1]!.control[f] ?? 0;
      return `<span class="chron-leg"><span class="fac-dot" style="background:${factionColor(f)}"></span>${FACTIONS[f].short} <b>${last}</b></span>`;
    }).join('');
    return svg + `<div class="chron-legend">${legend}</div>`;
  }

  private renderChronicle(): void {
    const s = this.state;
    const rows = [...s.chronicle].reverse().map((c) =>
      `<div class="chron-row"><span class="chron-day">Д${c.day} · год ${Math.floor(c.day / 365) + 1}</span><span>${c.text}</span></div>`).join('')
      || '<div class="hint">Пока ни одной вехи: война только разгорается.</div>';
    this.chronicleEl.innerHTML = `
      <div class="chron-inner">
        <div class="pc-head"><span class="pc-title">📜 ЖУРНАЛ ВОЙНЫ · ДЕНЬ ${s.day}</span>
          <button class="pc-close" id="chron-close">✕</button></div>
        <div class="pc-body">
          <div class="pp-section">Контроль галактики</div>
          ${this.chronicleChart()}
          <div class="pp-section">Вехи войны · ${s.chronicle.length}</div>
          <div class="chron-list">${rows}</div>
        </div>
      </div>`;
    this.chronicleEl.querySelector('#chron-close')?.addEventListener('click', () => this.chronicleEl.classList.add('hidden'));
    this.chronicleEl.addEventListener('click', (e) => {
      if (e.target === this.chronicleEl) this.chronicleEl.classList.add('hidden');
    });
  }

  // ---------------- Справка по управлению ----------------

  // ---------------- Боевые оповещения и кинокамера ----------------

  /** Кликабельная тревога: клик — камера летит к планете, карточка открыта. */
  private pushAlert(a: { planetId: string; text: string; tone: string; voice?: string }): void {
    // Звуковое сопровождение: потеря — удар, угроза — сирена, успех — чайм.
    if (a.tone === 'bad') {
      if (a.voice === 'planetLost' || a.voice === 'capitalLost') this.sound.thud();
      else this.sound.siren();
    } else if (a.tone === 'good') {
      this.sound.chime();
    }
    const item = el('div', `combat-alert ${a.tone}`, `<span class="ca-dot"></span>${a.text}`);
    item.addEventListener('click', () => {
      this.scene.stopCinema();
      this.scene.focusOn(a.planetId);
      this.state.selectedPlanet = a.planetId;
      this.scene.setSelected(a.planetId);
      this.renderPanel();
      item.remove();
    });
    this.alertsEl.prepend(item);
    // Не копим бесконечно: держим максимум пять последних.
    while (this.alertsEl.children.length > 5) this.alertsEl.lastElementChild?.remove();
    window.setTimeout(() => item.remove(), 14000);
  }

  /** Кнопка 🎥: перебор идущих битв, приоритет — сражения игрока. */
  private cinemaNext(): void {
    const s = this.state;
    const battles = s.galaxy.order
      .map((id) => s.galaxy.planets.get(id)!)
      .filter((p) => p.battle && !p.shattered && !p.abyss)
      .sort((a, b) => {
        const ap = a.owner === s.player || a.battle!.attacker === s.player ? 1 : 0;
        const bp = b.owner === s.player || b.battle!.attacker === s.player ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return b.battle!.liberation - a.battle!.liberation;
      });
    if (!battles.length) {
      this.toast('СЕЙЧАС НИГДЕ НЕ ИДЁТ СРАЖЕНИЙ');
      return;
    }
    const p = battles[this.cinemaIdx % battles.length]!;
    this.cinemaIdx++;
    this.scene.startCinema(p.id);
    this.toast(`🎥 ${p.name} — битва идёт ${p.battle!.days}-й день. Любой ввод вернёт управление.`, 2600);
  }

  // ---------------- Log & toast ----------------

  private renderLog(): void {
    const entries = this.state.log.slice(-40).reverse();
    this.logEl.innerHTML = entries.map((e) =>
      `<div class="log-entry ${e.tone}"><span class="d">D${e.day}</span>${e.text}</div>`).join('');
  }

  toast(text: string, ms = 1600): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  /** Верхний баннер: фракция выбита, но война продолжается — можно наблюдать. */
  private showDefeatBanner(faction: FactionId, by: FactionId | null): void {
    const isPlayer = faction === this.state.player;
    const victor = by ? `фракции «${FACTIONS[by].name}»` : 'врагам';
    this.bannerEl.innerHTML = isPlayer
      ? `<b>ВЫ ПОВЕРЖЕНЫ</b> — фракция «${FACTIONS[faction].name}» проигрывает ${victor}.
         <span class="banner-sub">Война продолжается — вы наблюдаете за картой.</span>`
      : `Фракция «${FACTIONS[faction].name}» проигрывает ${victor} и выбывает из войны.`;
    this.bannerEl.style.borderColor = factionColor(faction);
    this.bannerEl.classList.remove('hidden');
    clearTimeout(this.bannerTimer);
    // Баннер игрока висит, чужой — уходит сам.
    if (!isPlayer) {
      this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.add('hidden'), 12000);
    }
  }

  /** Сюжетный ивент: золотой баннер. Развилка — кнопки выбора и пауза. */
  private showEventBanner(title: string, text: string): void {
    const pending = this.state.pendingChoice;
    const ev = pending ? TIMELINE_EVENTS.find((t) => t.id === pending) : null;
    if (ev?.choices) {
      // Пока развилка не решена, баннер держит именно её — параллельные ивенты не перекрывают выбор.
      this.eventEl.innerHTML = `<b>${ev.title}</b><span class="banner-sub">${ev.text}</span>
        <div class="ev-choices">${ev.choices.map((c, i) =>
          `<button class="mini-btn" data-choice="${i}">${c.label}</button>`).join('')}</div>`;
      this.eventEl.classList.remove('hidden');
      clearTimeout(this.eventTimer);
      this.renderClock();
      this.eventEl.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) =>
        b.addEventListener('click', () => {
          resolveChoice(this.state, ev.id, Number(b.dataset.choice));
          this.eventEl.classList.add('hidden');
          this.renderHud();
        }));
      return;
    }
    this.eventEl.innerHTML = `<b>${title}</b><span class="banner-sub">${text}</span>`;
    this.eventEl.classList.remove('hidden');
    clearTimeout(this.eventTimer);
    this.eventTimer = window.setTimeout(() => this.eventEl.classList.add('hidden'), 11000);
  }

  private showWinner(): void {
    if (this.toastEl.dataset.final) return;
    this.toastEl.dataset.final = '1';
    const w = this.state.winner!;
    if (w === this.state.player) this.sound.chime(); else this.sound.thud();
    this.bannerEl.classList.add('hidden');
    this.toast(
      w === this.state.player
        ? 'ПОБЕДА · ГАЛАКТИКА СВОБОДНА'
        : `ВОЙНА ОКОНЧЕНА · НАД ГАЛАКТИКОЙ ВЛАСТВУЕТ ФРАКЦИЯ «${FACTIONS[w].name.toUpperCase()}»`,
      999999
    );
  }
}

