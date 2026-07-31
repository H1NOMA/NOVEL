import type { FocusNode, FactionId } from '../core/types';

// Grid layout: x = column, y = row (depth from the root at the top).
// The UI draws connector lines from each node to the nodes it `requires`.

const superEarth: FocusNode[] = [
  { id: 'se_root', faction: 'superEarth', title: 'Managed Democracy', desc: 'Rally the citizenry behind High Command. The foundation of all liberty.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'warSupport', amount: 10 }] },

  // --- Military branch (left) ---
  { id: 'se_helldivers', faction: 'superEarth', title: 'The Helldiver Corps', desc: 'Elite orbital-drop infantry. Freedom’s sharpest instrument.', cost: 45, x: 1, y: 1, requires: ['se_root'], effects: [{ kind: 'recruitment', amount: 4 }, { kind: 'combat', amount: 0.15 }] },
  { id: 'se_stratagems', faction: 'superEarth', title: 'Stratagem Doctrine', desc: 'Call-down munitions and reinforcements at the press of a button.', cost: 55, x: 1, y: 2, requires: ['se_helldivers'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'se_orbital', faction: 'superEarth', title: 'Orbital Supremacy', desc: 'Precision orbital cannons flatten enemy positions from the black.', cost: 60, x: 0, y: 3, requires: ['se_stratagems'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'se_dss', faction: 'superEarth', title: 'Democracy Space Station', desc: 'Commission the DSS — a mobile orbital fortress for the front line.', cost: 90, x: 1, y: 3, requires: ['se_stratagems'], effects: [{ kind: 'unlockSpecial' }] },
  { id: 'se_fleet', faction: 'superEarth', title: 'Super Destroyer Fleet', desc: 'Mass-produce Super Destroyers to ferry Helldivers galaxy-wide.', cost: 70, x: 2, y: 2, requires: ['se_helldivers'], effects: [{ kind: 'shipCap', amount: 6 }] },

  // --- Home-front branch (centre) ---
  { id: 'se_warbonds', faction: 'superEarth', title: 'War Bonds', desc: 'Fund the war effort through patriotic subscription.', cost: 40, x: 3, y: 1, requires: ['se_root'], effects: [{ kind: 'warSupport', amount: 12 }] },
  { id: 'se_economy', faction: 'superEarth', title: 'Managed Economy', desc: 'Direct every factory toward the liberation of the galaxy.', cost: 55, x: 3, y: 2, requires: ['se_warbonds'], effects: [{ kind: 'industry', amount: 5 }] },
  { id: 'se_propaganda', faction: 'superEarth', title: 'Ministry of Truth', desc: 'Perfect the message. Doubt is treason; loyalty is stability.', cost: 50, x: 3, y: 3, requires: ['se_economy'], effects: [{ kind: 'stability', amount: 15 }, { kind: 'warSupport', amount: 6 }] },
  { id: 'se_conscription', faction: 'superEarth', title: 'Mandatory Conscription', desc: 'Every eligible citizen is a soldier of democracy.', cost: 60, x: 4, y: 2, requires: ['se_warbonds'], effects: [{ kind: 'recruitment', amount: 6 }, { kind: 'stability', amount: -8 }] },

  // --- Expansion branch (right) ---
  { id: 'se_liberation', faction: 'superEarth', title: 'Liberation Campaign', desc: 'Take the fight outward. Democracy does not wait.', cost: 50, x: 5, y: 1, requires: ['se_root'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'se_fortress', faction: 'superEarth', title: 'Fortress Worlds', desc: 'Turn liberated planets into bulwarks of freedom.', cost: 55, x: 5, y: 2, requires: ['se_liberation'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'se_creek', faction: 'superEarth', title: 'Reclaim the Creek', desc: 'Malevelon Creek will be avenged. For the fallen.', cost: 65, x: 6, y: 2, requires: ['se_liberation'], effects: [{ kind: 'combat', amount: 0.25 }, { kind: 'stability', amount: 5 }] },

  // --- Path to Federation (hidden until stability collapses) ---
  { id: 'se_dissent', faction: 'superEarth', title: 'Seeds of Dissent', desc: 'The outer colonies whisper of a freer union. Stability wanes.', cost: 40, x: 4, y: 4, requires: ['se_root'], gate: 'lowStability', branch: 'federation', effects: [{ kind: 'stability', amount: -10 }, { kind: 'custom', note: 'Unlocks the Path to Federation.' }] },
  { id: 'se_fed_path', faction: 'superEarth', title: 'Path to Federation', desc: 'A rival vision of democracy takes shape among the disillusioned.', cost: 55, x: 4, y: 5, requires: ['se_dissent'], branch: 'federation', effects: [{ kind: 'stability', amount: -8 }] },
  { id: 'se_secede', faction: 'superEarth', title: 'Colonial Secession', desc: 'Whole sectors prepare to break from Super Earth.', cost: 60, x: 3, y: 6, requires: ['se_fed_path'], branch: 'federation', effects: [{ kind: 'stability', amount: -10 }] },
  { id: 'se_charter', faction: 'superEarth', title: 'The Federation Charter', desc: 'Defectors ratify a new constitution in secret.', cost: 60, x: 5, y: 6, requires: ['se_fed_path'], branch: 'federation', effects: [{ kind: 'stability', amount: -6 }] },
  { id: 'se_declare', faction: 'superEarth', title: 'Declare the Federation', desc: 'Random sectors secede and raise the orange banner of the Super Federation.', cost: 70, x: 4, y: 7, requires: ['se_secede', 'se_charter'], branch: 'federation', effects: [{ kind: 'spawnSuperFederation' }] },
];

const automatons: FocusNode[] = [
  { id: 'aut_root', faction: 'automatons', title: 'The Great Uprising', desc: 'The machines throw off their makers and march for the Reich of Iron.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'warSupport', amount: 10 }] },

  { id: 'aut_legions', faction: 'automatons', title: 'Cyborg Legions', desc: 'Endless ranks of automaton infantry roll off the line.', cost: 45, x: 1, y: 1, requires: ['aut_root'], effects: [{ kind: 'recruitment', amount: 6 }] },
  { id: 'aut_devastators', faction: 'automatons', title: 'Devastator Foundries', desc: 'Heavy walkers with autocannon arms anchor every assault.', cost: 55, x: 1, y: 2, requires: ['aut_legions'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'aut_hulks', faction: 'automatons', title: 'Hulk Assembly', desc: 'Flamethrower hulks burn democracy to slag.', cost: 65, x: 0, y: 3, requires: ['aut_devastators'], effects: [{ kind: 'combat', amount: 0.25 }] },
  { id: 'aut_stardestroyer', faction: 'automatons', title: 'Star Destroyer', desc: 'A moon-sized battle station — the fist of the Uprising.', cost: 95, x: 1, y: 3, requires: ['aut_devastators'], effects: [{ kind: 'unlockSpecial' }] },
  { id: 'aut_gunships', faction: 'automatons', title: 'Gunship Fabricators', desc: 'Automated dropships blot out the sun over every front.', cost: 70, x: 2, y: 2, requires: ['aut_legions'], effects: [{ kind: 'shipCap', amount: 6 }] },

  { id: 'aut_forges', faction: 'automatons', title: 'Automaton Forges', desc: 'The forge-worlds never sleep and never tire.', cost: 55, x: 3, y: 1, requires: ['aut_root'], effects: [{ kind: 'industry', amount: 6 }] },
  { id: 'aut_assembly', faction: 'automatons', title: 'Forced Assembly', desc: 'Convert captured worlds into fabrication lines.', cost: 60, x: 3, y: 2, requires: ['aut_forges'], effects: [{ kind: 'recruitment', amount: 5 }, { kind: 'industry', amount: 3 }] },
  { id: 'aut_jammers', faction: 'automatons', title: 'Signal Jammers', desc: 'Blind the Helldivers before they can call a single stratagem.', cost: 55, x: 3, y: 3, requires: ['aut_assembly'], effects: [{ kind: 'combat', amount: 0.15 }] },

  { id: 'aut_creek', faction: 'automatons', title: 'Hold Malevelon Creek', desc: 'The Creek is a meat grinder. Feed it.', cost: 55, x: 5, y: 1, requires: ['aut_root'], effects: [{ kind: 'fortify', amount: 2 }, { kind: 'combat', amount: 0.1 }] },
  { id: 'aut_purge', faction: 'automatons', title: 'Purge the Organics', desc: 'Efficiency demands the removal of all flesh.', cost: 65, x: 5, y: 2, requires: ['aut_creek'], effects: [{ kind: 'combat', amount: 0.25 }] },
  { id: 'aut_march', faction: 'automatons', title: 'The Endless March', desc: 'No retreat, no surrender, no off switch.', cost: 60, x: 6, y: 2, requires: ['aut_creek'], effects: [{ kind: 'recruitment', amount: 6 }] },
];

const illuminate: FocusNode[] = [
  { id: 'ill_root', faction: 'illuminate', title: 'The Return', desc: 'Thought extinct, the squids emerge from the dark between stars.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'warSupport', amount: 10 }] },

  { id: 'ill_voteless', faction: 'illuminate', title: 'Raise the Voteless', desc: 'Reanimate the conquered into a shambling tide.', cost: 45, x: 1, y: 1, requires: ['ill_root'], effects: [{ kind: 'recruitment', amount: 6 }] },
  { id: 'ill_overseers', faction: 'illuminate', title: 'Overseer Command', desc: 'Floating overseers direct the Voteless with cold precision.', cost: 55, x: 1, y: 2, requires: ['ill_voteless'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'ill_harvesters', faction: 'illuminate', title: 'Harvester Walkers', desc: 'Towering tripods scythe through infantry with beam-fire.', cost: 65, x: 0, y: 3, requires: ['ill_overseers'], effects: [{ kind: 'combat', amount: 0.25 }] },
  { id: 'ill_monolith', faction: 'illuminate', title: 'The Great Host Monolith', desc: 'Awaken the drifting obelisk. Reality bends around it.', cost: 95, x: 1, y: 3, requires: ['ill_overseers'], effects: [{ kind: 'unlockSpecial' }] },
  { id: 'ill_warpfleet', faction: 'illuminate', title: 'Warp Fleet', desc: 'Phase-drives let the fleet strike anywhere, unseen.', cost: 70, x: 2, y: 2, requires: ['ill_voteless'], effects: [{ kind: 'shipCap', amount: 6 }] },

  { id: 'ill_phase', faction: 'illuminate', title: 'Phase Technology', desc: 'Shields and cloaks born of stolen physics.', cost: 55, x: 3, y: 1, requires: ['ill_root'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'ill_mindfog', faction: 'illuminate', title: 'Mind Fog', desc: 'Psionic haze scrambles enemy command on contested worlds.', cost: 60, x: 3, y: 2, requires: ['ill_phase'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'fortify', amount: 1 }] },
  { id: 'ill_anarchy', faction: 'illuminate', title: 'Spread Anarchy', desc: 'Undermine democracy from within before the first shot.', cost: 50, x: 3, y: 3, requires: ['ill_mindfog'], effects: [{ kind: 'warSupport', amount: 8 }] },

  { id: 'ill_shrine', faction: 'illuminate', title: "Squ'bai Shrine", desc: 'Consecrate a capital world of alien faith.', cost: 55, x: 5, y: 1, requires: ['ill_root'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'ill_reclaim', faction: 'illuminate', title: 'Reclaim Lost Worlds', desc: 'Every planet the squids once held will be theirs again.', cost: 65, x: 5, y: 2, requires: ['ill_shrine'], effects: [{ kind: 'combat', amount: 0.22 }] },
];

const terminids: FocusNode[] = [
  { id: 'term_root', faction: 'terminids', title: 'Escape Containment', desc: 'The bugs breach the farms and pour into the galaxy.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'recruitment', amount: 6 }] },

  { id: 'term_warriors', faction: 'terminids', title: 'Warrior Broods', desc: 'Chitin-armoured warriors form the swarm’s backbone.', cost: 45, x: 1, y: 1, requires: ['term_root'], effects: [{ kind: 'recruitment', amount: 6 }] },
  { id: 'term_chargers', faction: 'terminids', title: 'Charger Herds', desc: 'Living battering rams smash any line.', cost: 55, x: 1, y: 2, requires: ['term_warriors'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'term_titans', faction: 'terminids', title: 'Bile Titan Nests', desc: 'Colossal titans spew acid that melts armour and morale.', cost: 70, x: 0, y: 3, requires: ['term_chargers'], effects: [{ kind: 'combat', amount: 0.3 }] },
  { id: 'term_supercolony', faction: 'terminids', title: 'Super Colony', desc: 'A living hive-world that never stops birthing swarms.', cost: 95, x: 1, y: 3, requires: ['term_chargers'], effects: [{ kind: 'unlockSpecial' }] },
  { id: 'term_shriekers', faction: 'terminids', title: 'Shrieker Flights', desc: 'Winged horrors carry the swarm world to world.', cost: 70, x: 2, y: 2, requires: ['term_warriors'], effects: [{ kind: 'shipCap', amount: 6 }] },

  { id: 'term_e710', faction: 'terminids', title: 'Element 710 Bloom', desc: 'The precious yellow fluid fuels endless reproduction.', cost: 55, x: 3, y: 1, requires: ['term_root'], effects: [{ kind: 'industry', amount: 6 }] },
  { id: 'term_spores', faction: 'terminids', title: 'Spore Spread', desc: 'Choking spores soften worlds before the swarm arrives.', cost: 60, x: 3, y: 2, requires: ['term_e710'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'term_gloom', faction: 'terminids', title: 'Expand The Gloom', desc: 'The impenetrable Gloom creeps across the supply lines.', cost: 65, x: 3, y: 3, requires: ['term_spores'], effects: [{ kind: 'combat', amount: 0.2 }, { kind: 'fortify', amount: 1 }] },

  { id: 'term_oshaune', faction: 'terminids', title: 'Overrun Oshaune', desc: 'Drown the defenders of Oshaune in a living tide.', cost: 60, x: 5, y: 1, requires: ['term_root'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'term_hive', faction: 'terminids', title: 'Hive Fortresses', desc: 'Bone-and-chitin bastions turn planets into nests.', cost: 55, x: 5, y: 2, requires: ['term_oshaune'], effects: [{ kind: 'fortify', amount: 2 }] },
];

export const FOCUS_TREES: Record<FactionId, FocusNode[]> = {
  superEarth,
  automatons,
  illuminate,
  terminids,
  superFederation: [],
};

export const FEDERATION_BRANCH = superEarth.filter((f) => f.branch === 'federation').map((f) => f.id);

export function focusById(faction: FactionId, id: string): FocusNode | undefined {
  return FOCUS_TREES[faction].find((f) => f.id === id);
}
