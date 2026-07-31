import * as THREE from 'three';
import type { Fleet } from '../core/types';
import { FACTIONS } from '../data/factions';
import { fleetWorldPos } from '../game/units';
import type { GameState } from '../game/state';

const SHIP_GEO = new THREE.ConeGeometry(0.09, 0.26, 5);
const SPECIAL_GEO = new THREE.OctahedronGeometry(0.2, 0);
const GLOW_GEO = new THREE.SphereGeometry(0.14, 10, 10);

interface FleetMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  last: THREE.Vector2;
  special: boolean;
}

export class FleetLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<string, FleetMesh>();
  private t = 0;

  constructor(private scale: number) {}

  private make(fleet: Fleet): FleetMesh {
    const color = new THREE.Color(FACTIONS[fleet.faction].color);
    const special = !!fleet.special;
    const mat = new THREE.MeshBasicMaterial({ color });
    const body = new THREE.Mesh(special ? SPECIAL_GEO : SHIP_GEO, mat);
    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(GLOW_GEO, glowMat);
    glow.scale.setScalar(special ? 2.2 : 1.3);
    const g = new THREE.Group();
    g.add(body, glow);
    const fm: FleetMesh = { group: g, body, last: new THREE.Vector2(), special };
    this.group.add(g);
    return fm;
  }

  update(state: GameState, dt: number): void {
    this.t += dt;
    const seen = new Set<string>();

    // Docked fleets share their planet's orbit — assign each an orbital slot
    // so several fleets spread out evenly instead of stacking at the centre.
    const docked = new Map<string, Fleet[]>();
    for (const id of state.fleetOrder) {
      const fleet = state.fleets.get(id);
      if (fleet && !fleet.transit) {
        if (!docked.has(fleet.at)) docked.set(fleet.at, []);
        docked.get(fleet.at)!.push(fleet);
      }
    }

    for (const id of state.fleetOrder) {
      const fleet = state.fleets.get(id);
      if (!fleet) continue;
      seen.add(id);
      let fm = this.meshes.get(id);
      if (!fm) {
        fm = this.make(fleet);
        this.meshes.set(id, fm);
      }

      if (!fleet.transit) {
        // In orbit: circle the planet at its rim.
        const planet = state.galaxy.planets.get(fleet.at);
        if (planet) {
          const slots = docked.get(fleet.at)!;
          const slot = slots.indexOf(fleet);
          const planetR = 0.42 * planet.scale;
          const orbitR = planetR * 1.75 + (slot % 3) * 0.14;
          const angle = this.t * (0.55 - (slot % 3) * 0.12) + (slot * Math.PI * 2) / Math.max(1, slots.length);
          const cx = planet.pos.x * this.scale;
          const cz = planet.pos.y * this.scale;
          const x = cx + Math.cos(angle) * orbitR;
          const z = cz + Math.sin(angle) * orbitR;
          const y = fm.special ? 0.3 : 0.18;
          fm.group.position.set(x, y, z);
          // face along the orbital tangent
          fm.body.rotation.set(Math.PI / 2, Math.atan2(-Math.sin(angle), -Math.cos(angle)) , 0);
          if (fm.special) {
            fm.body.rotation.x = 0;
            fm.body.rotation.y += dt * 0.6;
          }
          fm.last.set(x, z);
          continue;
        }
      }

      // In transit: fly along the supply lines.
      const wp = fleetWorldPos(state.galaxy, fleet);
      const x = wp.x * this.scale;
      const z = wp.y * this.scale;
      const y = fm.special ? 0.32 : 0.2;
      const dx = x - fm.last.x;
      const dz = z - fm.last.y;
      if (Math.abs(dx) + Math.abs(dz) > 1e-5) {
        fm.body.rotation.set(fm.special ? 0 : Math.PI / 2, Math.atan2(dx, dz), 0);
      }
      fm.last.set(x, z);
      fm.group.position.set(x, y, z);
      if (fm.special) fm.body.rotation.y += dt * 0.6;
    }

    // Remove meshes for fleets that no longer exist.
    for (const [id, fm] of this.meshes) {
      if (!seen.has(id)) {
        this.group.remove(fm.group);
        this.meshes.delete(id);
      }
    }
  }
}
