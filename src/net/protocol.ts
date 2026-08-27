import type { FactionId, GameSpeed } from '../core/types';

// ---------------------------------------------------------------------------
// Протокол сетевой партии. Модель — авторитетный хост: симуляцию крутит только
// он, клиенты присылают команды и получают состояние. Единственный источник
// правды о формате сообщений — этот файл.
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = 5;
export const DEFAULT_PORT = 47624;

/**
 * Команда игрока. Хост проверяет право на неё и применяет у себя.
 *
 * ЗДЕСЬ ДОЛЖНО БЫТЬ ВСЁ, что игрок вообще способен сделать с миром. Интерфейс
 * не имеет права менять состояние напрямую: в одиночной партии команда идёт в
 * applyCommand локально, в сетевой — уезжает хосту. Один код исполнения на оба
 * случая — единственный способ не разъехаться.
 */
export type Cmd =
  | { k: 'orderFleet'; fleet: string; target: string; invade: boolean }
  | { k: 'enqueueOrder'; fleet: string; target: string }
  | { k: 'clearOrders'; fleet: string }
  | { k: 'splitFleet'; fleet: string }
  | { k: 'mergeFleets'; target: string; sources: string[] }
  | { k: 'disbandFleet'; fleet: string }
  | { k: 'garrison'; fleet: string }
  | { k: 'takeStored'; fleet: string }
  | { k: 'formFleet'; planet: string }
  /** Редактор соединений: сборка флота и десанта по заданному составу. */
  | { k: 'composeFleet'; planet: string; ships: number; dreadnoughts: number;
      battleships: number; transports: number; troops: Record<string, number> }
  | { k: 'queueShip'; planet: string; cls: string }
  | { k: 'cancelQueue'; planet: string }
  /** Свернуть стройку на планете (возврат половины вложенного). */
  | { k: 'cancelBuild'; planet: string }
  | { k: 'buildShipyard'; planet: string }
  | { k: 'buildDepot'; planet: string }
  | { k: 'buildShield'; planet: string }
  | { k: 'buildStation'; planet: string }
  | { k: 'selectFocus'; focus: string }
  | { k: 'buyBonus'; bonus: string }
  | { k: 'buyTruce'; with: FactionId }
  | { k: 'produceDivision'; troop: string }
  | { k: 'recon'; planet: string }
  | { k: 'sabotage'; planet: string }
  | { k: 'uprising'; planet: string }
  | { k: 'fireSuper'; planet: string }
  // --- раунд 51: остальное, что раньше интерфейс делал мимо сети ---
  /** Скорость партии общая: её меняет любой игрок, применяет хост. */
  | { k: 'setSpeed'; speed: GameSpeed }
  | { k: 'planAttack'; from: string; to: string }
  | { k: 'unplanAttack'; from: string; to: string }
  | { k: 'launchAttack'; from: string; to: string }
  | { k: 'buildSpecialDock'; planet: string }
  | { k: 'buildE711Station'; planet: string }
  | { k: 'enableE711' }
  | { k: 'rebuildSpecial' }
  | { k: 'installTermicide'; planet: string }
  | { k: 'plantGloom'; planet: string }
  | { k: 'raiseSpire'; planet: string }
  | { k: 'cedePlanet'; to: FactionId; planet: string }
  | { k: 'declareWar'; on: FactionId }
  | { k: 'makePeace'; with: FactionId }
  | { k: 'cycleCommander'; fleet: string }
  /** Иллюминаты: прыжок соединения через Бездну к любому миру галактики. */
  | { k: 'warpFleet'; fleet: string; target: string }
  | { k: 'resolveChoice'; event: string; choice: number };

export interface LobbySlot {
  faction: FactionId;
  /** Кто занял место: 'host', идентификатор пира или null — свободно (ИИ). */
  takenBy: string | null;
  name: string;
}

/**
 * Строка списка игроков. Отличается от LobbySlot тем, что перечисляет ЛЮДЕЙ,
 * а не места: подключившийся, но ещё не выбравший сторону виден сразу, и его
 * можно исключить до того, как он что-то займёт.
 */
export interface PartyMember {
  /** Идентификатор соединения; у хоста — 'host'. */
  peer: string;
  name: string;
  faction: FactionId | null;
  isHost: boolean;
  /**
   * Задержка до хоста в миллисекундах; null — ещё не измерена.
   * У самого хоста всегда 0: до себя ходить некуда.
   */
  ping?: number | null;
}

export type NetMessage =
  /** Клиент → хост, первым делом. */
  | { k: 'hello'; version: number; name: string }
  /** Хост → клиенту в ответ: кто он, что в лобби и код партии. */
  | { k: 'welcome'; version: number; peer: string; slots: LobbySlot[];
      members?: PartyMember[]; code?: string | null }
  /** Хост → всем: состав лобби изменился. */
  | { k: 'lobby'; slots: LobbySlot[]; members?: PartyMember[]; code?: string | null }
  /** Клиент → хост: занять фракцию. */
  | { k: 'claim'; faction: FactionId }
  /** Хост → всем: партия началась, вот полное состояние. */
  | { k: 'start'; faction: FactionId; snapshot: string }
  /** Хост → всем: очередной срез состояния. */
  | { k: 'snapshot'; snapshot: string }
  /** Клиент → хост: приказ. */
  | { k: 'cmd'; cmd: Cmd }
  /** Хост → клиенту: приказ отклонён. */
  | { k: 'nak'; reason: string }
  /** Клиент → хост: потерял нить, пришли состояние целиком. */
  | { k: 'resync' }
  /** Хост → клиенту: замер задержки. Клиент обязан вернуть тот же штамп. */
  | { k: 'ping'; t: number }
  /** Клиент → хосту: эхо замера. */
  | { k: 'pong'; t: number }
  /** Любой → любому: разрыв. */
  | { k: 'bye'; reason: string };
