# The Second Galactic War

A real-time galactic strategy game set in the **Helldivers 2** universe. Command
one of four factions across a living galaxy of volumetric planets, drive fleets
along supply lines, land troops, wage planetary war, and steer your nation's
focus tree — including Super Earth's descent into civil war and the rise of the
**Super Federation**.

Built with **Vite + TypeScript + Three.js**. No backend, no assets to download —
every planet is generated procedurally in a GLSL shader.

## Desktop app (primary target)

The game ships as a native desktop application (Electron shell around the
Three.js game). Build a distributable for your OS:

```bash
npm install
npm run app        # build & launch the desktop app locally
npm run app:win    # portable Windows x64 build → release/SecondGalacticWar-win32-x64/
npm run app:linux  # Linux x64 build          → release/SecondGalacticWar-linux-x64/
npm run app:mac    # macOS arm64 build        → release/SecondGalacticWar-darwin-arm64/
```

The Windows build is fully portable — zip the folder, unzip anywhere, run
`SecondGalacticWar.exe`. No installer, no dependencies. **F11** toggles
fullscreen. The app allows a software-rendering fallback on machines with
broken GPU drivers.

**Ready-made builds** are published on the repository's
[**Releases**](../../releases) page — download the zip for your OS, unzip, play.
Pushing a `v*` tag builds and publishes a new release automatically; every
ordinary push also uploads the zips as workflow artifacts.

## Run in a browser (dev)

```bash
npm install
npm run dev        # dev server: http://localhost:5173
npm run build      # production build → dist/ (static, runs anywhere)
npm run preview    # preview the production build
```

## Controls

| Input | Action |
|---|---|
| **Drag** | Pan the galaxy |
| **Wheel** | Zoom in / out |
| **Right-drag** | Orbit / tilt the camera |
| **Click a planet** | Inspect it |
| **Select a fleet → click a planet** | Move (own space) or invade (enemy world) |
| **F** | Open the national focus tree |
| **Space** | Pause / resume |
| **1 / 2 / 3** | Game speed ×1 / ×2 / ×3 (days pass faster) |

## Features

### The galaxy map
- A radial, **tilted disc** of concentric rings so the map reads with depth
  without flattening — planets are true 3D spheres, not sprites.
- Every planet has a **procedural, volumetric surface** (simplex-noise terrain,
  seas, ice caps, clouds, atmosphere rim) drawn from one of ten **biomes**
  (Terran, Ocean, Desert, Ice, Volcanic, Jungle, The Gloom, Barren, Toxic, Gas).
- **Supply lines** connect neighbouring worlds and are colour-coded by owner.
  Fleets can only travel along these lines, and only through friendly territory.
- Free zoom and pan, with a faction-coloured ownership halo on every world.

### Factions & capitals
Four playable powers from the Second Galactic War, plus a hidden fifth:

| Faction | Colour | Capital | Special unit |
|---|---|---|---|
| **Super Earth** | Blue | Super Earth *(galactic centre)* | Democracy Space Station |
| **The Automatons** | Red | Cyberstan *(far outer sectors)* | Automaton Star Destroyer |
| **The Illuminate** | Purple | Squ'bai Shrine *(far outer sectors)* | Great Host Monolith |
| **The Terminids** | Gold | **none** — Kepler Prime is just the strongest hive | Terminid Super Colony |
| **The Super Federation** | Orange | New Concord *(strongest seceded world)* | Federation Dreadnought |

**Capitals matter.** Capture a faction's capital (★) and it **capitulates** —
every remaining world submits to the victor and its fleets scatter. The
Terminids have no capital: the swarm has no head to cut off and must be
**exterminated planet by planet**.

### Troops & manpower
Every faction fields **ships** (fleets on supply lines), **infantry** (ground
forces drawn from named troop pools) and a **special super-unit** unlocked via
the focus tree. Infantry is not abstract — each faction has its own troop
types with distinct replenishment rules:

| Faction | Troops | Replenishment |
|---|---|---|
| Super Earth | Helldivers (elite) + SEAF (mass) | grows with controlled planets; E-711 fuel mined from liberated Terminid worlds boosts the fleet |
| Automatons | AAF (mass), Incinerator & Jet squads (need dedicated factories), Cyborg Legions (elite) | built from minerals mined on magma/volcanic worlds; Cyborg Legions assemble **only on Cyberstan** |
| Terminids | Swarm (mass) + Breach/Predator/Spore strains | effectively endless — grows with every planet held |
| Illuminate | Great Fleet (elite, **irreplaceable**), Voteless (mass), Confiscators | Voteless replenished by harvesting the population of captured Super Earth worlds |

Elite share boosts combat power; mass share speeds up planetary capture.
Garrisons and fleet complements draw from these real pools.

### Combat
- **Orbital layer:** hostile fleets sharing a world trade ship losses.
- **Ground layer:** an attacker lands infantry and grinds the garrison; a
  liberation meter fills over days, factoring fortification and faction bonuses.
  At 100% (or when the garrison breaks) the planet flips owner.

### Focus trees
- A large, branching **national focus tree** for each faction — 100+ focuses in
  total, loosely faithful to Helldivers lore. Every faction has several distinct
  branches:
  - **Military** (ground forces: Helldivers / Devastators / Harvesters / Bile Titans…)
  - **Navy / mobility** (Super Destroyers, Dropship Armadas, Warp Fleets, Shrieker Flights)
  - **Politics / ideology** (Ministry of Truth, The Directive, The Great
    Awakening, Emergent Hivemind)
  - **Economy / industry** (War Economy, Self-Replication, Essence Harvest, E-710 Bloom)
  - **Expansion campaigns** (Reclaim the Creek, Drive on the Core, Raid Super
    Earth, Consume the Core)
- Focuses complete over in-game days and grant war support, recruitment,
  industry, ship cap, combat, fortification, stability and manpower bonuses,
  spawn reinforcement fleets, or unlock the faction's special unit.

### Super Earth stability & the Super Federation
- Super Earth has a **stability** modifier. Some focuses (conscription, dissent)
  erode it; propaganda restores it.
- When stability falls **below 40%**, a hidden branch — **the Path to
  Federation** — unlocks.
- Walk the majority of that branch and **several random Super-Earth sectors
  secede**, turning orange and joining the newly risen **Super Federation**,
  which then wars against Super Earth *and* everyone else.

### Time
Real-time simulation counted in **days**, at ×1, ×2 and ×3 speed, plus pause.

## Project layout

```
src/
  core/     types, seeded RNG, event bus
  data/     factions, biomes, focus trees
  game/     galaxy generation, state, clock, units, combat, focus, AI, sim
  render/   Three.js scene, procedural planet shader, starfield, fleets
  ui/       HUD, planet panel, focus-tree overlay, log
  main.ts   bootstrap
```
