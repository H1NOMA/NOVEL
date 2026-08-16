// ---------------------------------------------------------------------------
// Звук войны: всё синтезируется WebAudio на лету — ни одного внешнего файла.
//   • Эмбиент: низкий дрон двух расстроенных осцилляторов + «ветер» из шума.
//   • Интерфейс: короткий блип кнопок.
//   • События: сирена вторжения, чайм успеха, тяжёлый удар потери.
// AudioContext стартует только после первого жеста пользователя (политика
// браузеров); до этого все вызовы тихо игнорируются.
// ---------------------------------------------------------------------------

const STORE_KEY = 'sgw2_sound';

export interface SoundSettings {
  master: number;   // 0..1
  ambient: number;  // 0..1
  effects: number;  // 0..1
}

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { master: 0.8, ambient: 0.5, effects: 0.8, ...JSON.parse(raw) as Partial<SoundSettings> };
  } catch { /* повреждённые настройки — берём умолчания */ }
  return { master: 0.8, ambient: 0.5, effects: 0.8 };
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private fxGain: GainNode | null = null;
  private started = false;
  settings: SoundSettings = loadSettings();

  /** Инициализация по первому жесту (клик/клавиша) — политика браузеров. */
  armOnFirstGesture(): void {
    const start = () => {
      this.ensure();
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  private ensure(): void {
    if (this.started || typeof AudioContext === 'undefined') return;
    this.started = true;
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.connect(this.masterGain);
    this.fxGain = this.ctx.createGain();
    this.fxGain.connect(this.masterGain);
    this.applyVolumes();
    this.startAmbient();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.masterGain!.gain.value = this.settings.master;
    this.ambientGain!.gain.value = this.settings.ambient * 0.5;
    this.fxGain!.gain.value = this.settings.effects;
  }

  save(): void {
    localStorage.setItem(STORE_KEY, JSON.stringify(this.settings));
    this.applyVolumes();
  }

  /** Низкий дрон карты: две расстроенные пилы через лоупас + шум-«ветер». */
  private startAmbient(): void {
    const ctx = this.ctx!;
    const drone = ctx.createGain();
    drone.gain.value = 0.042;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 130;
    drone.connect(lp).connect(this.ambientGain!);
    for (const [freq, detune] of [[55, 0], [55, 7], [110, -5]] as const) {
      const osc = ctx.createOscillator();
      // Треугольник вместо пилы: у дрона нет жёстких верхних гармоник.
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(drone);
      osc.start();
    }
    // медленное «дыхание» дрона
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(drone.gain);
    lfo.start();

    // ветер: белый шум через узкий лоупас
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nlp = ctx.createBiquadFilter();
    nlp.type = 'lowpass';
    nlp.frequency.value = 260;
    const ngain = ctx.createGain();
    ngain.gain.value = 0.012;
    noise.connect(nlp).connect(ngain).connect(this.ambientGain!);
    noise.start();
  }

  /**
   * Короткий тон. Атака намеренно не мгновенная: скачок громкости от нуля
   * даёт щелчок в динамике, поэтому у каждого звука есть фейд-ин в несколько
   * миллисекунд. Верхние гармоники срезаются мягким лоупасом — от этого
   * пилы и квадраты перестают резать слух.
   */
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(900, freq * 4);
    lp.Q.value = 0.4;
    const g = ctx.createGain();
    const attack = Math.min(0.02, dur * 0.35);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(lp).connect(g).connect(this.fxGain!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** Блип кнопки интерфейса. */
  click(): void {
    // Треугольник вместо квадрата и вдвое тише: клик стал глуше и деликатнее.
    this.tone(760, 0.055, 'triangle', 0.035);
  }

  /** Сирена вторжения: три двутональных такта. */
  siren(): void {
    // Две ноты вместо трёх тактов пилы: тревога слышна, но не сверлит.
    for (let i = 0; i < 2; i++) {
      this.tone(560, 0.22, 'triangle', 0.055, i * 0.42);
      this.tone(740, 0.22, 'triangle', 0.05, i * 0.42 + 0.21);
    }
  }

  /** Чайм успеха: восходящая пара нот. */
  chime(): void {
    this.tone(587, 0.24, 'sine', 0.07);
    this.tone(880, 0.42, 'sine', 0.055, 0.13);
  }

  /** Тяжёлый удар потери: низкий тон + шумовой хлопок. */
  thud(): void {
    this.tone(84, 0.62, 'sine', 0.16);
    this.tone(56, 0.78, 'sine', 0.11, 0.04);
  }
}
