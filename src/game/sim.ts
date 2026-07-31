import type { FactionId } from '../core/types';
import { FACTION_IDS } from '../data/factions';
import { bus } from '../core/emitter';
import { fleetsOf, planetsOf, pushLog, type GameState } from './state';
import { runAI, runEconomy } from './ai';
import { stepFocus } from './focus';
import { resolveGround, resolveOrbital } from './combat';
import { garrisonReinforce, stepFleets } from './units';

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

  resolveOrbital(state);
  resolveGround(state);

  checkVictory(state);
  bus.emit('dayPassed', { day: state.day });
  bus.emit('stateChanged', undefined);
}

function checkVictory(state: GameState): void {
  if (state.winner) return;
  const withLand = FACTION_IDS.concat(state.superFederationRisen ? ['superFederation'] : [])
    .filter((f) => planetsOf(state, f).length > 0);

  if (planetsOf(state, state.player).length === 0 && fleetsOf(state, state.player).length === 0) {
    state.winner = withLand[0] ?? 'automatons';
    state.speed = 0;
    pushLog(state, { text: 'Super Earth has fallen. Democracy dies in darkness.', tone: 'bad' });
    return;
  }
  if (withLand.length === 1 && withLand[0] === state.player) {
    state.winner = state.player;
    state.speed = 0;
    pushLog(state, { text: 'The galaxy is liberated! Super Earth reigns supreme. Sweet Liberty!', tone: 'good' });
  }
}
