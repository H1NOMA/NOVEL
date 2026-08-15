import type { FactionId } from '../core/types';
import type { GameState } from '../game/state';
import { disbandFleet, garrisonReinforce, orderFleetTo, splitFleet } from '../game/units';
import {
  buildShipyard, cancelQueue, formFleetFromYard, queueShip, takeStoredShips,
} from '../game/shipyards';
import { buildDepot } from '../game/supply';
import { buildShield, buildStation } from '../game/defense';
import { selectFocus } from '../game/focus';
import { buyBonus } from '../game/politics';
import { buyTruce } from '../game/diplomacy';
import { fireSuperweapon, produceDivision } from '../game/decisions';
import { runRecon, runSabotage, runUprising } from '../game/specops';
import type { Cmd } from './protocol';

// ---------------------------------------------------------------------------
// Единая точка применения приказов. В одиночной партии сюда приходят команды
// самого игрока, в сетевой — ещё и разобранные сообщения клиентов.
//
// Фракция-исполнитель («actor») ВСЕГДА берётся из реестра соединений хоста и
// никогда из тела сообщения: иначе чужой клиент сможет двигать любые флоты.
// Второй слой защиты бесплатный — мутаторы игры сами возвращают false, если
// действие не по правилам или не по карману.
// ---------------------------------------------------------------------------

function ownFleet(state: GameState, actor: FactionId, id: string) {
  const f = state.fleets.get(id);
  return f && f.faction === actor ? f : null;
}

function ownPlanet(state: GameState, actor: FactionId, id: string) {
  const p = state.galaxy.planets.get(id);
  return p && p.owner === actor ? p : null;
}

/** Применить команду от имени фракции. false — команда отклонена. */
export function applyCommand(state: GameState, actor: FactionId, c: Cmd): boolean {
  switch (c.k) {
    case 'orderFleet': {
      const f = ownFleet(state, actor, c.fleet);
      return !!f && orderFleetTo(state, f, c.target, c.invade);
    }
    case 'enqueueOrder': {
      const f = ownFleet(state, actor, c.fleet);
      if (!f) return false;
      f.orderQueue = f.orderQueue ?? [];
      if (f.orderQueue.length >= 6) return false;
      f.orderQueue.push({ target: c.target });
      return true;
    }
    case 'clearOrders': {
      const f = ownFleet(state, actor, c.fleet);
      if (!f) return false;
      f.orderQueue = undefined;
      return true;
    }
    case 'splitFleet': {
      const f = ownFleet(state, actor, c.fleet);
      return !!f && !!splitFleet(state, f);
    }
    case 'disbandFleet': {
      const f = ownFleet(state, actor, c.fleet);
      return !!f && disbandFleet(state, f);
    }
    case 'garrison': {
      const f = ownFleet(state, actor, c.fleet);
      if (!f) return false;
      garrisonReinforce(state, f);
      return true;
    }
    case 'takeStored': {
      // Забирает корабли со склада верфи то соединение, что стоит на орбите.
      const f = ownFleet(state, actor, c.fleet);
      return !!f && takeStoredShips(state, f);
    }
    case 'formFleet':
      return !!ownPlanet(state, actor, c.planet) && !!formFleetFromYard(state, actor, c.planet);
    case 'queueShip':
      return !!ownPlanet(state, actor, c.planet) &&
        queueShip(state, actor, c.planet, c.cls as Parameters<typeof queueShip>[3]);
    case 'cancelQueue':
      return cancelQueue(state, actor, c.planet);
    case 'buildShipyard':
      return !!ownPlanet(state, actor, c.planet) && buildShipyard(state, actor, c.planet);
    case 'buildDepot':
      return !!ownPlanet(state, actor, c.planet) && buildDepot(state, actor, c.planet);
    case 'buildShield':
      return !!ownPlanet(state, actor, c.planet) && buildShield(state, actor, c.planet);
    case 'buildStation':
      return !!ownPlanet(state, actor, c.planet) && buildStation(state, actor, c.planet);
    case 'selectFocus':
      return selectFocus(state, actor, c.focus);
    case 'buyBonus':
      return buyBonus(state, actor, c.bonus);
    case 'buyTruce':
      return buyTruce(state, c.with);
    case 'produceDivision':
      return produceDivision(state, actor, c.troop);
    case 'recon':
      return runRecon(state, actor, c.sector);
    case 'sabotage':
      return runSabotage(state, actor, c.planet);
    case 'uprising':
      return runUprising(state, actor, c.planet);
    case 'fireSuper':
      return fireSuperweapon(state, actor, c.planet);
    default:
      return false;
  }
}
