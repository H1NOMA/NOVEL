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

  checkVictory(state);
  autosaveTick(state);
  bus.emit('dayPassed', { day: state.day });
  bus.emit('stateChanged', undefined);
}

function checkVictory(state: GameState): void {
  if (state.winner) return;

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
  const contenders = FACTION_IDS.concat(state.superFederationRisen ? ['superFederation'] : [])
    .filter((f) => state.factions[f].alive && planetsOf(state, f).some((p) => !p.abyss));

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
