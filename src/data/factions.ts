import type { FactionDef, FactionId, SpecialUnitDef } from '../core/types';

export const FACTIONS: Record<FactionId, FactionDef> = {
  superEarth: {
    id: 'superEarth',
    name: 'Super Earth',
    short: 'SE',
    color: '#3fa9f5',
    accent: '#ffe14d',
    blurb:
      'Prosperity, liberty, Managed Democracy — the centrepiece of progress for 100 years after the First Galactic War. Prove you have the strength and courage to be free.',
    capital: 'Super Earth',
    aggression: 1.0,
    specialName: 'Democracy Space Station',
    specialBlurb:
      'A mobile orbital fortress. Wherever it anchors, orbital bombardment shatters enemy garrisons and rallies the Helldivers.',
    homeBiomes: ['terran', 'ocean', 'jungle'],
    playable: true,
  },
  automatons: {
    id: 'automatons',
    name: 'The Automatons',
    short: 'AUT',
    color: '#e0342b',
    accent: '#ff8a3d',
    blurb:
      'The socialist machines under the thumb of their traitorous Cyborg makers. They destroy all that Super Earth stands for. Major Battle: Malevelon Creek.',
    capital: 'Cyberstan',
    aggression: 1.15,
    specialName: 'Automaton Star Destroyer',
    specialBlurb:
      'A moon-sized battle station bristling with cannon. A slow, inexorable engine of conquest that flattens whole sectors.',
    homeBiomes: ['volcanic', 'barren', 'toxic'],
    playable: true,
  },
  illuminate: {
    id: 'illuminate',
    name: 'The Illuminate',
    short: 'ILL',
    color: '#8b5bd8',
    accent: '#c39bff',
    blurb:
      'The squids were driven off the galaxy after our victory. Once thought extinct, they have returned to spread their anarchy. Capital: Squ’bai Shrine.',
    capital: "Squ'bai Shrine",
    aggression: 1.1,
    specialName: 'The Great Host Monolith',
    specialBlurb:
      'A drifting obelisk of alien technology. Its phase-fields cloak Illuminate fleets and unmake reality around contested worlds.',
    homeBiomes: ['gas', 'ice', 'ocean'],
    playable: true,
  },
  terminids: {
    id: 'terminids',
    name: 'The Terminids',
    short: 'TERM',
    color: '#e8b830',
    accent: '#f6e27a',
    blurb:
      'The disgusting bugs, primary producers of Element 710, have escaped containment. For Super Earth’s continued existence they must be contained — especially The Gloom. Major Battle: Oshaune.',
    capital: 'Kepler Prime',
    aggression: 1.05,
    specialName: 'Terminid Super Colony',
    specialBlurb:
      'A living hive-world that spews endless swarms. Left unchecked it metastasises across supply lines like The Gloom itself.',
    homeBiomes: ['gloom', 'desert', 'toxic'],
    playable: true,
  },
  superFederation: {
    id: 'superFederation',
    name: 'The Super Federation',
    short: 'FED',
    color: '#ff8c1a',
    accent: '#ffd18a',
    blurb:
      'Born from the collapse of Managed Democracy. When stability falls and the Path to Federation is walked, disillusioned colonies secede — and turn their guns on Super Earth itself.',
    capital: 'New Concord',
    aggression: 1.2,
    specialName: 'Federation Dreadnought',
    specialBlurb:
      'Ex-Super Earth capital ships crewed by defectors who know every SE tactic — and every weakness.',
    homeBiomes: ['terran', 'desert', 'barren'],
    playable: false,
    hidden: true,
  },
};

export const FACTION_IDS: FactionId[] = [
  'superEarth',
  'automatons',
  'illuminate',
  'terminids',
];

export const SPECIALS: Record<FactionId, SpecialUnitDef> = {
  superEarth: {
    id: 'dss',
    faction: 'superEarth',
    name: 'Democracy Space Station',
    blurb: FACTIONS.superEarth.specialBlurb,
    power: 2.4,
    auraRange: 1,
  },
  automatons: {
    id: 'starDestroyer',
    faction: 'automatons',
    name: 'Automaton Star Destroyer',
    blurb: FACTIONS.automatons.specialBlurb,
    power: 2.8,
    auraRange: 1,
  },
  illuminate: {
    id: 'monolith',
    faction: 'illuminate',
    name: 'The Great Host Monolith',
    blurb: FACTIONS.illuminate.specialBlurb,
    power: 2.5,
    auraRange: 2,
  },
  terminids: {
    id: 'superColony',
    faction: 'terminids',
    name: 'Terminid Super Colony',
    blurb: FACTIONS.terminids.specialBlurb,
    power: 2.6,
    auraRange: 2,
  },
  superFederation: {
    id: 'dreadnought',
    faction: 'superFederation',
    name: 'Federation Dreadnought',
    blurb: FACTIONS.superFederation.specialBlurb,
    power: 2.7,
    auraRange: 1,
  },
};

/** Diplomatic matrix — true means the two factions are hostile. */
export function areHostile(a: FactionId, b: FactionId): boolean {
  if (a === b) return false;
  // Everyone is hostile to everyone in the Second Galactic War, except a
  // faction with itself. Super Federation fights Super Earth and all others.
  return true;
}

export function factionColor(id: FactionId): string {
  return FACTIONS[id].color;
}
