import type { FactionId, Planet } from '../core/types';
import { bus } from '../core/emitter';
import { FACTIONS, FACTION_GEN, FACTION_IDS, SPECIALS, areHostile } from '../data/factions';
import { FOCUS_TREES } from '../data/focus';
import { BIOMES } from '../data/biomes';
import { canSelectFocus, selectFocus } from '../game/focus';
import { orderFleetTo, garrisonReinforce } from '../game/units';
import { fleetsAt, fleetsOf, planetsOf, type GameState } from '../game/state';
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
  private stability!: HTMLElement;
  private panel!: HTMLElement;
  private focusOverlay!: HTMLElement;
  private logEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private focusTab: FactionId = 'superEarth';
  private toastTimer = 0;

  constructor(private state: GameState, private scene: GalaxyScene, private clock: GameClock) {
    this.root = document.getElementById('ui')!;
    this.build();
    this.wire();
    this.renderAll();
  }

  private build(): void {
    this.hud = el('div'); this.hud.id = 'hud';
    this.stability = el('div'); this.stability.id = 'stability';
    this.panel = el('div'); this.panel.id = 'planet-panel'; this.panel.classList.add('hidden');
    this.focusOverlay = el('div'); this.focusOverlay.id = 'focus-overlay'; this.focusOverlay.classList.add('hidden');
    this.logEl = el('div'); this.logEl.id = 'log';
    this.toastEl = el('div'); this.toastEl.id = 'toast';
    const help = el('div', undefined, `
      <b>УПРАВЛЕНИЕ</b><br>
      ЛКМ-перетаскивание — камера · Колесо — зум · ПКМ-перетаскивание — наклон<br>
      Клик по планете — сведения · Выберите флот и кликните цель для перелёта/вторжения<br>
      <b>F</b> — древо фокусов · <b>Пробел</b> — пауза · <b>1/2/3</b> — скорость<br>
      <b>★ Столицы:</b> захватите столицу — и фракция капитулирует.
      У терминидов её нет — выжигайте каждый улей.`);
    help.id = 'help';
    this.root.append(this.hud, this.stability, this.panel, this.focusOverlay, this.logEl, this.toastEl, help);
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

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); this.clock.setSpeed(this.state.speed === 0 ? 1 : 0); this.renderClock(); }
      else if (e.key === '1') { this.clock.setSpeed(1); this.renderClock(); }
      else if (e.key === '2') { this.clock.setSpeed(2); this.renderClock(); }
      else if (e.key === '3') { this.clock.setSpeed(3); this.renderClock(); }
      else if (e.key.toLowerCase() === 'f') this.toggleFocus();
      else if (e.key === 'Escape') { this.focusOverlay.classList.add('hidden'); }
    });
  }

  renderAll(): void {
    this.renderHud();
    this.renderStability();
    this.renderPanel();
    this.renderLog();
    if (!this.focusOverlay.classList.contains('hidden')) this.renderFocus();
  }

  private renderDynamic(): void {
    this.renderHud();
    this.renderStability();
    this.renderPanel();
    this.renderLog();
    // owners may have shifted this day
    this.scene.refreshOwners();
    if (this.state.selectedPlanet) this.scene.setSelected(this.state.selectedPlanet);
    if (this.state.winner) this.showWinner();
  }

  // ---------------- HUD ----------------

  private renderHud(): void {
    const s = this.state;
    const chips = FACTION_IDS.concat(s.superFederationRisen ? ['superFederation'] : [])
      .map((f) => {
        const alive = planetsOf(s, f).length > 0 || fleetsOf(s, f).length > 0;
        const count = planetsOf(s, f).length;
        return `<div class="fac-chip ${alive ? '' : 'dead'}">
          <span class="fac-dot" style="background:${FACTIONS[f].color}"></span>
          ${FACTIONS[f].short} <b style="color:${FACTIONS[f].color}">${count}</b></div>`;
      }).join('');

    this.hud.innerHTML = `
      <div class="hud-title">ВТОРАЯ ГАЛАКТИЧЕСКАЯ ВОЙНА<small>ВЕРХОВНОЕ КОМАНДОВАНИЕ СУПЕР-ЗЕМЛИ</small></div>
      <div class="hud-clock">
        <div class="speed-btns" id="speed">
          <button class="speed-btn" data-s="0">II</button>
          <button class="speed-btn" data-s="1">1×</button>
          <button class="speed-btn" data-s="2">2×</button>
          <button class="speed-btn" data-s="3">3×</button>
        </div>
        <div class="hud-day">ДЕНЬ ${s.day}</div>
      </div>
      <button class="hud-btn" id="focus-btn">◈ ДРЕВО ФОКУСОВ</button>
      <div class="hud-factions">${chips}</div>`;

    this.hud.querySelector('#focus-btn')!.addEventListener('click', () => this.toggleFocus());
    this.hud.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((b) => {
      b.addEventListener('click', () => { this.clock.setSpeed(Number(b.dataset.s) as 0 | 1 | 2 | 3); this.renderClock(); });
    });
    this.renderClock();
  }

  private renderClock(): void {
    const day = this.hud.querySelector('.hud-day');
    if (day) day.textContent = `ДЕНЬ ${this.state.day}`;
    this.hud.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.s) === this.state.speed);
    });
  }

  // ---------------- Stability ----------------

  private renderStability(): void {
    const se = this.state.factions.superEarth;
    const low = se.stability < 40;
    const col = se.stability > 60 ? '#6fe39a' : se.stability > 35 ? 'var(--gold)' : 'var(--fed)';
    this.stability.innerHTML = `
      <div style="display:flex;justify-content:space-between">
        <b style="color:var(--se)">СУПЕР-ЗЕМЛЯ</b>
        <span>Стабильность ${se.stability.toFixed(0)}%</span>
      </div>
      <div class="bar"><span style="width:${se.stability}%;background:${col}"></span></div>
      <div class="bar-row"><span>Поддержка войны</span><span>${se.warSupport.toFixed(0)}%</span></div>
      <div class="bar"><span style="width:${se.warSupport}%;background:var(--se)"></span></div>
      <div class="bar-row"><span>Промышленность ${se.industry.toFixed(0)}</span><span>Резервы ${se.manpower.toFixed(0)}</span></div>
      ${low && !this.state.superFederationRisen ? '<div class="warn">⚠ Растёт недовольство — открыт Путь к Федерации.</div>' : ''}
      ${this.state.superFederationRisen ? '<div class="warn">⚑ Супер-Федерация активна.</div>' : ''}`;
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
    if (!p) { this.panel.classList.add('hidden'); return; }
    this.panel.classList.remove('hidden');

    const here = fleetsAt(s, id);
    const playerFleets = here.filter((f) => f.faction === s.player);
    const enemyFleets = here.filter((f) => f.faction !== s.player);

    let html = `
      <div class="pp-name">${p.name}${p.isCapital ? ' ★' : ''}</div>
      <div class="pp-sub">${p.isCapital ? 'СТОЛИЧНЫЙ МИР · ' : ''}${p.sector} · ${BIOMES[p.biome].label}</div>
      <div class="pp-owner"><span class="fac-dot" style="background:${FACTIONS[p.owner].color}"></span>${FACTIONS[p.owner].name}</div>
      <div class="pp-stat"><span>Гарнизон</span><b>${p.garrison.toFixed(0)}</b></div>
      <div class="pp-stat"><span>Укрепления</span><b>${'▮'.repeat(p.fortification)}${'▯'.repeat(5 - p.fortification)}</b></div>
      <div class="pp-stat"><span>Стратегическая ценность</span><b>${p.value}</b></div>
      <div class="pp-stat"><span>Линии снабжения</span><b>${p.links.length}</b></div>`;

    if (p.battle) {
      const b = p.battle;
      html += `<div class="battle-box">
        <b style="color:var(--fed)">⚔ БИТВА · День ${b.days}</b>
        <div class="pp-stat"><span style="color:${FACTIONS[b.attacker].color}">${FACTIONS[b.attacker].short} — штурм</span>
          <span style="color:${FACTIONS[b.defender].color}">${FACTIONS[b.defender].short} — оборона</span></div>
        <div class="bar"><span style="width:${b.liberation}%;background:${FACTIONS[b.attacker].color}"></span></div>
        <div style="text-align:center;font-size:11px;margin-top:3px">Освобождение ${b.liberation.toFixed(0)}%</div>
      </div>`;
    }

    html += `<div class="pp-section">Ваши силы здесь</div>`;
    if (playerFleets.length === 0) html += `<div class="hint">Флотов Супер-Земли на орбите нет.</div>`;
    playerFleets.forEach((f) => {
      const selCls = s.selectedFleet === f.id ? 'sel' : '';
      const badge = f.special ? `<span style="color:var(--gold)">◆ ${SPECIALS[f.faction].name}</span>` : '🚀 Супер-эсминец';
      html += `<div class="fleet-row ${selCls}" data-fleet="${f.id}">
        <div class="grow"><div>${badge}</div>
          <div style="color:var(--muted);font-size:11px">Корабли ${f.ships.toFixed(0)} · Пехота ${f.infantry.toFixed(0)}</div></div>
        <button class="mini-btn" data-act="select" data-fleet="${f.id}">${s.selectedFleet === f.id ? '✓ ВЫБРАН' : 'ВЫБРАТЬ'}</button>
        ${p.owner === s.player && f.infantry > 0 ? `<button class="mini-btn" data-act="deploy" data-fleet="${f.id}">ВЫСАДИТЬ</button>` : ''}
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

    html += `<div class="hint">${s.selectedFleet ? 'Флот выбран — кликните планету назначения.' : 'Выберите флот, затем кликните целевую планету для перелёта или вторжения.'}</div>`;

    this.panel.innerHTML = html;
    this.panel.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fid = btn.dataset.fleet!;
        const fleet = s.fleets.get(fid);
        if (!fleet) return;
        if (btn.dataset.act === 'select') {
          s.selectedFleet = s.selectedFleet === fid ? null : fid;
          this.renderPanel();
        } else if (btn.dataset.act === 'deploy') {
          garrisonReinforce(s, fleet);
          this.scene.refreshOwners();
          this.renderPanel();
        }
      });
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

  private showWinner(): void {
    if (this.toastEl.dataset.final) return;
    this.toastEl.dataset.final = '1';
    const w = this.state.winner!;
    this.toast(w === this.state.player ? 'ПОБЕДА · ГАЛАКТИКА СВОБОДНА' : `ПОРАЖЕНИЕ · ВЕРХ ОДЕРЖИВАЕТ ФРАКЦИЯ «${FACTIONS[w].name.toUpperCase()}»`, 999999);
  }
}

