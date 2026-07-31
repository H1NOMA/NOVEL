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
    const seen = new Set<string>();
    for (const id of state.fleetOrder) {
      const fleet = state.fleets.get(id);
      if (!fleet) continue;
      seen.add(id);
      let fm = this.meshes.get(id);
      if (!fm) {
        fm = this.make(fleet);
        this.meshes.set(id, fm);
      }
      const wp = fleetWorldPos(state.galaxy, fleet);
      const x = wp.x * this.scale;
      const z = wp.y * this.scale;
      const y = fm.special ? 0.32 : 0.2;
      // orient toward travel direction
      if (fleet.transit) {
        const dx = x - fm.last.x;
        const dz = z - fm.last.y;
        if (Math.abs(dx) + Math.abs(dz) > 1e-5) {
          fm.body.rotation.y = Math.atan2(dx, dz);
          if (!fm.special) fm.body.rotation.x = Math.PI / 2;
        }
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
