import type { FactionId } from '../core/types';
import { FACTIONS, FACTION_IDS } from '../data/factions';
import { bus } from '../core/emitter';
import { fleetsOf, isHuman, planetsOf, pushChronicle, pushLog, snapshotControl, type GameState } from './state';
import { collectTribute, stepRelations } from './relations';
import { careerFinish, careerSync } from './career';
import { stepAiDiplomacy, stepDiploEvents } from './diploEvents';
import { aiBuild, runAI, runEconomy } from './ai';
import { stepFocus } from './focus';
import { resolveBombardment, resolveGround, resolveOrbital } from './combat';
import { garrisonReinforce, stepFleets } from './units';
import { recomputeSupply } from './supply';
import { stepDecisions } from './decisions';
import { stepShipyards } from './shipyards';
import { stepConstruction } from './construction';
import { stepEvents } from './events';
import { stepTruces } from './diplomacy';
import { checkObjectives } from './objectives';
import { autosaveTick } from './persist';
import { stepRecons } from './specops';
import { orderFleetTo } from './units';
import { hostileNow } from './diplomacy';

/** Continuous fleet movement — called every animation frame with elapsed days. */
export function moveFleets(state: GameState, days: number): void {
  if (days <= 0) return;
  const arrived = stepFleets(state, days);
  for (const f of arrived) {
    const planet = state.galaxy.planets.get(f.at);
    if (!planet) continue;
    if (f.order?.kind === 'reinforce' && planet.owner === f.faction) {
      garrisonReinforce(state, f);
    } else {
      f.order = { kind: 'idle' };
    }
    // Планировщик: по прибытии флот берёт следующий приказ из очереди.
    // Прилетев вторгаться, флот остаётся штурмовать — очередь продолжится
    // после захвата цели (см. advanceDay).
    if (f.orderQueue?.length && !hostileNow(state, f.faction, planet.owner)) {
      const next = f.orderQueue.shift()!;
      if (!f.orderQueue.length) f.orderQueue = undefined;
      const dest = state.galaxy.planets.get(next.target);
      if (dest) {
        const invade = hostileNow(state, f.faction, dest.owner) && dest.owner !== f.faction;
        orderFleetTo(state, f, next.target, invade);
      }
    }
  }
}

/** Discrete once-per-day simulation step: economy, focus, AI orders, combat. */
export function advanceDay(state: GameState): void {
  state.day++;

  const activeFactions: FactionId[] = [...FACTION_IDS];
  if (state.superFederationRisen) activeFactions.push('superFederation');

  for (const fid of activeFactions) {
    runEconomy(state, fid);
    stepFocus(state, fid);
  }
  for (const fid of activeFactions) {
    if (!isHuman(state, fid)) runAI(state, fid);
  }

  recomputeSupply(state);
  stepShipyards(state);
  stepConstruction(state);
  resolveOrbital(state);
  // Обстрел непрокрытых миров идёт ДО наземного боя: гарнизон, по которому
  // всю ночь работали с орбиты, встречает десант уже поредевшим.
  resolveBombardment(state);
  resolveGround(state);
  stepDecisions(state);
  stepEvents(state);
  stepTruces(state);
  stepRelations(state);
  stepDiploEvents(state);
  stepAiDiplomacy(state);
  collectTribute(state);
  stepRecons(state);
  checkObjectives(state);

  // ИИ строит: верфи в тылу, щиты и станции на фронте, точки снабжения в узлах.
  for (const fid of activeFactions) {
    if (!isHuman(state, fid) && state.day % 6 === 0) aiBuild(state, fid);
  }

  // Обломки на орбитах постепенно тают.
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    if (p.wreckage && !p.shattered) {
      p.wreckage *= 0.965;
      if (p.wreckage < 0.4) p.wreckage = undefined;
    }
  }

  // Планировщик: захватив цель (или освободившись), флот берёт следующий приказ.
  for (const fid of state.fleetOrder) {
    const f = state.fleets.get(fid);
    if (!f || f.transit || !f.orderQueue?.length) continue;
    const here = state.galaxy.planets.get(f.at);
    if (!here) continue;
    if (here.owner === f.faction || !here.battle || here.battle.attacker !== f.faction) {
      const next = f.orderQueue.shift()!;
      if (!f.orderQueue.length) f.orderQueue = undefined;
      const dest = state.galaxy.planets.get(next.target);
      if (dest && dest.id !== f.at) {
        const invade = hostileNow(state, f.faction, dest.owner) && dest.owner !== f.faction;
        orderFleetTo(state, f, next.target, invade);
      }
    }
  }

  // Заготовки атак: план живёт, пока плацдарм наш, а цель — вражеская и смежная.
  state.attackPlans = state.attackPlans.filter((plan) => {
    const from = state.galaxy.planets.get(plan.from);
    const to = state.galaxy.planets.get(plan.to);
    return !!from && !!to && isHuman(state, from.owner) && to.owner !== from.owner &&
      !to.shattered && !from.shattered && from.links.includes(plan.to);
  });

  checkVictory(state);
  // График журнала войны: срез контроля раз в 30 дней (и в первый день).
  if (state.day % 30 === 0 || state.history.length === 0) {
    snapshotControl(state);
    careerSync(state);
  }
  autosaveTick(state);
  bus.emit('dayPassed', { day: state.day });
  bus.emit('stateChanged', undefined);
}

/**
 * Капитуляция роя: если жуков загнали на 1–2 планеты, они прекращают
 * сопротивление. Оставшиеся ульи становятся МАРИОНЕТКАМИ Супер-Земли:
 * визуально остаются жучьими, но гарнизонов и флотов у роя больше нет,
 * а СЗ может ставить там станции добычи Е-711.
 */
function checkTerminidCapitulation(state: GameState): void {
  if (state.terminidsCapitulated) return;
  const term = state.factions.terminids;
  if (!term.alive || !state.factions.superEarth.alive) return;
  const hives = planetsOf(state, 'terminids').filter((p) => !p.abyss);
  if (hives.length === 0 || hives.length > 2) return;
  // Рой сдаётся, только если последние ульи — в его ГЛАВНОМ секторе
  // (сектор Кеплер Прайм). Загнанные в чужие углы остатки бьются до конца.
  const mainSector = state.galaxy.order
    .map((id) => state.galaxy.planets.get(id)!)
    .find((p) => p.name === 'Кеплер Прайм')?.sector;
  if (mainSector && !hives.every((p) => p.sector === mainSector)) return;

  state.terminidsCapitulated = true;
  term.alive = false;
  term.activeFocus = undefined;
  // Рой разоружается: пулы обнуляются, флоты растворяются, ульи замирают.
  for (const key of Object.keys(term.units)) term.units[key] = 0;
  term.manpower = 0;
  for (const f of fleetsOf(state, 'terminids')) {
    const idx = state.fleetOrder.indexOf(f.id);
    if (idx >= 0) state.fleetOrder.splice(idx, 1);
    state.fleets.delete(f.id);
  }
  for (const p of hives) {
    p.puppetOf = 'superEarth';
    p.garrison = 0;
    p.battle = undefined;
    p.gloom = false; // споровые тучи оседают — путь к залежам открыт
  }
  state.lastConqueror.terminids = 'superEarth';
  pushChronicle(state, 'Рой капитулирует: последние ульи объявлены марионетками Супер-Земли.');
  pushLog(state, {
    text: `РОЙ КАПИТУЛИРУЕТ. Терминиды загнаны на ${hives.length === 1 ? 'последнюю планету' : 'две последние планеты'} (${hives.map((p) => p.name).join(', ')}) и прекращают сопротивление. Ульи объявлены марионетками Супер-Земли — стройте там станции добычи Е-711.`,
    tone: 'alert',
  });
  bus.emit('factionDefeated', { faction: 'terminids', by: 'superEarth' });
}

function checkVictory(state: GameState): void {
  if (state.winner) return;
  checkTerminidCapitulation(state);

  // Потеря или уничтожение самой Супер-Земли — гибель фракции СЗ (но война
  // продолжается, пока в галактике больше одной живой стороны).
  const seCapital = state.galaxy.planets.get('p_super_earth');
  if (seCapital && (seCapital.shattered || seCapital.owner !== 'superEarth') && state.factions.superEarth.alive) {
    state.factions.superEarth.alive = false;
    if (state.player === 'superEarth') {
      state.playerDefeated = true;
      careerFinish(state, false);
    }
    pushChronicle(state, seCapital.shattered
      ? 'Супер-Земля уничтожена орбитальным залпом.'
      : 'Супер-Земля пала: колыбель человечества в руках врага.');
    pushLog(state, {
      text: seCapital.shattered
        ? 'СУПЕР-ЗЕМЛЯ УНИЧТОЖЕНА. Сердце Управляемой Демократии обратилось в обломки.'
        : 'СУПЕР-ЗЕМЛЯ ПАЛА. Колыбель человечества в руках врага.',
      tone: 'bad',
    });
    bus.emit('factionDefeated', {
      faction: 'superEarth',
      by: seCapital.shattered ? state.lastConqueror.superEarth ?? null : seCapital.owner,
    });
  }

  // Финал: в галактике осталась одна живая сторона (миры Бездны не в счёт).
  // Призрак «Ковчега» — всё ещё претендент: машины могут вернуться.
  const contenders = FACTION_IDS.concat(state.superFederationRisen ? ['superFederation'] : [])
    .filter((f) => {
      const fs = state.factions[f];
      if (!fs.alive) return false;
      if (f === 'automatons' && fs.flags.arkPrepared && !fs.flags.arkDone) return true;
      return planetsOf(state, f).some((p) => !p.abyss);
    });

  if (contenders.length === 1) {
    state.winner = contenders[0]!;
    // Итог кампании уходит в карьеру: победа считается по своей фракции.
    careerFinish(state, state.winner === state.player);
    state.speed = 0;
    pushChronicle(state, `Война окончена: галактикой владеет фракция «${FACTIONS[state.winner].name}».`);
    pushLog(state, {
      text: state.winner === state.player
        ? 'Галактика освобождена! Супер-Земля торжествует. Сладкая Свобода!'
        : `Война окончена. Над галактикой властвует фракция «${state.winner}».`,
      tone: state.winner === state.player ? 'good' : 'bad',
    });
  }
}
