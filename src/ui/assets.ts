/**
 * Плейсхолдер-ассеты. Пока нет арта, фоны — CSS-градиенты, спрайты —
 * силуэты. Когда появится арт, id остаются теми же, меняется только
 * этот манифест (на пути к картинкам/atlas). Сценарий не трогаем.
 */

export const backgrounds: Record<string, string> = {
  void: 'radial-gradient(ellipse at 50% 60%, #16161f 0%, #05050a 70%)',
  polygon:
    'linear-gradient(180deg, #1b2440 0%, #232f52 45%, #2c3a63 60%, #1a2033 100%)',
  ruins: 'linear-gradient(180deg, #241f33 0%, #3a2f4d 55%, #241c2e 100%)',
  dawn: 'linear-gradient(180deg, #2b3a67 0%, #a2647f 60%, #e8a87c 100%)'
};

export interface SpritePlaceholder {
  /** Цвет силуэта. */
  color: string;
  /** Подпись на плейсхолдере. */
  label: string;
}

export const sprites: Record<string, SpritePlaceholder> = {
  guide: { color: '#7ec8e3', label: 'Проводница' }
};

/** Музыка пока не подключена; манифест зарезервирован под этап P2 (см. ROADMAP). */
export const music: Record<string, string> = {
  ambient: ''
};
