// Minimal typed event emitter used to decouple game logic from rendering & UI.

type Handler<T> = (payload: T) => void;

export interface GameEvents extends Record<string, unknown> {
  tick: { day: number };
  dayPassed: { day: number };
  speedChanged: { speed: number };
  planetSelected: { id: string | null };
  /** Планеты, охваченные рамкой выделения ЛКМ. */
  planetsBoxSelected: { ids: string[] };
  /** Клик ПКМ по планете (без перетаскивания) — приказ выбранным флотам.
   *  С Shift приказ добавляется в очередь, а не заменяет текущий. */
  planetRightClicked: { id: string; queue?: boolean };
  /** Боевая тревога: кликабельное оповещение с перелётом камеры к планете.
   *  voice — вид события для звукового сопровождения (thud при потере мира). */
  combatAlert: { planetId: string; text: string; tone: 'bad' | 'alert' | 'good'; voice?: string };
  /** Планета сменила владельца (для диктора и оповещений). */
  planetCaptured: { id: string; by: string; prev: string };
  stateChanged: void;
  factionDefeated: { faction: string; by: string | null };
  /** Сюжетный ивент таймлайна (крупный — показывается баннером). */
  gameEvent: { title: string; text: string };
  superFederationRose: void;
  focusCompleted: { faction: string; id: string };
}

export class Emitter<E extends Record<string, unknown>> {
  private handlers: { [K in keyof E]?: Set<Handler<E[K]>> } = {};

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    (this.handlers[type] ??= new Set()).add(fn);
    return () => this.handlers[type]?.delete(fn);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    this.handlers[type]?.forEach((fn) => fn(payload));
  }
}

export const bus = new Emitter<GameEvents>();
