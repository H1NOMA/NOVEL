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

  // Потеря или уничтожение самой Супер-Земли — немедленное поражение СЗ.
  const seCapital = state.galaxy.planets.get('p_super_earth');
  if (seCapital && (seCapital.shattered || seCapital.owner !== 'superEarth')) {
    if (state.factions.superEarth.alive) {
      state.factions.superEarth.alive = false;
      pushLog(state, {
        text: seCapital.shattered
          ? 'СУПЕР-ЗЕМЛЯ УНИЧТОЖЕНА. Сердце Управляемой Демократии обратилось в обломки.'
          : 'СУПЕР-ЗЕМЛЯ ПАЛА. Колыбель человечества в руках врага.',
        tone: 'bad',
      });
    }
    if (state.player === 'superEarth') {
      const foes = FACTION_IDS.concat(state.superFederationRisen ? ['superFederation'] : [])
        .filter((f) => f !== 'superEarth' && planetsOf(state, f).some((p) => !p.abyss));
      state.winner = foes[0] ?? 'automatons';
      state.speed = 0;
      return;
    }
  }
  // Миры, ушедшие в Бездну, вне досягаемости — для победы они не считаются.
  const withLand = FACTION_IDS.concat(state.superFederationRisen ? ['superFederation'] : [])
    .filter((f) => planetsOf(state, f).some((p) => !p.abyss));

  if (planetsOf(state, state.player).length === 0 && fleetsOf(state, state.player).length === 0) {
    state.winner = withLand[0] ?? 'automatons';
    state.speed = 0;
    pushLog(state, { text: 'Супер-Земля пала. Демократия умирает во тьме.', tone: 'bad' });
    return;
  }
  if (withLand.length === 1 && withLand[0] === state.player) {
    state.winner = state.player;
    state.speed = 0;
    pushLog(state, { text: 'Галактика освобождена! Супер-Земля торжествует. Сладкая Свобода!', tone: 'good' });
  }
}
