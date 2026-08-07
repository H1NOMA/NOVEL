import type { GameState } from '../game/state';
import { yardsOf } from '../game/shipyards';

// ---------------------------------------------------------------------------
// Интерактивный туториал: цепочка первых шагов для новой кампании.
// Каждый шаг ждёт РЕАЛЬНОГО действия игрока и сам переходит к следующему.
// Показывается один раз (localStorage) и только на свежей партии.
// ---------------------------------------------------------------------------

const DONE_KEY = 'sgw2_tutorial_done';

export interface TutorialStep {
  id: string;
  text: string;
  /** Выполнен ли шаг (проверяется на каждом тике). */
  done(state: GameState): boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'speed',
    text: 'Запустите время: клавиша <kbd>1</kbd> или кнопка 1× в шапке.',
    done: (s) => s.speed > 0 || s.day > 3,
  },
  {
    id: 'select',
    text: 'Выберите соединение: щёлкните карточку внизу экрана, затем «ВЫБРАТЬ» в карточке планеты — или сразу кнопку на карточке силы.',
    done: (s) => !!s.selectedFleet,
  },
  {
    id: 'order',
    text: 'Отдайте приказ: ПКМ по своей планете — перелёт, по вражеской — вторжение. Shift+ПКМ добавит цель в очередь.',
    done: (s) => [...s.fleets.values()].some((f) => f.faction === s.player && (f.transit || (f.order && f.order.kind !== 'idle'))),
  },
  {
    id: 'focus',
    text: 'Назначьте национальный фокус: клавиша <kbd>F</kbd> или кнопка ◈ слева.',
    done: (s) => !!s.factions[s.player].activeFocus || s.factions[s.player].completedFocus.length > 0,
  },
  {
    id: 'yard',
    text: 'Постройте корабли: откройте ⚒ Производство и поставьте заказ на верфи столицы.',
    done: (s) => yardsOf(s, s.player).some((p) => p.shipyard!.queue !== null || (p.shipyard!.stored.ships + p.shipyard!.stored.dreadnoughts + p.shipyard!.stored.battleships) > 0),
  },
];

export function tutorialDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return true;
  }
}

export function markTutorialDone(): void {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch { /* приватный режим — просто не запомним */ }
}
