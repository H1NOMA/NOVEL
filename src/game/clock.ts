import type { GameSpeed } from '../core/types';
import { bus } from '../core/emitter';
import type { GameState } from './state';
import { advanceDay, moveFleets } from './sim';

/** Game-days elapsed per real second at 1× speed. */
const DAYS_PER_SEC = 0.5;
const MAX_STEPS_PER_FRAME = 6;

export class GameClock {
  private dayFloat: number;
  private last = 0;
  private raf = 0;
  private running = false;

  constructor(private state: GameState) {
    this.dayFloat = state.day;
  }

  setSpeed(speed: GameSpeed): void {
    this.state.speed = speed;
    bus.emit('speedChanged', { speed });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame(dt: number): void {
    const { state } = this;
    if (state.speed === 0 || state.winner) {
      bus.emit('tick', { day: state.day });
      return;
    }
    const deltaDays = dt * DAYS_PER_SEC * state.speed;
    // Smoothly move fleets across the elapsed fraction of days.
    moveFleets(state, deltaDays);
    this.dayFloat += deltaDays;

    let steps = 0;
    while (state.day < Math.floor(this.dayFloat) && steps < MAX_STEPS_PER_FRAME) {
      advanceDay(state);
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.dayFloat = state.day; // avoid runaway

    bus.emit('tick', { day: state.day });
  }
}
