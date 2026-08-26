import type { GameSpeed } from '../core/types';
import { bus } from '../core/emitter';
import type { GameState } from './state';
import { advanceDay, moveFleets } from './sim';
import { interpolateFleets } from './units';

/** Game-days elapsed per real second at 1× speed. */
const DAYS_PER_SEC = 0.5;
const MAX_STEPS_PER_FRAME = 6;

export class GameClock {
  private dayFloat: number;
  /**
   * Считает ли этот экран мир сам.
   *
   * У клиента сетевой партии — НЕТ. Раньше считали все: клиент крутил
   * собственный advanceDay параллельно с хостом, и каждые 900 мс снапшот
   * сносил результат его вычислений. Бои успевали разрешиться дважды, ИИ
   * отдавал свои приказы, экономика начислялась второй раз — совпадал в итоге
   * только номер дня. Теперь клиент только рисует присланное и плавно тянет
   * корабли между срезами.
   */
  private authoritative = true;

  constructor(private state: GameState) {
    this.dayFloat = state.day;
  }

  /** false — экран клиента: симуляции нет, только показ хозяйского мира. */
  setAuthoritative(v: boolean): void {
    this.authoritative = v;
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

    // Клиент: мир не трогаем, только подтягиваем корабли между снапшотами.
    if (!this.authoritative) {
      interpolateFleets(state, deltaDays);
      this.dayFloat = state.day;
      bus.emit('tick', { day: state.day });
      return;
    }

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
