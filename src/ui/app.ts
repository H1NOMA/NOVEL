/**
 * Web-раннер: рендерит View из ядра в DOM и переводит клики/клавиши
 * в вызовы интерпретатора. Вся игровая логика — в src/engine,
 * здесь только отображение.
 */
import type { GameState, Scenario, View } from '../engine/types';
import { advance, begin, choose, currentView } from '../engine/interpreter';
import { makeSave } from '../engine/saves';
import { backgrounds, sprites } from './assets';
import { AUTOSAVE_SLOT, MANUAL_SLOTS, clearSlot, readSlot, writeSlot } from './storage';

type Screen = 'title' | 'game';

export class App {
  private state: GameState | null = null;
  private view: View | null = null;
  private screen: Screen = 'title';
  private overlay: 'none' | 'saves' | 'history' = 'none';
  private savesMode: 'save' | 'load' = 'save';

  constructor(
    private readonly sc: Scenario,
    private readonly root: HTMLElement
  ) {
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.render();
  }

  // -- игровые действия -----------------------------------------------------

  private newGame(): void {
    const r = begin(this.sc);
    this.state = r.state;
    this.view = r.view;
    this.screen = 'game';
    this.overlay = 'none';
    this.render();
  }

  private continueGame(): void {
    const save = readSlot(this.sc, AUTOSAVE_SLOT);
    if (!save) return;
    this.loadState(save.state);
  }

  private loadState(state: GameState): void {
    this.state = state;
    this.view = currentView(this.sc, state);
    this.screen = 'game';
    this.overlay = 'none';
    this.render();
  }

  private next(): void {
    if (!this.state || this.overlay !== 'none' || this.view?.kind !== 'line') return;
    const r = advance(this.sc, this.state);
    this.state = r.state;
    this.view = r.view;
    if (r.view.kind === 'choice' || r.view.kind === 'end') this.autosave();
    this.render();
  }

  private pick(index: number): void {
    if (!this.state || this.view?.kind !== 'choice') return;
    const r = choose(this.sc, this.state, index);
    this.state = r.state;
    this.view = r.view;
    this.autosave();
    this.render();
  }

  private autosave(): void {
    if (!this.state) return;
    writeSlot(this.sc, AUTOSAVE_SLOT, makeSave(this.state, new Date().toISOString()));
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.overlay !== 'none') {
        this.overlay = 'none';
        this.render();
      }
      return;
    }
    if (this.screen !== 'game' || this.overlay !== 'none') return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.next();
    }
  }

  // -- рендер ---------------------------------------------------------------

  private render(): void {
    this.root.replaceChildren(this.screen === 'title' ? this.renderTitle() : this.renderGame());
  }

  private renderTitle(): HTMLElement {
    const hasAuto = readSlot(this.sc, AUTOSAVE_SLOT) !== null;
    const menu = el('div', 'title-menu');
    menu.append(
      button('Новая игра', () => this.newGame(), 'menu-btn'),
      button('Продолжить', () => this.continueGame(), 'menu-btn', !hasAuto),
      button('Загрузить', () => this.openSaves('load'), 'menu-btn')
    );
    const screen = el('div', 'screen title-screen');
    screen.style.background = backgrounds['void'] ?? '#000';
    const h1 = el('h1', 'title-logo');
    h1.textContent = this.sc.meta.title;
    const sub = el('p', 'title-sub');
    sub.textContent = 'прототип · движок VN · v0.1';
    screen.append(h1, sub, menu);
    if (this.overlay === 'saves') screen.append(this.renderSavesOverlay());
    return screen;
  }

  private renderGame(): HTMLElement {
    const state = this.state!;
    const view = this.view!;

    const screen = el('div', 'screen game-screen');
    screen.style.background =
      (state.presentation.background && backgrounds[state.presentation.background]) || '#000';

    // Спрайты
    const stage = el('div', 'stage');
    for (const slot of ['left', 'center', 'right'] as const) {
      const id = state.presentation.sprites[slot];
      if (!id) continue;
      const ph = sprites[id];
      const sprite = el('div', `sprite sprite-${slot}`);
      sprite.style.setProperty('--sprite-color', ph?.color ?? '#888');
      sprite.title = ph?.label ?? id;
      stage.append(sprite);
    }
    screen.append(stage);

    // Быстрое меню
    const quick = el('div', 'quickbar');
    quick.append(
      button('Сохранить', () => this.openSaves('save'), 'quick-btn'),
      button('Загрузить', () => this.openSaves('load'), 'quick-btn'),
      button('История', () => this.toggleOverlay('history'), 'quick-btn'),
      button('В меню', () => this.toTitle(), 'quick-btn')
    );
    screen.append(quick);

    // Текст / выбор / концовка
    if (view.kind === 'line') {
      const box = el('div', 'textbox');
      box.addEventListener('click', () => this.next());
      if (view.who !== null) {
        const name = el('div', 'name-plate');
        name.textContent = view.who;
        if (view.color) name.style.color = view.color;
        box.append(name);
      }
      const text = el('div', 'line-text');
      text.textContent = view.text;
      const hint = el('div', 'advance-hint');
      hint.textContent = '▼';
      box.append(text, hint);
      screen.append(box);
    } else if (view.kind === 'choice') {
      const wrap = el('div', 'choices');
      if (view.prompt !== null) {
        const p = el('div', 'choice-prompt');
        p.textContent = view.prompt;
        wrap.append(p);
      }
      for (const o of view.options) {
        wrap.append(button(o.text, () => this.pick(o.index), 'choice-btn'));
      }
      screen.append(wrap);
    } else {
      const wrap = el('div', 'ending');
      const label = el('div', 'ending-label');
      label.textContent = 'КОНЕЦ';
      const which = el('div', 'ending-id');
      which.textContent = `концовка: ${view.ending}`;
      wrap.append(label, which, button('В главное меню', () => this.toTitle(), 'menu-btn'));
      screen.append(wrap);
    }

    if (this.overlay === 'saves') screen.append(this.renderSavesOverlay());
    if (this.overlay === 'history') screen.append(this.renderHistoryOverlay());
    return screen;
  }

  private renderSavesOverlay(): HTMLElement {
    const overlay = modal(`${this.savesMode === 'save' ? 'Сохранение' : 'Загрузка'}`, () =>
      this.toggleOverlay('none')
    );
    const list = el('div', 'slot-list');
    const slots: string[] = this.savesMode === 'load' ? [AUTOSAVE_SLOT, ...MANUAL_SLOTS] : [...MANUAL_SLOTS];
    for (const slot of slots) {
      const save = readSlot(this.sc, slot);
      const row = el('div', 'slot-row');
      const title = el('div', 'slot-title');
      title.textContent = slot === AUTOSAVE_SLOT ? 'Автосейв' : `Слот ${slot}`;
      const caption = el('div', 'slot-caption');
      caption.textContent = save ? `${new Date(save.savedAt).toLocaleString()} · ${save.caption}` : 'пусто';
      const actions = el('div', 'slot-actions');
      if (this.savesMode === 'save') {
        actions.append(
          button(save ? 'Перезаписать' : 'Сохранить', () => {
            if (!this.state) return;
            writeSlot(this.sc, slot, makeSave(this.state, new Date().toISOString()));
            this.render();
          }, 'slot-btn')
        );
        if (save) actions.append(button('Удалить', () => { clearSlot(this.sc, slot); this.render(); }, 'slot-btn danger'));
      } else if (save) {
        actions.append(button('Загрузить', () => this.loadState(save.state), 'slot-btn'));
      }
      row.append(title, caption, actions);
      list.append(row);
    }
    overlay.querySelector('.modal-body')!.append(list);
    return overlay;
  }

  private renderHistoryOverlay(): HTMLElement {
    const overlay = modal('История', () => this.toggleOverlay('none'));
    const list = el('div', 'history-list');
    for (const entry of this.state?.history ?? []) {
      const row = el('div', 'history-row');
      if (entry.who !== null) {
        const who = el('span', 'history-who');
        who.textContent = `${entry.who}: `;
        row.append(who);
      }
      row.append(document.createTextNode(entry.text));
      list.append(row);
    }
    overlay.querySelector('.modal-body')!.append(list);
    queueMicrotask(() => (list.scrollTop = list.scrollHeight));
    return overlay;
  }

  private openSaves(mode: 'save' | 'load'): void {
    if (mode === 'save' && this.screen !== 'game') return;
    this.savesMode = mode;
    this.overlay = 'saves';
    this.render();
  }

  private toggleOverlay(which: 'history' | 'none'): void {
    this.overlay = this.overlay === which ? 'none' : which;
    this.render();
  }

  private toTitle(): void {
    this.autosave();
    this.screen = 'title';
    this.overlay = 'none';
    this.render();
  }
}

// -- маленькие DOM-хелперы --------------------------------------------------

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(label: string, onClick: () => void, className: string, disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function modal(title: string, onClose: () => void): HTMLElement {
  const overlay = el('div', 'overlay');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) onClose();
  });
  const box = el('div', 'modal');
  const head = el('div', 'modal-head');
  const h = el('div', 'modal-title');
  h.textContent = title;
  head.append(h, button('✕', onClose, 'modal-close'));
  box.append(head, el('div', 'modal-body'));
  overlay.append(box);
  return overlay;
}
