// Minimal typed event emitter used to decouple game logic from rendering & UI.

type Handler<T> = (payload: T) => void;

export interface GameEvents extends Record<string, unknown> {
  tick: { day: number };
  dayPassed: { day: number };
  speedChanged: { speed: number };
  planetSelected: { id: string | null };
  planetChanged: { id: string };
  /** Планеты, охваченные рамкой выделения ЛКМ. */
  planetsBoxSelected: { ids: string[] };
  /** Клик ПКМ по планете (без перетаскивания) — приказ выбранным флотам. */
  planetRightClicked: { id: string };
  stateChanged: void;
  log: { text: string };
  factionEliminated: { faction: string };
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
