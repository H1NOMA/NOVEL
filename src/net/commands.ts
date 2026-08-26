import type { FactionId } from '../core/types';
import type { GameState } from '../game/state';
import { disbandFleet, garrisonReinforce, mergeFleets, orderFleetTo, splitFleet } from '../game/units';
import {
  buildShipyard, cancelQueue, formFleetFromYard, queueShip, takeStoredShips,
} from '../game/shipyards';
import { buildDepot } from '../game/supply';
import { buildShield, buildStation } from '../game/defense';
import { selectFocus } from '../game/focus';
import { buyBonus } from '../game/politics';
import { buyTruce } from '../game/diplomacy';
import {
  buildE711Station, buildSpecialDock, enableE711Mining, fireSuperweapon, installTermicide,
  plantGloomSeed, produceDivision, raiseSpire, rebuildSpecial,
} from '../game/decisions';
import { runRecon, runSabotage, runUprising } from '../game/specops';
import { cedePlanet, declareWar, makePeace } from '../game/relations';
import { cycleCommander } from '../game/commanders';
import { resolveChoice } from '../game/events';
import { fleetsAt } from '../game/state';
import type { Cmd } from './protocol';

/** Объявление войны стоит политвласти: решение должно быть весомым. */
export const WAR_DECLARATION_COST = 40;

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
    case 'mergeFleets': {
      // Каждое соединение проверяется на принадлежность отдельно: клиент не
      // должен уметь слить чужие корабли в свои, прислав их идентификаторы.
      const target = ownFleet(state, actor, c.target);
      if (!target) return false;
      const sources = c.sources
        .map((id) => ownFleet(state, actor, id))
        .filter((f): f is NonNullable<typeof f> => !!f);
      return mergeFleets(state, target, sources) > 0;
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
      return buyTruce(state, actor, c.with);
    case 'produceDivision':
      return produceDivision(state, actor, c.troop);
    case 'recon':
      return runRecon(state, actor, c.planet);
    case 'sabotage':
      return runSabotage(state, actor, c.planet);
    case 'uprising':
      return runUprising(state, actor, c.planet);
    case 'fireSuper':
      return fireSuperweapon(state, actor, c.planet);

    // --- Общее время партии -------------------------------------------------
    //
    // Скорость и пауза — параметр СТОЛА, а не экрана: если один поставил на
    // паузу, мир стоит у всех. Поэтому команду принимает любой живой участник
    // без дополнительных проверок владения.
    case 'setSpeed': {
      const v = Math.max(0, Math.min(3, Math.round(c.speed))) as 0 | 1 | 2 | 3;
      if (state.speed === v) return false;
      state.speed = v;
      return true;
    }

    // --- Планы атак ---------------------------------------------------------
    case 'planAttack': {
      const from = ownPlanet(state, actor, c.from);
      const to = state.galaxy.planets.get(c.to);
      if (!from || !to || to.owner === actor || !from.links.includes(c.to)) return false;
      if (state.attackPlans.some((p) => p.from === c.from && p.to === c.to && p.faction === actor)) return false;
      state.attackPlans.push({ from: c.from, to: c.to, faction: actor });
      return true;
    }
    case 'unplanAttack': {
      const before = state.attackPlans.length;
      state.attackPlans = state.attackPlans.filter(
        (p) => !(p.from === c.from && p.to === c.to && (p.faction ?? actor) === actor));
      return state.attackPlans.length < before;
    }
    case 'launchAttack': {
      const from = ownPlanet(state, actor, c.from);
      const to = state.galaxy.planets.get(c.to);
      if (!from || !to) return false;
      let sent = 0;
      for (const f of fleetsAt(state, c.from)) {
        if (f.faction !== actor) continue;
        if (orderFleetTo(state, f, c.to, true)) sent++;
      }
      return sent > 0;
    }

    // --- Постройки и фракционные решения ------------------------------------
    case 'buildSpecialDock':
      return buildSpecialDock(state, actor, c.planet);
    case 'buildE711Station':
      // Станции добычи ставит только Супер-Земля и только на своих марионетках —
      // остальное проверяет сам мутатор.
      return actor === 'superEarth' && buildE711Station(state, c.planet);
    case 'enableE711':
      return actor === 'superEarth' && enableE711Mining(state);
    case 'rebuildSpecial':
      return rebuildSpecial(state, actor);
    case 'installTermicide':
      return actor === 'superEarth' && installTermicide(state, c.planet);
    case 'plantGloom':
      return actor === 'terminids' && plantGloomSeed(state, c.planet);
    case 'raiseSpire':
      return actor === 'illuminate' && raiseSpire(state, c.planet);

    // --- Дипломатия ---------------------------------------------------------
    case 'cedePlanet':
      return !!ownPlanet(state, actor, c.planet) && cedePlanet(state, actor, c.to, c.planet);
    case 'declareWar': {
      const fs = state.factions[actor];
      if (!fs?.alive || fs.politicalPower < WAR_DECLARATION_COST) return false;
      if (!declareWar(state, actor, c.on, 'решение верховного командования')) return false;
      fs.politicalPower -= WAR_DECLARATION_COST;
      return true;
    }
    case 'makePeace':
      return makePeace(state, actor, c.with);

    // --- Прочее -------------------------------------------------------------
    case 'cycleCommander': {
      const f = ownFleet(state, actor, c.fleet);
      if (!f) return false;
      cycleCommander(state, f);
      return true;
    }
    case 'resolveChoice':
      return resolveChoice(state, actor, c.event, c.choice);

    default:
      return false;
  }
}
