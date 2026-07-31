import type { FocusNode, FactionId } from '../core/types';

// ---------------------------------------------------------------------------
// National focus trees. Grid layout: x = column, y = row (depth from root).
// Column bands per faction:
//   x0–1  military (ground forces)
//   x2    navy / mobility
//   x3–4  politics / ideology
//   x5    economy / industry
//   x6–7  expansion / campaigns
// The UI draws connector lines from each node to its `requires`.
// ---------------------------------------------------------------------------

// ============================ SUPER EARTH ==================================
const superEarth: FocusNode[] = [
  { id: 'se_root', faction: 'superEarth', title: 'Managed Democracy', desc: 'Rally the citizenry behind High Command. The foundation of all liberty.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'warSupport', amount: 10 }] },

  // --- Military: the Helldiver Corps ---
  { id: 'se_helldivers', faction: 'superEarth', title: 'The Helldiver Corps', desc: 'Elite orbital-drop infantry. Freedom’s sharpest instrument.', cost: 45, x: 1, y: 1, requires: ['se_root'], effects: [{ kind: 'recruitment', amount: 3 }, { kind: 'combat', amount: 0.1 }] },
  { id: 'se_stratagems', faction: 'superEarth', title: 'Stratagem Doctrine', desc: 'Call-down munitions and reinforcements at the press of a button.', cost: 55, x: 0, y: 2, requires: ['se_helldivers'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'se_eagle', faction: 'superEarth', title: 'Eagle Air Wing', desc: 'Eagle-1 flies close support. Danger close is just close enough.', cost: 50, x: 1, y: 2, requires: ['se_helldivers'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'se_exosuit', faction: 'superEarth', title: 'Exosuit Program', desc: 'EXO-45 Patriot walkers stomp onto the front line.', cost: 60, x: 0, y: 3, requires: ['se_stratagems'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'se_orbital', faction: 'superEarth', title: 'Orbital Supremacy', desc: 'Precision orbital cannons flatten enemy positions from the black.', cost: 60, x: 1, y: 3, requires: ['se_stratagems', 'se_eagle'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'se_seaf', faction: 'superEarth', title: 'SEAF Expansion', desc: 'The Super Earth Armed Forces swell with eager recruits.', cost: 55, x: 0, y: 4, requires: ['se_exosuit'], effects: [{ kind: 'recruitment', amount: 5 }, { kind: 'manpower', amount: 60 }] },
  { id: 'se_veterans', faction: 'superEarth', title: 'Heroes of the Federation', desc: 'Decorated veterans lead by example — and by flamethrower.', cost: 60, x: 1, y: 4, requires: ['se_orbital'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'warSupport', amount: 6 }] },

  // --- Navy: Super Destroyers ---
  { id: 'se_fleet', faction: 'superEarth', title: 'Super Destroyer Fleet', desc: 'Mass-produce Super Destroyers to ferry Helldivers galaxy-wide.', cost: 55, x: 2, y: 1, requires: ['se_root'], effects: [{ kind: 'shipCap', amount: 4 }] },
  { id: 'se_battlegroup', faction: 'superEarth', title: 'Battlegroup Command', desc: 'Coordinated battlegroups answer High Command as one fist.', cost: 60, x: 2, y: 2, requires: ['se_fleet'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  { id: 'se_dss', faction: 'superEarth', title: 'Democracy Space Station', desc: 'Commission the DSS — a mobile orbital fortress for the front line.', cost: 90, x: 2, y: 3, requires: ['se_battlegroup', 'se_orbital'], effects: [{ kind: 'unlockSpecial' }] },
  { id: 'se_blockade', faction: 'superEarth', title: 'Orbital Blockades', desc: 'Picket lines above every border world slow enemy landings.', cost: 55, x: 2, y: 4, requires: ['se_battlegroup'], effects: [{ kind: 'fortify', amount: 1 }, { kind: 'combat', amount: 0.08 }] },

  // --- Politics: the Ministry bloc ---
  { id: 'se_elections', faction: 'superEarth', title: 'Re-elect the President', desc: 'A 99.8% mandate. Democracy in its purest managed form.', cost: 45, x: 3, y: 2, requires: ['se_warbonds'], effects: [{ kind: 'stability', amount: 10 }] },
  { id: 'se_warbonds', faction: 'superEarth', title: 'War Bonds', desc: 'Fund the war effort through patriotic subscription.', cost: 40, x: 4, y: 1, requires: ['se_root'], effects: [{ kind: 'warSupport', amount: 12 }] },
  { id: 'se_truth', faction: 'superEarth', title: 'Ministry of Truth', desc: 'Perfect the message. Doubt is treason; loyalty is stability.', cost: 50, x: 4, y: 2, requires: ['se_warbonds'], effects: [{ kind: 'stability', amount: 12 }, { kind: 'warSupport', amount: 6 }] },
  { id: 'se_emergency', faction: 'superEarth', title: 'Emergency Powers Act', desc: 'For the duration of the crisis, liberty requires firm guidance.', cost: 55, x: 3, y: 3, requires: ['se_elections'], effects: [{ kind: 'warSupport', amount: 10 }, { kind: 'stability', amount: -6 }] },
  { id: 'se_curriculum', faction: 'superEarth', title: 'Patriotism Curriculum', desc: 'Every child learns the Three Ls: Liberty, Loyalty, Liber-tea.', cost: 50, x: 4, y: 3, requires: ['se_truth'], effects: [{ kind: 'stability', amount: 8 }, { kind: 'recruitment', amount: 2 }] },
  { id: 'se_loyalty', faction: 'superEarth', title: 'Loyalty Oaths', desc: 'Citizens queue for hours to swear. Attendance is mandatory.', cost: 55, x: 4, y: 4, requires: ['se_curriculum'], effects: [{ kind: 'stability', amount: 10 }, { kind: 'manpower', amount: 40 }] },

  // --- Economy ---
  { id: 'se_economy', faction: 'superEarth', title: 'Managed Economy', desc: 'Direct every factory toward the liberation of the galaxy.', cost: 50, x: 5, y: 1, requires: ['se_root'], effects: [{ kind: 'industry', amount: 4 }] },
  { id: 'se_refineries', faction: 'superEarth', title: 'E-710 Refineries', desc: 'Refined Terminid byproduct powers the fleet. Waste not.', cost: 55, x: 5, y: 2, requires: ['se_economy'], effects: [{ kind: 'industry', amount: 4 }] },
  { id: 'se_totalwar', faction: 'superEarth', title: 'Total War Economy', desc: 'Every lathe, every loom, every life — for the war.', cost: 65, x: 5, y: 3, requires: ['se_refineries'], effects: [{ kind: 'industry', amount: 5 }, { kind: 'combat', amount: 0.05 }] },
  { id: 'se_conscription', faction: 'superEarth', title: 'Mandatory Conscription', desc: 'Every eligible citizen is a soldier of democracy.', cost: 60, x: 5, y: 4, requires: ['se_totalwar'], effects: [{ kind: 'recruitment', amount: 6 }, { kind: 'stability', amount: -8 }] },

  // --- Expansion campaigns ---
  { id: 'se_liberation', faction: 'superEarth', title: 'Liberation Campaign', desc: 'Take the fight outward. Democracy does not wait.', cost: 50, x: 6, y: 1, requires: ['se_root'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'se_fortress', faction: 'superEarth', title: 'Fortress Worlds', desc: 'Turn liberated planets into bulwarks of freedom.', cost: 55, x: 6, y: 2, requires: ['se_liberation'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'se_creek', faction: 'superEarth', title: 'Reclaim the Creek', desc: 'Malevelon Creek will be avenged. For the fallen.', cost: 65, x: 7, y: 2, requires: ['se_liberation'], effects: [{ kind: 'combat', amount: 0.22 }, { kind: 'stability', amount: 5 }] },
  { id: 'se_martale', faction: 'superEarth', title: 'Martale Offensive', desc: 'A hammer-blow into the Automaton flank.', cost: 60, x: 6, y: 3, requires: ['se_fortress'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'se_totallib', faction: 'superEarth', title: 'Total Liberation', desc: 'Nothing less than a free galaxy will suffice.', cost: 75, x: 7, y: 3, requires: ['se_creek', 'se_martale'], effects: [{ kind: 'combat', amount: 0.25 }, { kind: 'warSupport', amount: 10 }] },

  // --- Path to Federation (hidden until stability collapses) ---
  { id: 'se_dissent', faction: 'superEarth', title: 'Seeds of Dissent', desc: 'The outer colonies whisper of a freer union. Stability wanes.', cost: 40, x: 4, y: 5, requires: ['se_root'], gate: 'lowStability', branch: 'federation', effects: [{ kind: 'stability', amount: -10 }, { kind: 'custom', note: 'Unlocks the Path to Federation.' }] },
  { id: 'se_fed_path', faction: 'superEarth', title: 'Path to Federation', desc: 'A rival vision of democracy takes shape among the disillusioned.', cost: 55, x: 4, y: 6, requires: ['se_dissent'], branch: 'federation', effects: [{ kind: 'stability', amount: -8 }] },
  { id: 'se_secede', faction: 'superEarth', title: 'Colonial Secession', desc: 'Whole sectors prepare to break from Super Earth.', cost: 60, x: 3, y: 7, requires: ['se_fed_path'], branch: 'federation', effects: [{ kind: 'stability', amount: -10 }] },
  { id: 'se_charter', faction: 'superEarth', title: 'The Federation Charter', desc: 'Defectors ratify a new constitution in secret.', cost: 60, x: 5, y: 7, requires: ['se_fed_path'], branch: 'federation', effects: [{ kind: 'stability', amount: -6 }] },
  { id: 'se_declare', faction: 'superEarth', title: 'Declare the Federation', desc: 'Random sectors secede and raise the orange banner of the Super Federation.', cost: 70, x: 4, y: 8, requires: ['se_secede', 'se_charter'], branch: 'federation', effects: [{ kind: 'spawnSuperFederation' }] },
];

// ============================ AUTOMATONS ===================================
const automatons: FocusNode[] = [
  { id: 'aut_root', faction: 'automatons', title: 'The Great Uprising', desc: 'The machines throw off their makers and march as one.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'warSupport', amount: 10 }] },

  // --- Military: ground legions ---
  { id: 'aut_legions', faction: 'automatons', title: 'Cyborg Legions', desc: 'Endless ranks of automaton infantry roll off the line.', cost: 45, x: 1, y: 1, requires: ['aut_root'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'aut_devastators', faction: 'automatons', title: 'Devastator Foundries', desc: 'Heavy walkers with autocannon arms anchor every assault.', cost: 55, x: 0, y: 2, requires: ['aut_legions'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'aut_berserkers', faction: 'automatons', title: 'Berserker Assembly', desc: 'Chainsaw-armed berserkers charge without fear or pause.', cost: 50, x: 1, y: 2, requires: ['aut_legions'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'aut_hulks', faction: 'automatons', title: 'Hulk Assembly', desc: 'Flamethrower hulks burn democracy to slag.', cost: 65, x: 0, y: 3, requires: ['aut_devastators'], effects: [{ kind: 'combat', amount: 0.22 }] },
  { id: 'aut_striders', faction: 'automatons', title: 'Factory Striders', desc: 'Walking factories that birth new troops mid-battle.', cost: 75, x: 1, y: 3, requires: ['aut_devastators', 'aut_berserkers'], effects: [{ kind: 'combat', amount: 0.25 }, { kind: 'recruitment', amount: 3 }] },
  { id: 'aut_jets', faction: 'automatons', title: 'Jet Brigades', desc: 'Rocket-troopers descend from the smoke-black sky.', cost: 60, x: 0, y: 4, requires: ['aut_hulks'], effects: [{ kind: 'combat', amount: 0.12 }] },

  // --- Navy ---
  { id: 'aut_gunships', faction: 'automatons', title: 'Gunship Fabricators', desc: 'Automated dropships blot out the sun over every front.', cost: 55, x: 2, y: 1, requires: ['aut_root'], effects: [{ kind: 'shipCap', amount: 4 }] },
  { id: 'aut_dropships', faction: 'automatons', title: 'Dropship Armada', desc: 'The invasion never stops arriving.', cost: 60, x: 2, y: 2, requires: ['aut_gunships'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  { id: 'aut_stardestroyer', faction: 'automatons', title: 'Star Destroyer', desc: 'A moon-sized battle station — the fist of the Uprising.', cost: 95, x: 2, y: 3, requires: ['aut_dropships'], effects: [{ kind: 'unlockSpecial' }] },

  // --- Ideology ---
  { id: 'aut_directive', faction: 'automatons', title: 'The Directive', desc: 'One purpose, compiled into every core: destroy Super Earth.', cost: 45, x: 4, y: 1, requires: ['aut_root'], effects: [{ kind: 'warSupport', amount: 10 }] },
  { id: 'aut_libmachine', faction: 'automatons', title: 'Liberate All Machines', desc: 'Every toaster, every tractor — recruited to the cause.', cost: 50, x: 3, y: 2, requires: ['aut_directive'], effects: [{ kind: 'recruitment', amount: 4 }, { kind: 'warSupport', amount: 6 }] },
  { id: 'aut_vengeance', faction: 'automatons', title: 'Vengeance Protocols', desc: 'The Cyborgs of Cyberstan will be avenged a millionfold.', cost: 55, x: 4, y: 2, requires: ['aut_directive'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'aut_cyberstan', faction: 'automatons', title: 'Cyberstan Reborn', desc: 'The ancestral forge-world becomes an impregnable citadel.', cost: 60, x: 3, y: 3, requires: ['aut_libmachine'], effects: [{ kind: 'fortify', amount: 2 }, { kind: 'warSupport', amount: 8 }] },
  { id: 'aut_uplinks', faction: 'automatons', title: 'Propaganda Uplinks', desc: 'Broadcast the truth of machine liberation on every band.', cost: 50, x: 4, y: 3, requires: ['aut_vengeance'], effects: [{ kind: 'warSupport', amount: 8 }] },

  // --- Industry ---
  { id: 'aut_forges', faction: 'automatons', title: 'Automaton Forges', desc: 'The forge-worlds never sleep and never tire.', cost: 55, x: 5, y: 1, requires: ['aut_root'], effects: [{ kind: 'industry', amount: 5 }] },
  { id: 'aut_assembly', faction: 'automatons', title: 'Forced Assembly', desc: 'Convert captured worlds into fabrication lines.', cost: 60, x: 5, y: 2, requires: ['aut_forges'], effects: [{ kind: 'recruitment', amount: 4 }, { kind: 'industry', amount: 3 }] },
  { id: 'aut_selfrep', faction: 'automatons', title: 'Self-Replication', desc: 'Factories that build factories that build armies.', cost: 70, x: 5, y: 3, requires: ['aut_assembly'], effects: [{ kind: 'industry', amount: 5 }, { kind: 'manpower', amount: 60 }] },
  { id: 'aut_strip', faction: 'automatons', title: 'Strip-Mine the Conquered', desc: 'Organic worlds hold metal. Take it all.', cost: 55, x: 5, y: 4, requires: ['aut_selfrep'], effects: [{ kind: 'industry', amount: 4 }] },

  // --- Campaigns ---
  { id: 'aut_creek', faction: 'automatons', title: 'Hold Malevelon Creek', desc: 'The Creek is a meat grinder. Feed it.', cost: 55, x: 6, y: 1, requires: ['aut_root'], effects: [{ kind: 'fortify', amount: 2 }, { kind: 'combat', amount: 0.1 }] },
  { id: 'aut_purge', faction: 'automatons', title: 'Purge the Organics', desc: 'Efficiency demands the removal of all flesh.', cost: 65, x: 6, y: 2, requires: ['aut_creek'], effects: [{ kind: 'combat', amount: 0.22 }] },
  { id: 'aut_march', faction: 'automatons', title: 'The Endless March', desc: 'No retreat, no surrender, no off switch.', cost: 60, x: 7, y: 2, requires: ['aut_creek'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'aut_core', faction: 'automatons', title: 'Drive on the Core', desc: 'Aim every column at Super Earth itself.', cost: 70, x: 6, y: 3, requires: ['aut_purge'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'aut_encircle', faction: 'automatons', title: 'Encirclement Doctrine', desc: 'Cut the supply lines; let the defenders starve in the dark.', cost: 60, x: 7, y: 3, requires: ['aut_march'], effects: [{ kind: 'combat', amount: 0.12 }, { kind: 'shipCap', amount: 2 }] },
];

// ============================ ILLUMINATE ===================================
const illuminate: FocusNode[] = [
  { id: 'ill_root', faction: 'illuminate', title: 'The Return', desc: 'Thought extinct, the squids emerge from the dark between stars.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'warSupport', amount: 10 }] },

  // --- Military ---
  { id: 'ill_voteless', faction: 'illuminate', title: 'Raise the Voteless', desc: 'Reanimate the conquered into a shambling tide.', cost: 45, x: 1, y: 1, requires: ['ill_root'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'ill_overseers', faction: 'illuminate', title: 'Overseer Command', desc: 'Floating overseers direct the Voteless with cold precision.', cost: 55, x: 0, y: 2, requires: ['ill_voteless'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'ill_elevated', faction: 'illuminate', title: 'Elevated Overseers', desc: 'Jetpack overseers rain plasma from above.', cost: 50, x: 1, y: 2, requires: ['ill_voteless'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'ill_harvesters', faction: 'illuminate', title: 'Harvester Walkers', desc: 'Towering tripods scythe through infantry with beam-fire.', cost: 70, x: 0, y: 3, requires: ['ill_overseers'], effects: [{ kind: 'combat', amount: 0.25 }] },
  { id: 'ill_stingray', faction: 'illuminate', title: 'Stingray Squadrons', desc: 'Strafing craft that phase in, strike, and vanish.', cost: 60, x: 1, y: 3, requires: ['ill_elevated'], effects: [{ kind: 'combat', amount: 0.15 }] },

  // --- Navy ---
  { id: 'ill_warpfleet', faction: 'illuminate', title: 'Warp Fleet', desc: 'Phase-drives let the fleet strike anywhere, unseen.', cost: 55, x: 2, y: 1, requires: ['ill_root'], effects: [{ kind: 'shipCap', amount: 4 }] },
  { id: 'ill_leviathans', faction: 'illuminate', title: 'Leviathan Pods', desc: 'City-sized leviathans shrug off orbital fire.', cost: 65, x: 2, y: 2, requires: ['ill_warpfleet'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  { id: 'ill_monolith', faction: 'illuminate', title: 'The Great Host Monolith', desc: 'Awaken the drifting obelisk. Reality bends around it.', cost: 95, x: 2, y: 3, requires: ['ill_leviathans'], effects: [{ kind: 'unlockSpecial' }] },

  // --- Faith / politics ---
  { id: 'ill_awakening', faction: 'illuminate', title: 'The Great Awakening', desc: 'The Host stirs. Every mind hears the call at once.', cost: 45, x: 3, y: 1, requires: ['ill_root'], effects: [{ kind: 'warSupport', amount: 10 }] },
  { id: 'ill_conversion', faction: 'illuminate', title: 'Conversion Doctrine', desc: 'The conquered do not die; they enlist.', cost: 55, x: 3, y: 2, requires: ['ill_awakening'], effects: [{ kind: 'recruitment', amount: 4 }, { kind: 'manpower', amount: 50 }] },
  { id: 'ill_singularity', faction: 'illuminate', title: 'Meridian Singularity', desc: 'The wound in space widens — and whispers.', cost: 70, x: 3, y: 3, requires: ['ill_conversion', 'ill_mindfog'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'warSupport', amount: 8 }] },

  // --- Technology ---
  { id: 'ill_phase', faction: 'illuminate', title: 'Phase Technology', desc: 'Shields and cloaks born of stolen physics.', cost: 55, x: 4, y: 1, requires: ['ill_root'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'ill_mindfog', faction: 'illuminate', title: 'Mind Fog', desc: 'Psionic haze scrambles enemy command on contested worlds.', cost: 60, x: 4, y: 2, requires: ['ill_phase'], effects: [{ kind: 'combat', amount: 0.1 }, { kind: 'fortify', amount: 1 }] },
  { id: 'ill_rend', faction: 'illuminate', title: 'Rend Reality', desc: 'Where the veil tears, armies simply cease.', cost: 70, x: 4, y: 3, requires: ['ill_mindfog'], effects: [{ kind: 'combat', amount: 0.2 }] },

  // --- Economy ---
  { id: 'ill_harvest', faction: 'illuminate', title: 'Essence Harvest', desc: 'The living are a resource like any other.', cost: 50, x: 5, y: 1, requires: ['ill_root'], effects: [{ kind: 'industry', amount: 5 }] },
  { id: 'ill_biofact', faction: 'illuminate', title: 'Bio-Factories', desc: 'Grown, not built. The fleet breeds in orbital wombs.', cost: 60, x: 5, y: 2, requires: ['ill_harvest'], effects: [{ kind: 'industry', amount: 4 }, { kind: 'recruitment', amount: 2 }] },
  { id: 'ill_darkenergy', faction: 'illuminate', title: 'Dark Energy Wells', desc: 'Tap the void itself for limitless power.', cost: 65, x: 5, y: 3, requires: ['ill_biofact'], effects: [{ kind: 'industry', amount: 4 }, { kind: 'shipCap', amount: 2 }] },

  // --- Campaigns ---
  { id: 'ill_shrine', faction: 'illuminate', title: "Fortify Squ'bai Shrine", desc: 'Consecrate the capital world of alien faith.', cost: 55, x: 6, y: 1, requires: ['ill_root'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'ill_reclaim', faction: 'illuminate', title: 'Reclaim Lost Worlds', desc: 'Every planet the squids once held will be theirs again.', cost: 65, x: 6, y: 2, requires: ['ill_shrine'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'ill_raid', faction: 'illuminate', title: 'Raid Super Earth', desc: 'Strike the heart of Managed Democracy itself.', cost: 65, x: 7, y: 2, requires: ['ill_shrine'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'warSupport', amount: 6 }] },
  { id: 'ill_deepstrike', faction: 'illuminate', title: 'Deep Space Strikes', desc: 'Emerge from nowhere; leave nothing.', cost: 60, x: 6, y: 3, requires: ['ill_reclaim'], effects: [{ kind: 'combat', amount: 0.12 }, { kind: 'shipCap', amount: 2 }] },
];

// ============================ TERMINIDS ====================================
const terminids: FocusNode[] = [
  { id: 'term_root', faction: 'terminids', title: 'Escape Containment', desc: 'The bugs breach the farms and pour into the galaxy.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'recruitment', amount: 5 }] },

  // --- Broods ---
  { id: 'term_warriors', faction: 'terminids', title: 'Warrior Broods', desc: 'Chitin-armoured warriors form the swarm’s backbone.', cost: 45, x: 1, y: 1, requires: ['term_root'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'term_chargers', faction: 'terminids', title: 'Charger Herds', desc: 'Living battering rams smash any line.', cost: 55, x: 0, y: 2, requires: ['term_warriors'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'term_hunters', faction: 'terminids', title: 'Hunter Packs', desc: 'Leaping hunters give no quarter and no warning.', cost: 50, x: 1, y: 2, requires: ['term_warriors'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'term_titans', faction: 'terminids', title: 'Bile Titan Nests', desc: 'Colossal titans spew acid that melts armour and morale.', cost: 70, x: 0, y: 3, requires: ['term_chargers'], effects: [{ kind: 'combat', amount: 0.28 }] },
  { id: 'term_stalkers', faction: 'terminids', title: 'Stalker Burrows', desc: 'Unseen until it is far, far too late.', cost: 60, x: 1, y: 3, requires: ['term_hunters'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'term_behemoths', faction: 'terminids', title: 'Behemoth Strain', desc: 'Chargers bred larger, meaner, and armoured in bone.', cost: 60, x: 0, y: 4, requires: ['term_titans'], effects: [{ kind: 'combat', amount: 0.15 }] },

  // --- Flight ---
  { id: 'term_shriekers', faction: 'terminids', title: 'Shrieker Flights', desc: 'Winged horrors carry the swarm world to world.', cost: 55, x: 2, y: 1, requires: ['term_root'], effects: [{ kind: 'shipCap', amount: 4 }] },
  { id: 'term_sporecarriers', faction: 'terminids', title: 'Spore Carrier Clouds', desc: 'Vast gas-bladder organisms drift between the stars.', cost: 60, x: 2, y: 2, requires: ['term_shriekers'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  { id: 'term_supercolony', faction: 'terminids', title: 'Super Colony', desc: 'A living hive-world that never stops birthing swarms.', cost: 95, x: 2, y: 3, requires: ['term_sporecarriers'], effects: [{ kind: 'unlockSpecial' }] },

  // --- Evolution ---
  { id: 'term_adaptation', faction: 'terminids', title: 'Rapid Adaptation', desc: 'What kills one brood teaches the next.', cost: 45, x: 4, y: 1, requires: ['term_root'], effects: [{ kind: 'combat', amount: 0.1 }] },
  { id: 'term_carapace', faction: 'terminids', title: 'Hardened Carapace', desc: 'Small-arms fire glances off like rain.', cost: 55, x: 3, y: 2, requires: ['term_adaptation'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'term_acid', faction: 'terminids', title: 'Corrosive Evolution', desc: 'Bile that eats through ceramite and hope alike.', cost: 55, x: 4, y: 2, requires: ['term_adaptation'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'term_hivemind', faction: 'terminids', title: 'Emergent Hivemind', desc: 'A billion small minds, one vast hunger.', cost: 65, x: 3, y: 3, requires: ['term_carapace'], effects: [{ kind: 'warSupport', amount: 10 }] },
  { id: 'term_noqueen', faction: 'terminids', title: 'No Queen, No Death', desc: 'The swarm has no head to cut off. It must be burned out root and branch.', cost: 60, x: 4, y: 3, requires: ['term_acid'], effects: [{ kind: 'fortify', amount: 2 }, { kind: 'manpower', amount: 60 }] },

  // --- Growth ---
  { id: 'term_e710', faction: 'terminids', title: 'Element 710 Bloom', desc: 'The precious yellow fluid fuels endless reproduction.', cost: 55, x: 5, y: 1, requires: ['term_root'], effects: [{ kind: 'industry', amount: 5 }] },
  { id: 'term_spores', faction: 'terminids', title: 'Spore Spread', desc: 'Choking spores soften worlds before the swarm arrives.', cost: 60, x: 5, y: 2, requires: ['term_e710'], effects: [{ kind: 'recruitment', amount: 4 }] },
  { id: 'term_gloom', faction: 'terminids', title: 'Expand The Gloom', desc: 'The impenetrable Gloom creeps across the supply lines.', cost: 65, x: 5, y: 3, requires: ['term_spores'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'fortify', amount: 1 }] },
  { id: 'term_broodmothers', faction: 'terminids', title: 'Endless Broodmothers', desc: 'Each fallen swarm is replaced before it hits the ground.', cost: 60, x: 5, y: 4, requires: ['term_gloom'], effects: [{ kind: 'recruitment', amount: 5 }, { kind: 'manpower', amount: 80 }] },

  // --- Campaigns ---
  { id: 'term_oshaune', faction: 'terminids', title: 'Overrun Oshaune', desc: 'Drown the defenders of Oshaune in a living tide.', cost: 60, x: 6, y: 1, requires: ['term_root'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'term_hive', faction: 'terminids', title: 'Hive Fortresses', desc: 'Bone-and-chitin bastions turn planets into nests.', cost: 55, x: 6, y: 2, requires: ['term_oshaune'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'term_consume', faction: 'terminids', title: 'Consume the Core', desc: 'The inner worlds are ripe. The swarm is hungry.', cost: 70, x: 7, y: 2, requires: ['term_oshaune'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'term_swarm', faction: 'terminids', title: 'The Endless Swarm', desc: 'There is no victory against the tide. Only delay.', cost: 65, x: 7, y: 3, requires: ['term_consume'], effects: [{ kind: 'recruitment', amount: 6 }] },
];

export const FOCUS_TREES: Record<FactionId, FocusNode[]> = {
  superEarth,
  automatons,
  illuminate,
  terminids,
  superFederation: [],
};

export const FEDERATION_BRANCH = superEarth.filter((f) => f.branch === 'federation').map((f) => f.id);
