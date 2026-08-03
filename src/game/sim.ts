import type { FactionId } from '../core/types';
import { FACTION_IDS } from '../data/factions';
import { bus } from '../core/emitter';
import { fleetsOf, planetsOf, pushLog, type GameState } from './state';
import { runAI, runEconomy } from './ai';
import { stepFocus } from './focus';
import { resolveGround, resolveOrbital } from './combat';
import { garrisonReinforce, stepFleets } from './units';
import { recomputeSupply } from './supply';
import { stepDecisions } from './decisions';
import { stepShipyards } from './shipyards';
import { stepEvents } from './events';
import { autosaveTick } from './persist';

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
    if (fid !== state.player) runAI(state, fid);
  }

  recomputeSupply(state);
  stepShipyards(state);
  resolveOrbital(state);
  resolveGround(state);
  stepDecisions(state);
  stepEvents(state);

  // Заготовки атак: план живёт, пока плацдарм наш, а цель — вражеская и смежная.
  state.attackPlans = state.attackPlans.filter((plan) => {
    const from = state.galaxy.planets.get(plan.from);
    const to = state.galaxy.planets.get(plan.to);
    return !!from && !!to && from.owner === state.player && to.owner !== state.player &&
      !to.shattered && !from.shattered && from.links.includes(plan.to);
  });

  checkVictory(state);
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
    if (state.player === 'superEarth') state.playerDefeated = true;
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
    state.speed = 0;
    pushLog(state, {
      text: state.winner === state.player
        ? 'Галактика освобождена! Супер-Земля торжествует. Сладкая Свобода!'
        : `Война окончена. Над галактикой властвует фракция «${state.winner}».`,
      tone: state.winner === state.player ? 'good' : 'bad',
    });
  }
}
