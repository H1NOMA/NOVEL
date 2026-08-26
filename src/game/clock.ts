import type { GameSpeed } from '../core/types';
import { bus } from '../core/emitter';
import type { GameState } from './state';
import { advanceDay, moveFleets } from './sim';

/** Game-days elapsed per real second at 1× speed. */
const DAYS_PER_SEC = 0.5;
const MAX_STEPS_PER_FRAME = 6;

export class GameClock {
  private dayFloat: number;

  constructor(private state: GameState) {
    this.dayFloat = state.day;
  }

  setSpeed(speed: GameSpeed): void {
    this.state.speed = speed;
    bus.emit('speedChanged', { speed });
  }

  /**
   * Шаг симуляции. Собственного requestAnimationFrame у часов нет намеренно:
   * два независимых цикла (симуляция и рендер) просыпались в разные моменты
   * кадра, и флоты дёргались — сцена рисовала положение, посчитанное на
   * прошлый вызов. Теперь один цикл в main.ts двигает и то и другое.
   */
  frame(dt: number): void {
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
