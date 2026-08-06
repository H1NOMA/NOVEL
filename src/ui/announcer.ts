// ---------------------------------------------------------------------------
// Голос Верховного командования: англоязычный диктор в духе военной
// пропаганды. Собственные тексты; озвучка — системный TTS (Web Speech API),
// низкий тон и мерная подача. Никаких внешних аудиофайлов.
// ---------------------------------------------------------------------------

const STORE_KEY = 'sgw2_announcer';

export class Announcer {
  private voice: SpeechSynthesisVoice | null = null;
  private queue: string[] = [];
  private speaking = false;
  private _enabled: boolean;
  /** Не давать диктору тараторить: не чаще одной фразы в 4 секунды. */
  private lastSpoken = 0;

  constructor() {
    this._enabled = (localStorage.getItem(STORE_KEY) ?? 'on') === 'on';
    if (!this.supported) return;
    // Голоса подгружаются асинхронно — ловим список, когда он готов.
    const pick = () => this.pickVoice();
    pick();
    window.speechSynthesis.addEventListener?.('voiceschanged', pick);
  }

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  get enabled(): boolean {
    return this._enabled && this.supported;
  }

  toggle(): boolean {
    this._enabled = !this._enabled;
    localStorage.setItem(STORE_KEY, this._enabled ? 'on' : 'off');
    if (!this._enabled && this.supported) {
      window.speechSynthesis.cancel();
      this.queue = [];
      this.speaking = false;
    }
    return this._enabled;
  }

  /** Английский голос пониже и посуровее: предпочитаем известные мужские. */
  private pickVoice(): void {
    if (!this.supported) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    const prefer = ['Daniel', 'Google UK English Male', 'Microsoft David', 'Google US English', 'Alex'];
    for (const name of prefer) {
      const v = voices.find((vc) => vc.name.includes(name));
      if (v) { this.voice = v; return; }
    }
    this.voice = voices.find((v) => v.lang.startsWith('en')) ?? voices[0] ?? null;
  }

  /** Произнести фразу (ставится в очередь; дубли подряд отбрасываются). */
  say(text: string): void {
    if (!this.enabled) return;
    const now = Date.now();
    // Плотный поток событий: держим очередь короткой.
    if (this.queue.length >= 2 || this.queue[this.queue.length - 1] === text) return;
    if (!this.speaking && now - this.lastSpoken < 4000) return;
    this.queue.push(text);
    if (!this.speaking) this.next();
  }

  private next(): void {
    const text = this.queue.shift();
    if (!text) { this.speaking = false; return; }
    this.speaking = true;
    this.lastSpoken = Date.now();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? 'en-US';
    // Низкий тон и мерная подача — суровый голос командования.
    u.pitch = 0.62;
    u.rate = 0.92;
    u.volume = 1;
    u.onend = () => this.next();
    u.onerror = () => this.next();
    window.speechSynthesis.speak(u);
  }
}

// --- Тексты диктора (собственные, в духе «управляемой демократии») ---------

export const VOICE_LINES = {
  gameStart: 'The Second Galactic War has begun. Spread managed democracy, soldier.',
  incursion: 'Enemy incursion detected. All defenders, report to your stations.',
  siege: 'One of our worlds has been cut off. Hold the line until relief arrives.',
  planetLost: 'A planet has fallen to the enemy. Super Earth demands retribution.',
  planetLiberated: 'Planet liberated. Sweet liberty prevails.',
  capitalLost: 'Our capital is compromised. This is a dark day for democracy.',
  objectiveDone: 'Major order complete. Your service honors Super Earth.',
  enemyDefeated: 'An enemy of freedom has been eradicated. Democracy delivered.',
  playerDefeated: 'Command network failing. Remember your oath. Liberty never dies.',
  victory: 'Total victory. The galaxy is free. Democracy has prevailed.',
  truce: 'A ceasefire has been signed. Stay vigilant: peace is temporary.',
  superweapon: 'Orbital superweapon discharged. Target planet eliminated.',
  specops: 'Covert operation executed. The Ministry of Truth denies everything.',
} as const;
