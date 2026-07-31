# The Second Galactic War

A real-time galactic strategy game set in the **Helldivers 2** universe. Command
one of four factions across a living galaxy of volumetric planets, drive fleets
along supply lines, land troops, wage planetary war, and steer your nation's
focus tree — including Super Earth's descent into civil war and the rise of the
**Super Federation**.

Built with **Vite + TypeScript + Three.js**. No backend, no assets to download —
every planet is generated procedurally in a GLSL shader.

## Run

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

### Factions
Four playable powers from the Second Galactic War, plus a hidden fifth:

| Faction | Colour | Capital | Special unit |
|---|---|---|---|
| **Super Earth** | Blue | Super Earth | Democracy Space Station |
| **The Automatons** | Red | Cyberstan | Automaton Star Destroyer |
| **The Illuminate** | Purple | Squ'bai Shrine | Great Host Monolith |
| **The Terminids** | Gold | Kepler Prime | Terminid Super Colony |
| **The Super Federation** | Orange | *(secession)* | Federation Dreadnought |

### Three troop types (per faction)
1. **Ships** — fleets that move between planets along supply lines and carry troops.
2. **Infantry** — carried aboard ships, deployed to planets, and does the ground fighting.
3. **Special technology** — a unique super-unit per faction (a moon-sized Star
   Destroyer, an orbital Democracy Space Station, a reality-bending Monolith, a
   living Super Colony), unlocked through the focus tree.

### Combat
- **Orbital layer:** hostile fleets sharing a world trade ship losses.
- **Ground layer:** an attacker lands infantry and grinds the garrison; a
  liberation meter fills over days, factoring fortification and faction bonuses.
  At 100% (or when the garrison breaks) the planet flips owner.

### Focus trees
- A full, branching **national focus tree** for each faction (military, home
  front / industry, and expansion branches), loosely faithful to Helldivers lore.
- Focuses complete over in-game days and grant war support, recruitment,
  industry, ship cap, combat, fortification and stability bonuses, or unlock the
  faction's special unit.

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
