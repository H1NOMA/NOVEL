import type { FactionId, FocusEffect, FocusNode } from '../core/types';
import { FOCUS_TREES, FEDERATION_BRANCH } from '../data/focus';
import { FACTIONS, SPECIALS } from '../data/factions';
import { bus } from '../core/emitter';
import { pushLog, spawnFleet, planetsOf, type GameState } from './state';

const LOW_STABILITY = 40;

export function canSelectFocus(state: GameState, faction: FactionId, node: FocusNode): boolean {
  const fs = state.factions[faction];
  if (fs.completedFocus.includes(node.id)) return false;
  if (!node.requires.every((r) => fs.completedFocus.includes(r))) return false;
  if (node.gate === 'lowStability' && fs.stability >= LOW_STABILITY) return false;
  return true;
}

export function selectFocus(state: GameState, faction: FactionId, id: string): boolean {
  const node = FOCUS_TREES[faction].find((f) => f.id === id);
  if (!node || !canSelectFocus(state, faction, node)) return false;
  state.factions[faction].activeFocus = { id, remaining: node.cost };
  return true;
}

/** Advance the active focus for one day; complete it when the timer elapses. */
export function stepFocus(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.activeFocus) {
    // AI / auto: pick the next sensible focus.
    if (faction !== state.player) autoPickFocus(state, faction);
    return;
  }
  const rate = 1 + fs.bonuses.industry * 0.02;
  fs.activeFocus.remaining -= rate;
  if (fs.activeFocus.remaining <= 0) {
    const id = fs.activeFocus.id;
    fs.activeFocus = undefined;
    completeFocus(state, faction, id);
  }
}

function completeFocus(state: GameState, faction: FactionId, id: string): void {
  const node = FOCUS_TREES[faction].find((f) => f.id === id);
  if (!node) return;
  const fs = state.factions[faction];
  fs.completedFocus.push(id);
  for (const eff of node.effects) applyEffect(state, faction, eff);

  pushLog(state, {
    faction,
    text: `${FACTIONS[faction].short} completes focus “${node.title}”.`,
    tone: faction === state.player ? 'good' : 'info',
  });
  bus.emit('focusCompleted', { faction, id });

  // Super Federation rises once the majority of the Path to Federation is walked.
  if (faction === 'superEarth' && !state.superFederationRisen) {
    const done = FEDERATION_BRANCH.filter((f) => fs.completedFocus.includes(f)).length;
    const needed = Math.ceil(FEDERATION_BRANCH.length * 0.6);
    if (done >= needed) riseSuperFederation(state);
  }
}

function applyEffect(state: GameState, faction: FactionId, eff: FocusEffect): void {
  const fs = state.factions[faction];
  switch (eff.kind) {
    case 'warSupport':
      fs.warSupport = clamp(fs.warSupport + eff.amount, 0, 100);
      break;
    case 'recruitment':
      fs.bonuses.recruitment += eff.amount;
      break;
    case 'industry':
      fs.bonuses.industry += eff.amount;
      fs.industry += eff.amount;
      break;
    case 'shipCap':
      fs.bonuses.shipCap += eff.amount;
      break;
    case 'combat':
      fs.bonuses.combat += eff.amount;
      break;
    case 'fortify':
      fs.bonuses.fortify += eff.amount;
      break;
    case 'stability':
      fs.stability = clamp(fs.stability + eff.amount, 0, 100);
      break;
    case 'manpower':
      fs.manpower = Math.min(500, fs.manpower + eff.amount);
      break;
    case 'fleet': {
      const worlds = planetsOf(state, faction);
      const home = worlds.find((p) => p.isCapital) ?? worlds[0];
      if (home) spawnFleet(state, faction, home.id, { ships: eff.ships, infantry: eff.infantry });
      break;
    }
    case 'unlockSpecial':
      unlockSpecial(state, faction);
      break;
    case 'spawnSuperFederation':
      if (!state.superFederationRisen) riseSuperFederation(state);
      break;
    case 'custom':
      break;
  }
}

function unlockSpecial(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (fs.specialUnlocked) return;
  fs.specialUnlocked = true;
  const spec = SPECIALS[faction];
  const worlds = planetsOf(state, faction);
  const home = worlds.find((p) => p.isCapital) ?? worlds[0];
  if (!home) return;
  spawnFleet(state, faction, home.id, { ships: 14, infantry: 40, special: spec.id });
  pushLog(state, {
    faction,
    text: `${spec.name} enters service over ${home.name}!`,
    tone: faction === state.player ? 'good' : 'alert',
  });
}

export function riseSuperFederation(state: GameState): void {
  if (state.superFederationRisen) return;
  state.superFederationRisen = true;
  const fed = state.factions.superFederation;
  fed.alive = true;

  // Flip a few random Super-Earth sectors to the Super Federation (orange).
  const seSectors = [...state.galaxy.sectors.values()].filter((s) =>
    s.planets.some((pid) => state.galaxy.planets.get(pid)!.owner === 'superEarth') && s.ring >= 1
  );
  state.rng.shuffle(seSectors);
  const flipCount = Math.min(4, Math.max(2, Math.floor(seSectors.length * 0.25)));
  const flipped: string[] = [];
  for (const sector of seSectors.slice(0, flipCount)) {
    for (const pid of sector.planets) {
      const p = state.galaxy.planets.get(pid)!;
      if (p.owner === 'superEarth' && !p.isCapital) {
        p.owner = 'superFederation';
        flipped.push(pid);
      }
    }
  }
  // The strongest seceded world becomes the Federation capital, New Concord.
  const bases = flipped.map((id) => state.galaxy.planets.get(id)!);
  if (bases.length) {
    const cap = bases.reduce((a, b) => (b.value + b.garrison > a.value + a.garrison ? b : a));
    cap.isCapital = true;
    cap.name = 'New Concord';
    cap.scale = Math.max(cap.scale, 1.35);
    cap.garrison = Math.max(cap.garrison, 90);
    cap.fortification = 4;
    cap.value = 8;
  }
  // Give the Federation a starting navy from the seceded worlds.
  for (let i = 0; i < Math.min(3, bases.length); i++) {
    const base = bases[i]!;
    base.garrison = Math.max(base.garrison, 60);
    spawnFleet(state, 'superFederation', base.id, { ships: 8, infantry: 30 });
  }
  // Stability shock to Super Earth.
  state.factions.superEarth.stability = clamp(state.factions.superEarth.stability - 20, 0, 100);

  pushLog(state, {
    text: `SECESSION! ${flipped.length} worlds raise the orange banner of the SUPER FEDERATION. They now war against Super Earth and all others.`,
    tone: 'alert',
  });
  bus.emit('superFederationRose', undefined);
}

/** Simple AI focus selection: pick the cheapest currently-selectable focus. */
export function autoPickFocus(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (fs.activeFocus) return;
  const options = FOCUS_TREES[faction].filter((n) => {
    if (fs.completedFocus.includes(n.id)) return false;
    if (!n.requires.every((r) => fs.completedFocus.includes(r))) return false;
    if (n.gate === 'lowStability' && fs.stability >= LOW_STABILITY) return false;
    return true;
  });
  if (!options.length) return;
  // Prefer special-unlock and combat focuses, then cheapest.
  options.sort((a, b) => weight(b) - weight(a) || a.cost - b.cost);
  const pick = options[0]!;
  fs.activeFocus = { id: pick.id, remaining: pick.cost };
}

function weight(n: FocusNode): number {
  let w = 0;
  for (const e of n.effects) {
    if (e.kind === 'unlockSpecial') w += 3;
    if (e.kind === 'combat') w += 2;
    if (e.kind === 'fleet') w += 2;
    if (e.kind === 'recruitment') w += 1;
    if (e.kind === 'shipCap') w += 1;
  }
  return w;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
