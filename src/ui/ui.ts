import type { FactionId, Planet } from '../core/types';
import { bus } from '../core/emitter';
import { FACTIONS, FACTION_GEN, FACTION_IDS, SPECIALS, areHostile } from '../data/factions';
import { FOCUS_TREES } from '../data/focus';
import { BIOMES } from '../data/biomes';
import { canSelectFocus, selectFocus } from '../game/focus';
import { orderFleetTo, garrisonReinforce, splitFleet, disbandFleet } from '../game/units';
import { buildShipyard, cancelQueue, formFleetFromYard, queueShip, storedHulls, takeStoredShips, yardsOf, SHIPYARD_COST } from '../game/shipyards';
import { canEnter } from '../game/supply';
import { fleetsAt, fleetsOf, planetsOf, type GameState } from '../game/state';
import { buildDepot, DEPOT_COST } from '../game/supply';
import { buildE711Station, buildSpecialDock, E711_STATION_COST, enableE711Mining, fireSuperweapon, installTermicide, plantGloomSeed, produceDivision, raiseSpire, rebuildSpecial, sectorFullyOwned, SPECIAL_DOCK_COST, SPECIAL_REBUILD_COST, specialDockWorld, superShotReadyIn, TERMICIDE_COST } from '../game/decisions';
import { DIVISION_COST, DIVISION_SIZE, SHIP_CLASSES, type ShipClassId } from '../data/troops';
import { troopsOf } from '../data/troops';
import { AUTOSAVE_SLOT, MANUAL_SLOTS, requestLoad, saveGame, saveMeta } from '../game/persist';
import { bonusesFor, buyBonus, canBuyBonus, timesBought } from '../game/politics';
import { emblemDataURL } from '../render/emblems';
import { portraitDataURL, RULERS } from '../render/portraits';
import type { GameClock } from '../game/clock';
import type { GalaxyScene } from '../render/scene';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

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
  /** Позиция карточки планеты (сохраняется между открытиями). */
  private cardPos: { x: number; y: number } | null = null;
  private spireMode = false;
  private gloomMode = false;
  private termicideMode = false;
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
    this.forcesEl = el('div'); this.forcesEl.id = 'forces-dock';
    this.fleetDetailEl = el('div'); this.fleetDetailEl.id = 'fleet-detail'; this.fleetDetailEl.classList.add('hidden');
    this.boxActionsEl = el('div'); this.boxActionsEl.id = 'box-actions'; this.boxActionsEl.classList.add('hidden');

    // Кнопки фокусов/решений/производства — под шапкой слева.
    this.sideBtns.innerHTML = `
      <button class="hud-btn-sq" id="focus-btn" title="Древо фокусов (F)">◈</button>
      <button class="hud-btn-sq" id="decisions-btn" title="Решения">⚙</button>
      <button class="hud-btn-sq" id="production-btn" title="Производство">⚒</button>`;
    this.sideBtns.querySelector('#focus-btn')!.addEventListener('click', () => this.toggleFocus());
    this.sideBtns.querySelector('#decisions-btn')!.addEventListener('click', () => this.toggleDecisions());
    this.sideBtns.querySelector('#production-btn')!.addEventListener('click', () => this.toggleProduction());

    this.root.append(this.hud, this.sideBtns, this.chipsEl, this.dossierEl, this.panel, this.focusOverlay, this.decisionsEl, this.productionEl, this.menuEl, this.bannerEl, this.fleetDetailEl, this.boxActionsEl, this.forcesEl, this.logEl, this.toastEl);
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
    bus.on('planetsBoxSelected', ({ ids }) => this.onBoxSelected(ids));
    bus.on('planetRightClicked', ({ id }) => this.onPlanetRightClicked(id));

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); this.togglePause(); }
      else if (e.key === '1') { this.setSpeedRemember(1); }
      else if (e.key === '2') { this.setSpeedRemember(2); }
      else if (e.key === '3') { this.setSpeedRemember(3); }
      else if (e.key.toLowerCase() === 'f') this.toggleFocus();
      else if (e.key === 'Escape') {
        if (!this.focusOverlay.classList.contains('hidden')) {
          this.focusOverlay.classList.add('hidden');
        } else if (!this.dossierEl.classList.contains('hidden')) {
          this.dossierEl.classList.add('hidden');
        } else {
          this.toggleMenu();
        }
      }
    });
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

    // Шапка: слева флаг фракции и показатели, справа — перемотка времени и день.
    const inds = [
      `<span class="hud-ind" title="Политическая власть">⚖ <b>${fs.politicalPower.toFixed(0)}</b></span>`,
      s.player === 'superEarth'
        ? `<span class="hud-ind" title="Стабильность">☼ <b style="color:${fs.stability > 60 ? '#6fe39a' : fs.stability > 35 ? 'var(--gold)' : 'var(--fed)'}">${fs.stability.toFixed(0)}%</b></span>`
        : '',
      `<span class="hud-ind" title="Поддержка войны">⚔ <b>${fs.warSupport.toFixed(0)}%</b></span>`,
      `<span class="hud-ind" title="Очки производства">⚒ <b style="color:var(--gold)">${fs.production.toFixed(0)}</b></span>`,
      fs.flags.e711Mining ? `<span class="hud-ind" title="Топливо Е-711">⛽ <b style="color:var(--gold)">${fs.resources.e711.toFixed(0)}</b></span>` : '',
      fs.resources.minerals > 0 ? `<span class="hud-ind" title="Ископаемые">⛏ <b>${fs.resources.minerals.toFixed(0)}</b></span>` : '',
    ].filter(Boolean).join('');

    this.hud.innerHTML = `
      <button id="flag-btn" title="Досье фракции"><img src="${emblemDataURL(s.player)}" alt=""></button>
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
          <span class="fac-dot" style="background:${FACTIONS[f].color}"></span>
          ${FACTIONS[f].short} <b style="color:${FACTIONS[f].color}">${count}</b></div>`;
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
      return `<div class="bonus-row">
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
    this.dossierEl.querySelectorAll<HTMLButtonElement>('[data-bonus]').forEach((b) =>
      b.addEventListener('click', () => {
        if (buyBonus(this.state, this.state.player, b.dataset.bonus!)) {
          this.toast('ПОЛИТИЧЕСКОЕ РЕШЕНИЕ ПРИНЯТО');
          this.renderDossier();
          this.renderHud();
        }
      }));
  }

  // ---------------- Planet panel ----------------

  private onPlanetSelected(id: string | null): void {
    const s = this.state;
    if (id) {
      const sel = s.selectedFleet ? s.fleets.get(s.selectedFleet) : null;
      if (sel && sel.faction === s.player && !sel.transit && sel.at !== id) {
        const dest = s.galaxy.planets.get(id)!;
        const invade = areHostile(s.player, dest.owner) && dest.owner !== s.player;
        const ok = orderFleetTo(s, sel, id, invade);
        this.toast(ok ? `ПРИКАЗ: ${invade ? 'ВТОРЖЕНИЕ' : 'ПЕРЕЛЁТ'} · ${dest.name}` : 'НЕТ МАРШРУТА СНАБЖЕНИЯ');
        s.selectedFleet = null;
      }
    }
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
          <button class="mini-btn" data-act="select" data-fleet="${f.id}">${s.selectedFleet === f.id ? '✓ ВЫБРАН' : 'ВЫБРАТЬ'}</button>
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
    const enemyFleets = here.filter((f) => f.faction !== s.player);

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
      <div class="pp-sub">${p.isCapital ? 'СТОЛИЧНЫЙ МИР · ' : ''}${p.sector} · ${BIOMES[p.biome].label}${p.gloom ? ' · ВО МРАКЕ' : ''}</div>
      <div class="pp-owner"><span class="fac-dot" style="background:${FACTIONS[p.owner].color}"></span>${FACTIONS[p.owner].name}</div>

      <div class="pp-section">Контроль</div>
      <div class="ctrl-bar">
        <span style="width:${controlPct}%;background:${FACTIONS[p.owner].color}"></span>
        ${b ? `<span style="width:${attackerPct}%;background:${FACTIONS[b.attacker].color}"></span>` : ''}
      </div>
      <div class="ctrl-row">
        <span style="color:${FACTIONS[p.owner].color}">${FACTIONS[p.owner].short} ${controlPct.toFixed(0)}%</span>
        ${b ? `<span style="color:${FACTIONS[b.attacker].color}">${FACTIONS[b.attacker].short} ${attackerPct.toFixed(0)}%</span>` : ''}
      </div>
      ${b ? `<div class="hint">⚔ Битва идёт ${b.days}-й день</div>` : ''}

      <div class="pp-stat"><span>Снабжение</span><b>${p.supplied ? (p.depot ? '▣ Точка снабжения' : '✓ Обеспечено') : '<span style="color:var(--fed)">⛔ ОКРУЖЕНИЕ</span>'}</b></div>
      <div class="pp-stat"><span>Гарнизон</span><b>${p.garrison.toFixed(0)}</b></div>
      <div class="pp-stat"><span>Укрепления</span><b>${'▮'.repeat(p.fortification)}${'▯'.repeat(5 - p.fortification)}</b></div>
      <div class="pp-stat"><span>Стратегическая ценность</span><b>${p.value}</b></div>
      <div class="pp-stat"><span>Корабли на орбите</span><b><span style="color:var(--se)">${playerFleets.length}</span> / <span style="color:var(--aut)">${enemyFleets.length}</span></b></div>
      ${p.puppetOf ? `<div class="pp-stat"><span>Статус</span><b style="color:var(--gold)">Марионетка ${FACTIONS[p.puppetOf].name === 'Супер-Земля' ? 'Супер-Земли' : FACTIONS[p.puppetOf].name} — сопротивления нет</b></div>` : ''}
      ${p.minerals > 0 ? `<div class="pp-stat"><span>Ископаемые</span><b>${'⛏'.repeat(p.minerals)} +${(p.minerals * (p.owner === 'automatons' ? 0.22 : 0.11)).toFixed(2)}/д${p.biome === 'magma' ? ' · магмовый мир' : ''}</b></div>` : ''}
      ${p.e711Rich ? `<div class="pp-stat"><span>Е-711</span><b style="color:var(--gold)">Богатые залежи</b></div>` : p.origin === 'terminids' && p.owner === 'superEarth' ? `<div class="pp-stat"><span>Е-711</span><b>Следы залежей</b></div>` : ''}
      ${p.buildings.length ? `<div class="pp-stat"><span>Сооружения</span><b>${p.buildings.map((bld) => bld === 'incinFactory' ? '🏭 Фабрика испепеляющего отряда' : bld === 'jetFactory' ? '🏭 Фабрика реактивного батальона' : bld === 'termicide' ? '☠ Система термицида' : bld === 'specialDock' ? '◆ Особая верфь и сервисный док' : bld === 'e711Station' ? '⛽ Станция добычи Е-711' : bld).join('<br>')}</b></div>` : ''}`;

    if (p.shipyard) {
      const q = p.shipyard.queue;
      const qdef = q ? SHIP_CLASSES.find((c) => c.id === q.cls) : null;
      html += `<div class="pp-stat"><span>⚓ Верфь</span><b>${q && qdef ? `${qdef.name} · ${q.daysLeft} дн` : storedHulls(p.shipyard) > 0 ? `Склад: ${storedHulls(p.shipyard)} корп.` : 'Стапель свободен'}</b></div>`;
    }
    if (p.owner === s.player && !p.depot) {
      const can = s.factions[s.player].production >= DEPOT_COST;
      html += `<button class="mini-btn wide ${can ? '' : 'off'}" data-act="depot" ${can ? '' : 'disabled'}>▣ Построить точку снабжения (${DEPOT_COST} пр. · есть ${s.factions[s.player].production.toFixed(0)})</button>`;
    }
    if (p.owner === s.player && !p.shipyard && p.supplied) {
      const can = s.factions[s.player].production >= SHIPYARD_COST;
      html += `<button class="mini-btn wide ${can ? '' : 'off'}" data-act="yard" ${can ? '' : 'disabled'}>⚓ Построить верфь (${SHIPYARD_COST} пр.)</button>`;
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
        html += `<div class="pp-stat"><span>🏙 ${c.name}</span><b><span class="fac-dot" style="background:${FACTIONS[c.holder].color}"></span> ${FACTIONS[c.holder].short}</b></div>`;
      });
    }

    html += `<div class="pp-section">Ваши силы здесь</div>`;
    if (playerFleets.length === 0) html += `<div class="hint">Флотов Супер-Земли на орбите нет.</div>`;
    playerFleets.forEach((f) => {
      const selCls = s.selectedFleet === f.id ? 'sel' : '';
      const badge = f.special ? `<span style="color:var(--gold)">◆ ${SPECIALS[f.faction].name}</span>` : '🚀 Супер-эсминец';
      html += `<div class="fleet-row ${selCls}" data-fleet="${f.id}">
        <div class="grow"><div>${badge}</div>
          <div style="color:var(--muted);font-size:11px">Эсминцы ${f.ships.toFixed(0)}${f.dreadnoughts ? ' · ДРД ' + f.dreadnoughts.toFixed(0) : ''}${f.battleships ? ' · ЛКР ' + f.battleships.toFixed(0) : ''} · Пехота ${f.infantry.toFixed(0)}</div></div>
        <button class="mini-btn" data-act="select" data-fleet="${f.id}">${s.selectedFleet === f.id ? '✓ ВЫБРАН' : 'ВЫБРАТЬ'}</button>
        ${p.owner === s.player && f.infantry > 0 ? `<button class="mini-btn" data-act="deploy" data-fleet="${f.id}">ВЫСАДИТЬ</button>` : ''}
        ${p.owner === s.player && p.shipyard && storedHulls(p.shipyard) > 0 ? `<button class="mini-btn" data-act="takeyard" data-fleet="${f.id}">⚓ С ВЕРФИ</button>` : ''}
      </div>`;
    });

    if (enemyFleets.length) {
      html += `<div class="pp-section">Противник на орбите</div>`;
      enemyFleets.forEach((f) => {
        html += `<div class="fleet-row"><div class="grow"><div style="color:${FACTIONS[f.faction].color}">
          ${f.special ? '◆ ' + SPECIALS[f.faction].name : 'Флот ' + FACTION_GEN[f.faction]}</div>
          <div style="color:var(--muted);font-size:11px">Корабли ${f.ships.toFixed(0)} · Пехота ${f.infantry.toFixed(0)}</div></div></div>`;
      });
    }

    html += `<div class="hint">${s.selectedFleet ? 'Флот выбран — кликните планету назначения.' : 'Выберите флот, затем кликните целевую планету для перелёта или вторжения.'}</div>
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
        if (act === 'fire') {
          if (fireSuperweapon(s, s.player, p.id)) {
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
          s.selectedFleet = s.selectedFleet === fid ? null : fid;
          this.renderPanel();
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

  /** Человекочитаемое имя соединения. */
  private fleetName(fid: string): string {
    const f = this.state.fleets.get(fid);
    if (!f) return fid;
    if (f.special) return SPECIALS[f.faction].name;
    const n = Number(fid.replace('f_', ''));
    return `Соединение №${Number.isFinite(n) ? n + 1 : '?'}`;
  }

  private renderForces(): void {
    const s = this.state;
    const tabs = [
      { id: 'fleet' as const, icon: '🚀', title: 'Флот' },
      { id: 'army' as const, icon: '🪖', title: 'Наземные войска' },
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
          return `<div class="force-card ${open ? 'open' : ''} ${multi ? 'multi' : ''}" data-card-fleet="${f.id}">
            <div class="fc-name">${f.special ? '◆ ' : ''}${this.fleetName(f.id)}${multi ? ' <span class="fc-check">✓</span>' : ''}</div>
            <div class="fc-comp">ЭСМ ${f.ships.toFixed(0)}${f.dreadnoughts ? ' · ДРД ' + f.dreadnoughts.toFixed(0) : ''}${f.battleships ? ' · ЛКР ' + f.battleships.toFixed(0) : ''}</div>
            <div class="fc-comp">Пехота ${f.infantry.toFixed(0)}</div>
            <div class="fc-loc">${f.transit ? '⇢ ' : '⚓ '}${where}</div>
          </div>`;
        }).join('') || '<div class="force-empty">Флотов нет — стройте корабли на верфях (⚒)</div>';
      } else if (this.forcesTab === 'army') {
        const fs = s.factions[s.player];
        cards = troopsOf(s.player).map((t) => `
          <div class="force-card static">
            <div class="fc-name">${t.name}</div>
            <div class="fc-comp">В пуле: <b>${(fs.units[t.id] ?? 0).toFixed(0)}</b></div>
            <div class="fc-loc">${t.desc ?? ''}</div>
          </div>`).join('');
        cards += '<div class="force-empty">Дивизии формируются в «⚒ Производство»</div>';
      } else {
        const fs = s.factions[s.player];
        const sp = SPECIALS[s.player];
        const station = fleetsOf(s, s.player).find((f) => f.special);
        let status: string;
        if (!fs.specialUnlocked) status = 'Не разработана — откройте через древо фокусов';
        else if (fs.lostSpecial) status = '<span style="color:var(--fed)">УНИЧТОЖЕНА</span> — восстановление в «⚙ Решения»';
        else if (station) {
          const at = s.galaxy.planets.get(station.transit ? station.transit.to : station.at);
          status = `На орбите: ${at?.name ?? '?'}`;
        } else status = 'Статус неизвестен';
        const ready = superShotReadyIn(s, s.player);
        cards = `<div class="force-card static wide-card">
          <div class="fc-name">◆ ${sp.name}</div>
          <div class="fc-comp">${sp.blurb}</div>
          <div class="fc-loc">${status}</div>
          ${fs.specialUnlocked && !fs.lostSpecial && (s.player === 'superEarth' || s.player === 'automatons')
            ? `<div class="fc-loc">☄ Планетарный залп: ${ready === 0 ? '<b style="color:var(--gold)">ЗАРЯЖЕН</b>' : 'перезарядка ' + ready + ' дн'}</div>` : ''}
        </div>`;
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
        <div class="pp-sub">${f.transit ? `В пути → ${at?.name ?? '?'}` : `На орбите: ${at?.name ?? '?'}`}</div>
        <div class="pp-stat"><span>Супер-эсминцы</span><b>${f.ships.toFixed(0)}</b></div>
        <div class="pp-stat"><span>Дредноуты</span><b>${f.dreadnoughts.toFixed(0)}</b></div>
        <div class="pp-stat"><span>Линкоры-флагманы</span><b>${f.battleships.toFixed(0)}</b></div>
        <div class="pp-stat"><span>Пехота на борту</span><b>${f.infantry.toFixed(0)}</b></div>
        ${f.special ? `<div class="hint">◆ Несёт супероружие фракции.</div>` : ''}
        <div class="pp-section">Операции</div>
        <button class="mini-btn wide ${hulls >= 2 && !f.transit ? '' : 'off'}" id="fd-split" ${hulls >= 2 && !f.transit ? '' : 'disabled'}>⑂ Разделить пополам</button>
        ${yard && storedHulls(yard) > 0 ? `<button class="mini-btn wide" id="fd-take">⚓ Принять корабли с верфи (${storedHulls(yard)} корп.)</button>` : ''}
        <button class="mini-btn wide ${!f.transit && !f.special && at?.owner === s.player ? '' : 'off'}" id="fd-disband" ${!f.transit && !f.special && at?.owner === s.player ? '' : 'disabled'}>✕ Расформировать</button>
        <div class="hint">ПКМ по планете — приказ на перелёт/вторжение. Shift+клик по карточкам внизу — выбор нескольких соединений.</div>
      </div>`;

    this.fleetDetailEl.querySelector('#fd-close')?.addEventListener('click', () => {
      this.detailFleet = null;
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
      const invade = areHostile(s.player, best.owner) && best.owner !== s.player;
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

  /** ПКМ по планете: приказ всем выбранным соединениям (или одному выбранному). */
  private onPlanetRightClicked(id: string): void {
    const s = this.state;
    const dest = s.galaxy.planets.get(id);
    if (!dest || dest.shattered) return;
    const picks = this.selectedFleets.size
      ? [...this.selectedFleets]
      : s.selectedFleet ? [s.selectedFleet] : [];
    if (!picks.length) return;
    const invade = areHostile(s.player, dest.owner) && dest.owner !== s.player;
    let sent = 0;
    for (const fid of picks) {
      const f = s.fleets.get(fid);
      if (!f || f.faction !== s.player) continue;
      if (orderFleetTo(s, f, id, invade)) sent++;
    }
    if (sent) {
      this.toast(`ПРИКАЗ: ${invade ? 'ВТОРЖЕНИЕ' : 'ПЕРЕЛЁТ'} · ${dest.name} · ${sent} СОЕД.`);
      this.selectedFleets.clear();
      this.renderForces();
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

  private renderFocus(): void {
    const nodes = FOCUS_TREES[this.focusTab];
    const maxX = Math.max(...nodes.map((n) => n.x));
    const maxY = Math.max(...nodes.map((n) => n.y));
    const W = 172, H = 112;
    const cw = (maxX + 1) * W + 40;
    const ch = (maxY + 1) * H + 60;
    const fs = this.state.factions[this.focusTab];

    const tabs = FACTION_IDS.map((f) =>
      `<div class="focus-tab ${f === this.focusTab ? 'active' : ''}" data-fac="${f}" style="border-color:${FACTIONS[f].color}">${FACTIONS[f].short}</div>`
    ).join('');

    // connectors
    let svg = `<svg class="focus-svg" width="${cw}" height="${ch}">`;
    for (const n of nodes) {
      for (const req of n.requires) {
        const r = nodes.find((m) => m.id === req);
        if (!r) continue;
        const x1 = r.x * W + 20 + 75, y1 = r.y * H + 20 + 74;
        const x2 = n.x * W + 20 + 75, y2 = n.y * H + 20;
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

    for (const n of nodes) {
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
      const remain = active ? ` · ${Math.ceil(fs.activeFocus!.remaining)} дн` : '';
      html += `<div class="${cls}" data-focus="${n.id}" style="left:${left}px;top:${top}px">
        <div class="fn-title">${n.title}</div>
        <div style="color:var(--muted)">${n.desc}</div>
        <div class="fn-cost">${done ? '✓' : n.cost + ' дн' + remain}</div>
      </div>`;
    }
    html += `</div></div>`;
    this.focusOverlay.innerHTML = html;

    this.focusOverlay.querySelector('#focus-close')!.addEventListener('click', () => this.focusOverlay.classList.add('hidden'));
    this.focusOverlay.querySelectorAll<HTMLElement>('.focus-tab').forEach((t) =>
      t.addEventListener('click', () => { this.focusTab = t.dataset.fac as FactionId; this.renderFocus(); }));
    this.focusOverlay.querySelectorAll<HTMLElement>('.focus-node.available').forEach((node) =>
      node.addEventListener('click', () => {
        if (selectFocus(this.state, this.state.player, node.dataset.focus!)) {
          this.toast('ФОКУС НАЗНАЧЕН');
          this.renderFocus();
          this.renderStability();
        }
      }));
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
    const slotRow = (slot: string, canSave: boolean) => {
      const meta = saveMeta(slot);
      const label = slot === AUTOSAVE_SLOT ? 'Автосейв' : `Слот ${slot.slice(-1)}`;
      const info = meta ? `День ${meta.day} · ${meta.savedAt}` : 'Пусто';
      return `<div class="save-row">
        <div class="grow"><b>${label}</b><div class="hint" style="margin-top:2px">${info}</div></div>
        ${canSave ? `<button class="mini-btn" data-save="${slot}">СОХРАНИТЬ</button>` : ''}
        ${meta ? `<button class="mini-btn" data-load="${slot}">ЗАГРУЗИТЬ</button>` : ''}
      </div>`;
    };

    this.menuEl.innerHTML = `
      <div class="menu-inner">
        <div class="menu-left">
          <div class="menu-squad">
            <div class="menu-title">КОМАНДА · 4 МЕСТА</div>
            <div class="squad-slot filled">
              <span class="fac-dot" style="background:var(--se)"></span>
              <div class="grow"><b>Вы</b><div class="hint" style="margin-top:0">Супер-Земля · Командующий</div></div>
            </div>
            ${[2, 3, 4].map((i) => `
            <div class="squad-slot">
              <span class="squad-plus">+</span>
              <div class="grow"><b>Место ${i}</b><div class="hint" style="margin-top:0">Пригласить друга на карту</div></div>
              <button class="mini-btn off" disabled>СКОРО</button>
            </div>`).join('')}
          </div>
          <button class="menu-quit" id="menu-quit">ВЫЙТИ<br>ИЗ ИГРЫ</button>
        </div>
        <div class="menu-right">
          <div class="menu-title" style="text-align:right">ВТОРАЯ ГАЛАКТИЧЕСКАЯ ВОЙНА</div>
          <button class="menu-btn" id="menu-continue">▶ ПРОДОЛЖИТЬ</button>
          <button class="menu-btn" id="menu-new">✚ НАЧАТЬ НОВУЮ ИГРУ</button>
          <div class="menu-title" style="margin-top:14px">СОХРАНИТЬ / ЗАГРУЗИТЬ</div>
          ${slotRow(AUTOSAVE_SLOT, false)}
          ${MANUAL_SLOTS.map((sl) => slotRow(sl, true)).join('')}
          <div class="hint">Автосейв записывается автоматически каждый игровой год (365 дней).</div>
        </div>
      </div>`;

    this.menuEl.querySelector('#menu-continue')!.addEventListener('click', () => this.toggleMenu());
    this.menuEl.querySelector('#menu-new')!.addEventListener('click', () => {
      location.reload();
    });
    this.menuEl.querySelector('#menu-quit')!.addEventListener('click', () => {
      window.close();
      this.toast('ЗАКРЫТИЕ ДОСТУПНО В ДЕСКТОП-ВЕРСИИ');
    });
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
    this.bannerEl.style.borderColor = FACTIONS[faction].color;
    this.bannerEl.classList.remove('hidden');
    clearTimeout(this.bannerTimer);
    // Баннер игрока висит, чужой — уходит сам.
    if (!isPlayer) {
      this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.add('hidden'), 12000);
    }
  }

  private showWinner(): void {
    if (this.toastEl.dataset.final) return;
    this.toastEl.dataset.final = '1';
    const w = this.state.winner!;
    this.bannerEl.classList.add('hidden');
    this.toast(
      w === this.state.player
        ? 'ПОБЕДА · ГАЛАКТИКА СВОБОДНА'
        : `ВОЙНА ОКОНЧЕНА · НАД ГАЛАКТИКОЙ ВЛАСТВУЕТ ФРАКЦИЯ «${FACTIONS[w].name.toUpperCase()}»`,
      999999
    );
  }
}

