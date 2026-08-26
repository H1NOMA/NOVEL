import type { FactionId } from '../core/types';

// ---------------------------------------------------------------------------
// Протокол сетевой партии. Модель — авторитетный хост: симуляцию крутит только
// он, клиенты присылают команды и получают состояние. Единственный источник
// правды о формате сообщений — этот файл.
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 47624;

/** Команда игрока. Хост проверяет право на неё и применяет у себя. */
export type Cmd =
  | { k: 'orderFleet'; fleet: string; target: string; invade: boolean }
  | { k: 'enqueueOrder'; fleet: string; target: string }
  | { k: 'clearOrders'; fleet: string }
  | { k: 'splitFleet'; fleet: string }
  | { k: 'disbandFleet'; fleet: string }
  | { k: 'garrison'; fleet: string }
  | { k: 'takeStored'; fleet: string }
  | { k: 'formFleet'; planet: string }
  | { k: 'queueShip'; planet: string; cls: string }
  | { k: 'cancelQueue'; planet: string }
  | { k: 'buildShipyard'; planet: string }
  | { k: 'buildDepot'; planet: string }
  | { k: 'buildShield'; planet: string }
  | { k: 'buildStation'; planet: string }
  | { k: 'selectFocus'; focus: string }
  | { k: 'buyBonus'; bonus: string }
  | { k: 'buyTruce'; with: FactionId }
  | { k: 'produceDivision'; troop: string }
  | { k: 'recon'; sector: string }
  | { k: 'sabotage'; planet: string }
  | { k: 'uprising'; planet: string }
  | { k: 'fireSuper'; planet: string };

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
  /** Любой → любому: разрыв. */
  | { k: 'bye'; reason: string };
