// ---------------------------------------------------------------------------
// Звук войны: всё синтезируется WebAudio на лету — ни одного внешнего файла.
//   • Эмбиент: низкий дрон двух расстроенных осцилляторов + «ветер» из шума.
//   • Интерфейс: короткий блип кнопок.
//   • События: сирена вторжения, чайм успеха, тяжёлый удар потери.
// AudioContext стартует только после первого жеста пользователя (политика
// браузеров); до этого все вызовы тихо игнорируются.
//
// Громкости живут в общей модели настроек (ui/settings), а не в собственном
// ключе: экран настроек один на игру и меню, и своё хранилище здесь только
// плодило бы расхождения.
// ---------------------------------------------------------------------------

import type { FactionId } from '../core/types';
import { getSettings } from './settings';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private fxGain: GainNode | null = null;
  private started = false;

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
    if (this.started) {
      // Вкладка могла усыпить контекст между экранами — будим молча.
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
      return;
    }
    if (typeof AudioContext === 'undefined') return;
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
    const s = getSettings();
    this.masterGain!.gain.value = s.master;
    this.ambientGain!.gain.value = s.ambient * 0.5;
    this.fxGain!.gain.value = s.effects;
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

  // -------------------------------------------------------------------------
  // Стартовые позывные фракций
  //
  // Партия должна начинаться с голоса той стороны, за которую сел играть, —
  // и по одному звуку должно быть ясно, кто ты. Мотивы разведены нарочно
  // далеко друг от друга: у людей — медный марш в мажоре, у машин — удары
  // железа в ритме шага, у иллюминатов — целотонное марево без опоры, у роя —
  // низкий рык и хитиновый треск. Всё синтезируется здесь же: внешних файлов
  // в игре нет и не будет.
  // -------------------------------------------------------------------------

  /** Тон со скольжением высоты — вой сирены, рык, подъём чужого хора. */
  private glide(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, when = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(900, Math.max(f0, f1) * 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.05, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(lp).connect(g).connect(this.fxGain!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** Шумовой удар с полосовым фильтром: лязг брони, дробь, хитиновый треск. */
  private noise(dur: number, vol: number, freq: number, q: number, when = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(this.fxGain!);
    src.start(t0);
    src.stop(t0 + dur);
  }

  /** Аккорд: несколько тонов разом, чуть расстроенных для «живости». */
  private chord(freqs: number[], dur: number, type: OscillatorType, vol: number, when = 0): void {
    freqs.forEach((f, i) => this.tone(f * (1 + (i - 1) * 0.0015), dur, type, vol, when));
  }

  /**
   * Позывной начала партии. Играется один раз при входе в галактику.
   * Неизвестная фракция получает мотив Супер-Земли — молчания быть не должно.
   */
  fanfare(faction: FactionId): void {
    this.ensure();
    if (!this.ctx) return;
    switch (faction) {
      case 'automatons': return this.fanfareAutomatons();
      case 'illuminate': return this.fanfareIlluminate();
      case 'terminids': return this.fanfareTerminids();
      case 'superFederation': return this.fanfareFederation();
      default: return this.fanfareSuperEarth();
    }
  }

  /** Супер-Земля: медный марш в мажоре и дробь — гимн Управляемой Демократии. */
  private fanfareSuperEarth(): void {
    // До-мажорное трезвучие вверх с квартовым разбегом, как у военного горна.
    const notes: [number, number, number][] = [
      [392, 0.16, 0.00], // соль
      [523, 0.16, 0.16], // до
      [659, 0.20, 0.32], // ми
      [784, 0.55, 0.52], // соль октавой выше — держим
    ];
    for (const [f, d, t] of notes) {
      this.tone(f, d, 'triangle', 0.075, t);
      this.tone(f / 2, d, 'sine', 0.05, t);   // подкладка октавой ниже
    }
    this.chord([262, 330, 392], 0.9, 'triangle', 0.035, 0.52);
    // Дробь малого барабана под разбег.
    for (let i = 0; i < 5; i++) this.noise(0.05, 0.05, 1800, 1.2, i * 0.085);
    this.noise(0.35, 0.09, 900, 0.7, 0.52);
  }

  /** Автоматоны: удары железа в ритме марша и низкий гул литейной. */
  private fanfareAutomatons(): void {
    // Четыре шага стального легиона: удар — лязг — удар — лязг.
    for (let i = 0; i < 4; i++) {
      const t = i * 0.24;
      this.tone(62, 0.20, 'square', 0.09, t);
      this.noise(0.12, 0.075, 2600 + i * 140, 3.2, t + 0.02);
    }
    // Сигнал Сената: две низкие ноты в миноре, вторая ползёт вниз.
    this.tone(146, 0.34, 'sawtooth', 0.06, 0.96);
    this.glide(174, 116, 0.75, 'sawtooth', 0.07, 1.30);
    this.tone(58, 1.10, 'sine', 0.10, 0.96);
  }

  /** Иллюминаты: целотонное марево, шёпот из складки пространства. */
  private fanfareIlluminate(): void {
    // Целотонный ряд не имеет тоники — опоры под ногами не остаётся.
    const wholeTone = [415, 466, 523, 587, 659];
    wholeTone.forEach((f, i) => {
      this.tone(f, 1.0, 'sine', 0.045, i * 0.11);
      this.tone(f * 1.002, 1.0, 'sine', 0.035, i * 0.11 + 0.02); // биения хора
    });
    // Подъём из ниоткуда и обрыв — как открывшийся портал.
    this.glide(180, 720, 1.05, 'sine', 0.055, 0.10);
    this.glide(1400, 520, 0.85, 'sine', 0.03, 0.75);
    this.noise(1.20, 0.022, 3400, 0.8, 0.10);
  }

  /** Терминиды: подземный рык улья и хитиновый треск роя. */
  private fanfareTerminids(): void {
    // Рык: пила сползает вниз через лоупас — голос чего-то очень большого.
    this.glide(120, 44, 1.15, 'sawtooth', 0.11);
    this.glide(184, 66, 0.95, 'sawtooth', 0.055, 0.18);
    // Треск: россыпь коротких шумовых щелчков в верхней полосе.
    for (let i = 0; i < 14; i++) {
      this.noise(0.035, 0.028, 2400 + (i % 5) * 460, 6, 0.25 + i * 0.055);
    }
    this.tone(41, 1.4, 'sine', 0.10, 0.1);
  }

  /** Супер-Федерация: тот же горн, но надтреснутый — мажор сползает в минор. */
  private fanfareFederation(): void {
    this.tone(392, 0.16, 'triangle', 0.07);
    this.tone(523, 0.16, 'triangle', 0.07, 0.16);
    this.glide(659, 622, 0.60, 'triangle', 0.075, 0.32);
    this.chord([262, 311, 392], 0.9, 'triangle', 0.04, 0.42);
    for (let i = 0; i < 3; i++) this.noise(0.06, 0.05, 1500, 1.0, i * 0.1);
  }
}
