import type { FactionId, Fleet, Planet } from '../core/types';
import { areHostile, SPECIALS } from '../data/factions';
import { fleetsAt, pushLog, removeFleet, type GameState } from './state';

// ---------------------------------------------------------------------------
// Combat resolves in two layers each day:
//   1. Orbital (space) — hostile fleets sharing a planet trade ship losses.
//   2. Ground — an attacker with surviving fleets in orbit lands infantry and
//      grinds the planetary garrison. A liberation meter tracks the invasion;
//      at 100% the planet flips to the attacker.
// ---------------------------------------------------------------------------

function combatMult(state: GameState, faction: FactionId): number {
  const fs = state.factions[faction];
  return 1 + fs.bonuses.combat + (fs.warSupport - 50) / 200;
}

function fleetPower(state: GameState, f: Fleet): number {
  let p = f.ships;
  if (f.special) p += f.ships * (SPECIALS[f.faction].power - 1);
  return p * combatMult(state, f.faction);
}

/** Resolve one day of orbital combat over every contested planet. */
export function resolveOrbital(state: GameState): void {
  for (const id of state.galaxy.order) {
    const planet = state.galaxy.planets.get(id)!;
    const here = fleetsAt(state, id);
    if (here.length < 2) continue;

    // Group fleets by faction; only fight if at least two hostile groups exist.
    const byFaction = new Map<FactionId, Fleet[]>();
    for (const f of here) {
      if (!byFaction.has(f.faction)) byFaction.set(f.faction, []);
      byFaction.get(f.faction)!.push(f);
    }
    const factions = [...byFaction.keys()];
    if (factions.length < 2) continue;

    // Total power per faction.
    const power = new Map<FactionId, number>();
    for (const [fac, fleets] of byFaction) {
      power.set(fac, fleets.reduce((s, f) => s + fleetPower(state, f), 0));
    }

    // Each faction takes damage proportional to the summed hostile power.
    for (const [fac, fleets] of byFaction) {
      let incoming = 0;
      for (const [other, op] of power) {
        if (other !== fac && areHostile(fac, other)) incoming += op;
      }
      if (incoming <= 0) continue;
      const loss = incoming * 0.16;
      applyShipLosses(state, fleets, loss, planet);
    }
  }
}

function applyShipLosses(state: GameState, fleets: Fleet[], totalLoss: number, planet: Planet): void {
  const totalShips = fleets.reduce((s, f) => s + f.ships, 0);
  if (totalShips <= 0) return;
  for (const f of fleets) {
    const share = (f.ships / totalShips) * totalLoss;
    f.ships = Math.max(0, f.ships - share);
    if (f.ships < 0.5) {
      if (f.special) {
        pushLog(state, {
          faction: f.faction,
          text: `${SPECIALS[f.faction].name} destroyed in orbit over ${planet.name}!`,
          tone: f.faction === state.player ? 'bad' : 'good',
        });
      }
      removeFleet(state, f.id);
    }
  }
}

/** Resolve one day of ground combat / invasions over every planet. */
export function resolveGround(state: GameState): void {
  for (const id of state.galaxy.order) {
    const planet = state.galaxy.planets.get(id)!;
    const here = fleetsAt(state, id).filter((f) => f.faction !== planet.owner && areHostile(f.faction, planet.owner));
    const attackers = here.filter((f) => !f.transit);

    if (attackers.length === 0) {
      // No invaders — decay any stale battle and slowly regrow garrison.
      if (planet.battle) {
        planet.battle.liberation = Math.max(0, planet.battle.liberation - 6);
        if (planet.battle.liberation <= 0) planet.battle = undefined;
      }
      regrowGarrison(state, planet);
      continue;
    }

    // Determine the lead attacking faction (strongest present).
    const attackPower = new Map<FactionId, number>();
    for (const f of attackers) {
      attackPower.set(f.faction, (attackPower.get(f.faction) ?? 0) + f.infantry * combatMult(state, f.faction));
    }
    let lead: FactionId = attackers[0]!.faction;
    let leadVal = 0;
    for (const [fac, val] of attackPower) if (val > leadVal) { leadVal = val; lead = fac; }

    const attackerForce = leadVal;
    const defBonus = 1 + planet.fortification * 0.12 + state.factions[planet.owner].bonuses.fortify * 0.05;
    const defenderForce = planet.garrison * combatMult(state, planet.owner) * defBonus;

    if (!planet.battle || planet.battle.attacker !== lead) {
      planet.battle = {
        attacker: lead,
        defender: planet.owner,
        attackerForce,
        defenderForce,
        liberation: planet.battle?.liberation ?? 0,
        days: 0,
      };
      if (planet.battle.days === 0) {
        pushLog(state, {
          faction: lead,
          text: `${factionName(lead)} forces land on ${planet.name}! Battle for the planet begins.`,
          tone: planet.owner === state.player ? 'alert' : lead === state.player ? 'good' : 'info',
        });
      }
    }
    const b = planet.battle;
    b.attackerForce = attackerForce;
    b.defenderForce = defenderForce;
    b.days++;

    // Attrition: both sides lose strength; the meter shifts toward the winner.
    const ratio = attackerForce / (attackerForce + defenderForce + 0.001);
    b.liberation = clamp(b.liberation + (ratio - 0.5) * 34, 0, 100);

    // Casualties reduce garrison and landed infantry.
    const gLoss = Math.min(planet.garrison, attackerForce * 0.04);
    planet.garrison = Math.max(0, planet.garrison - gLoss);
    for (const f of attackers) {
      const iLoss = f.infantry * defenderForce * 0.0006;
      f.infantry = Math.max(0, f.infantry - iLoss);
    }

    if (b.liberation >= 100 || planet.garrison <= 0.5) {
      capturePlanet(state, planet, lead, attackers);
    }
  }
}

function capturePlanet(state: GameState, planet: Planet, attacker: FactionId, attackers: Fleet[]): void {
  const prev = planet.owner;
  planet.owner = attacker;
  planet.battle = undefined;
  // Landed infantry becomes the new garrison; ships stay in orbit.
  let landed = 0;
  for (const f of attackers) {
    if (f.faction === attacker) {
      landed += f.infantry * 0.6;
      f.infantry *= 0.4;
    }
  }
  planet.garrison = Math.max(8, landed);
  planet.fortification = Math.max(0, planet.fortification - 2);
  pushLog(state, {
    faction: attacker,
    text: `${planet.name} has fallen to ${factionName(attacker)}${planet.isCapital ? ' — a CAPITAL WORLD lost!' : ''}.`,
    tone: prev === state.player ? 'bad' : attacker === state.player ? 'good' : 'info',
  });
}

function regrowGarrison(state: GameState, planet: Planet): void {
  const cap = planet.isCapital ? 140 : 40 + planet.value * 8;
  if (planet.garrison < cap) {
    planet.garrison = Math.min(cap, planet.garrison + 0.4 + state.factions[planet.owner].bonuses.recruitment * 0.04);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function factionName(id: FactionId): string {
  const map: Record<FactionId, string> = {
    superEarth: 'Super Earth',
    automatons: 'Automaton',
    illuminate: 'Illuminate',
    terminids: 'Terminid',
    superFederation: 'Super Federation',
  };
  return map[id];
}
