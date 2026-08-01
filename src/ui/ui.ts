import type { FactionId, Planet } from '../core/types';
import { bus } from '../core/emitter';
import { FACTIONS, FACTION_GEN, FACTION_IDS, SPECIALS, areHostile } from '../data/factions';
import { FOCUS_TREES } from '../data/focus';
import { BIOMES } from '../data/biomes';
import { canSelectFocus, selectFocus } from '../game/focus';
import { orderFleetTo, garrisonReinforce } from '../game/units';
import { fleetsAt, fleetsOf, planetsOf, type GameState } from '../game/state';
import { buildDepot, DEPOT_COST } from '../game/supply';
import { directGloom, enableE711Mining, raiseSpire } from '../game/decisions';
import { troopsOf } from '../data/troops';
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
  private decisionsEl!: HTMLElement;
  /** Позиция карточки планеты (сохраняется между открытиями). */
  private cardPos: { x: number; y: number } | null = null;
  private spireMode = false;

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
    this.decisionsEl = el('div'); this.decisionsEl.id = 'decisions'; this.decisionsEl.classList.add('hidden');
    const help = el('div', undefined, `
      <b>УПРАВЛЕНИЕ</b><br>
      ЛКМ-перетаскивание — камера · Колесо — зум · ПКМ-перетаскивание — наклон<br>
      Клик по планете — сведения · Выберите флот и кликните цель для перелёта/вторжения<br>
      <b>F</b> — древо фокусов · <b>Пробел</b> — пауза · <b>1/2/3</b> — скорость<br>
      <b>★ Столицы:</b> захватите столицу — и фракция капитулирует.
      У терминидов её нет — выжигайте каждый улей.`);
    help.id = 'help';
    this.root.append(this.hud, this.stability, this.panel, this.focusOverlay, this.decisionsEl, this.logEl, this.toastEl, help);
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
    const sel = this.state.selectedPlanet;
    if (sel && this.state.galaxy.planets.get(sel)?.abyss && this.state.player !== 'illuminate') {
      this.state.selectedPlanet = null;
      this.scene.setSelected(null);
    }
    this.renderHud();
    this.renderStability();
    this.renderPanel();
    this.renderLog();
    if (!this.decisionsEl.classList.contains('hidden')) this.renderDecisions();
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
      <button class="hud-btn" id="decisions-btn">⚙ РЕШЕНИЯ</button>
      <div class="hud-factions">${chips}</div>`;

    this.hud.querySelector('#focus-btn')!.addEventListener('click', () => this.toggleFocus());
    this.hud.querySelector('#decisions-btn')!.addEventListener('click', () => this.toggleDecisions());
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
      ${troopsOf('superEarth').map((t) => `<div class="bar-row"><span>${t.name}</span><span>${(se.units[t.id] ?? 0).toFixed(0)}</span></div>`).join('')}
      ${se.flags.e711Mining ? `<div class="bar-row"><span style="color:var(--gold)">Топливо Е-711</span><span style="color:var(--gold)">${se.resources.e711.toFixed(0)}</span></div>` : ''}
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
    if (!p || (p.abyss && s.player !== 'illuminate')) { this.panel.classList.add('hidden'); return; }
    this.panel.classList.remove('hidden');

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
      ${p.minerals > 0 ? `<div class="pp-stat"><span>Ископаемые</span><b>${'⛏'.repeat(p.minerals)}${p.biome === 'magma' ? ' (магмовый мир)' : ''}</b></div>` : ''}
      ${p.e711Rich ? `<div class="pp-stat"><span>Е-711</span><b style="color:var(--gold)">Богатые залежи</b></div>` : p.origin === 'terminids' && p.owner === 'superEarth' ? `<div class="pp-stat"><span>Е-711</span><b>Следы залежей</b></div>` : ''}
      ${p.buildings.length ? `<div class="pp-stat"><span>Сооружения</span><b>${p.buildings.map((bld) => bld === 'incinFactory' ? '🏭 Фабрика испепеляющего отряда' : bld === 'jetFactory' ? '🏭 Фабрика реактивного батальона' : bld).join('<br>')}</b></div>` : ''}`;

    if (p.owner === s.player && !p.depot) {
      const can = s.factions[s.player].production >= DEPOT_COST;
      html += `<button class="mini-btn wide ${can ? '' : 'off'}" data-act="depot" ${can ? '' : 'disabled'}>▣ Построить точку снабжения (${DEPOT_COST} пр. · есть ${s.factions[s.player].production.toFixed(0)})</button>`;
    }
    if (this.spireMode && p.owner === 'illuminate' && s.player === 'illuminate') {
      html += `<button class="mini-btn wide" data-act="spire">▲ Воздвигнуть экзошпиль</button>`;
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
        }
      });
    });
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
      html += `<div class="dec-item"><b>☁ Направить Мрак</b>
        <div class="hint">Выберите сектор — споровые тучи начнут окутывать его миры.</div>`;
      for (const sector of s.galaxy.sectors.values()) {
        const own = sector.planets.filter((pid) => s.galaxy.planets.get(pid)!.owner === s.player).length;
        if (!own) continue;
        const active = s.gloomTarget === sector.id;
        html += `<button class="mini-btn wide ${active ? 'sel' : ''}" data-gloom="${sector.id}">${active ? '☁ ' : ''}${sector.name} (${own} миров)</button>`;
      }
      html += `</div>`;
    }

    if (fs.flags.abyss) {
      html += `<div class="dec-item"><b>▲ Экзошпиль Бездны</b>
        <div class="hint">Включите режим и нажмите «Воздвигнуть экзошпиль» в карточке своей планеты. Через 30 дней мир уйдёт в Бездну.</div>
        <button class="mini-btn wide ${this.spireMode ? 'sel' : ''}" id="dec-spire">${this.spireMode ? '✓ Режим выбора активен' : 'Выбрать планету'}</button></div>`;
    }

    html += `</div>`;
    this.decisionsEl.innerHTML = html;
    this.decisionsEl.querySelector('#dec-close')?.addEventListener('click', () => this.decisionsEl.classList.add('hidden'));
    this.decisionsEl.querySelectorAll<HTMLButtonElement>('[data-gloom]').forEach((b) =>
      b.addEventListener('click', () => {
        if (directGloom(this.state, b.dataset.gloom!)) this.renderDecisions();
      }));
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

