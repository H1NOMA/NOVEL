import {
  ACTIONS, assignBinding, bindable, bindingOf, keyLabel, KEY_GROUPS, loadKeyMap,
  resetKeyMap, saveKeyMap, type ActionId, type Binding, type Hotkeys, type KeyMap,
} from './hotkeys';
import {
  getSettings, patchSettings, QUALITY_PRESETS, resetSettings, type Quality, type Settings,
} from './settings';
import { UI_SCALE_MAX, UI_SCALE_MIN } from './uiScale';

// ---------------------------------------------------------------------------
// Экран настроек. Один и тот же в главном меню и в меню паузы — раньше это
// были два разных набора, и половина настроек была доступна только из одного
// места.
//
// В строках нет пояснений: слева название, справа управление. Что делает
// «Свечение», видно по картинке, а не по подписи под ним.
// ---------------------------------------------------------------------------

export type SettingsTab = 'video' | 'audio' | 'ui' | 'game' | 'keys';

const TABS: [SettingsTab, string][] = [
  ['video', 'Изображение'],
  ['audio', 'Звук'],
  ['ui', 'Интерфейс'],
  ['game', 'Партия'],
  ['keys', 'Управление'],
];

const row = (label: string, control: string): string =>
  `<div class="st-row"><span class="st-label">${label}</span>${control}</div>`;

const toggle = (key: keyof Settings, on: boolean): string =>
  `<button class="st-tog ${on ? 'on' : ''}" data-tog="${key}">${on ? 'ВКЛ' : 'ВЫКЛ'}</button>`;

const seg = <T extends string | number>(key: string, value: T, options: [T, string][]): string =>
  `<div class="st-seg">${options.map(([v, label]) =>
    `<button class="${v === value ? 'sel' : ''}" data-seg="${key}" data-val="${v}">${label}</button>`,
  ).join('')}</div>`;

const slider = (key: keyof Settings, value: number, min: number, max: number, step: number,
  fmt: (v: number) => string): string =>
  `<div class="st-slider">
     <input type="range" data-num="${key}" min="${min}" max="${max}" step="${step}" value="${value}">
     <b data-out="${key}">${fmt(value)}</b>
   </div>`;

const pct = (v: number): string => `${Math.round(v * 100)}%`;

export interface SettingsPanelOpts {
  /** Диспетчер горячих клавиш — если игра запущена, привязки применяются сразу. */
  hotkeys?: Hotkeys;
  /** Дёргается после любой правки: вызывающий обновляет свои панели. */
  onChange?: () => void;
}

export class SettingsPanel {
  private tab: SettingsTab = 'video';
  private keys: KeyMap;
  /** Действие, ждущее нажатия клавиши. */
  private capturing: ActionId | null = null;

  constructor(private host: HTMLElement, private opts: SettingsPanelOpts = {}) {
    this.keys = opts.hotkeys?.keymap ?? loadKeyMap();
  }

  render(): void {
    const s = getSettings();
    this.host.innerHTML = `
      <div class="st-tabs">
        ${TABS.map(([id, label]) =>
          `<button class="${id === this.tab ? 'sel' : ''}" data-tab="${id}">${label}</button>`).join('')}
      </div>
      <div class="st-body">${this.bodyFor(s)}</div>
      <div class="st-foot">
        <button class="st-reset" data-reset="${this.tab === 'keys' ? 'keys' : 'all'}">
          ${this.tab === 'keys' ? 'Сбросить клавиши' : 'Сбросить настройки'}
        </button>
      </div>`;
    this.wire();
  }

  private bodyFor(s: Settings): string {
    if (this.tab === 'video') {
      return `
        ${row('Качество', seg<Quality>('quality', s.quality,
          (['low', 'medium', 'high'] as Quality[]).map((q) => [q, QUALITY_PRESETS[q].label])))}
        ${row('Свечение', toggle('bloom', s.bloom))}
        ${row('Виньетка', toggle('vignette', s.vignette))}
        ${row('Зерно', toggle('grain', s.grain))}`;
    }
    if (this.tab === 'audio') {
      return `
        ${row('Общая громкость', slider('master', s.master, 0, 1, 0.05, pct))}
        ${row('Эмбиент', slider('ambient', s.ambient, 0, 1, 0.05, pct))}
        ${row('События', slider('effects', s.effects, 0, 1, 0.05, pct))}`;
    }
    if (this.tab === 'ui') {
      return `
        ${row('Масштаб', slider('uiScale', s.uiScale, UI_SCALE_MIN, UI_SCALE_MAX, 0.05, pct))}
        ${row('Плотность панелей', slider('panelOpacity', s.panelOpacity, 0.5, 1, 0.02, pct))}
        ${row('Сканлайны', toggle('scan', s.scan))}
        ${row('Палитра без красно-зелёного', toggle('colorblind', s.colorblind))}`;
    }
    if (this.tab === 'game') {
      return `
        ${row('Автосохранение', seg('autosaveDays', s.autosaveDays,
          [[180, '180 дн'], [365, '365 дн'], [730, '730 дн']]))}
        ${row('Скорость на старте', seg('startSpeed', s.startSpeed,
          [[0, 'Пауза'], [1, '×1'], [2, '×2'], [3, '×3']]))}`;
    }
    return this.keysBody();
  }

  private keysBody(): string {
    let html = '';
    for (const group of KEY_GROUPS) {
      const items = ACTIONS.filter((a) => a.group === group);
      if (!items.length) continue;
      html += `<div class="st-group">${group}</div>`;
      for (const a of items) {
        const label = this.capturing === a.id ? '…' : keyLabel(this.keys[a.id]);
        html += row(a.label,
          `<button class="st-key ${this.capturing === a.id ? 'wait' : ''}" data-bind="${a.id}">${label}</button>`);
      }
    }
    // Группы флотов не переназначаются: девять пар клавиш дали бы восемнадцать
    // строк, а раскладка 1–9 / Ctrl+1–9 в жанре и так стандартна.
    html += `<div class="st-group">Флоты</div>
      ${row('Выбрать группу', '<span class="st-key fixed">1 … 9</span>')}
      ${row('Назначить группу', '<span class="st-key fixed">Ctrl + 1 … 9</span>')}
      ${row('Показать группу', '<span class="st-key fixed">1 … 9 ×2</span>')}`;
    return html;
  }

  // --- события --------------------------------------------------------------

  private commit(p: Partial<Settings>): void {
    patchSettings(p);
    this.render();
    this.opts.onChange?.();
  }

  private wire(): void {
    const q = <T extends HTMLElement>(sel: string): NodeListOf<T> => this.host.querySelectorAll<T>(sel);

    q<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      this.capturing = null;
      this.opts.hotkeys?.cancelCapture();
      this.tab = b.dataset.tab as SettingsTab;
      this.render();
    }));

    q<HTMLButtonElement>('[data-tog]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.tog as 'bloom' | 'scan' | 'vignette' | 'grain' | 'colorblind';
      this.commit({ [key]: !getSettings()[key] } as Partial<Settings>);
    }));

    q<HTMLButtonElement>('[data-seg]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.seg!;
      const raw = b.dataset.val!;
      const value: string | number = key === 'quality' ? raw : Number(raw);
      this.commit({ [key]: value } as unknown as Partial<Settings>);
    }));

    // Ползунки правятся вживую, но перерисовку экрана делаем только на отпускании:
    // иначе input теряет фокус на каждом кадре перетаскивания.
    q<HTMLInputElement>('[data-num]').forEach((inp) => {
      const key = inp.dataset.num as keyof Settings;
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        patchSettings({ [key]: v } as Partial<Settings>);
        const out = this.host.querySelector(`[data-out="${key}"]`);
        if (out) out.textContent = pct(v);
        this.opts.onChange?.();
      });
    });

    q<HTMLButtonElement>('[data-bind]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.bind as ActionId;
      this.capturing = id;
      this.render();
      this.captureKey((binding) => {
        this.keys = assignBinding(this.keys, id, binding);
        // С запущенной игрой карта уходит в диспетчер (он же её и сохранит),
        // из главного меню — прямо в хранилище.
        if (this.opts.hotkeys) this.opts.hotkeys.setKeyMap(this.keys);
        else saveKeyMap(this.keys);
        this.capturing = null;
        this.render();
      }, () => {
        this.capturing = null;
        this.render();
      });
    }));

    q<HTMLButtonElement>('[data-reset]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.reset === 'keys') {
        this.keys = resetKeyMap();
        this.opts.hotkeys?.setKeyMap(this.keys);
        this.render();
      } else {
        resetSettings();
        this.render();
      }
      this.opts.onChange?.();
    }));
  }

  /**
   * Дождаться нажатия клавиши. Когда игра запущена, перехват идёт через общий
   * диспетчер — иначе он успел бы отработать своё действие раньше нас.
   */
  private captureKey(done: (b: Binding) => void, cancel: () => void): void {
    if (this.opts.hotkeys) {
      this.opts.hotkeys.captureNext((b) => (b.code ? done(b) : cancel()));
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        window.removeEventListener('keydown', onKey, true);
        cancel();
        return;
      }
      if (!bindable(e.code)) return;
      window.removeEventListener('keydown', onKey, true);
      done(bindingOf(e));
    };
    window.addEventListener('keydown', onKey, true);
  }
}
