import * as THREE from 'three';
import type { Fleet } from '../core/types';
import { FACTIONS } from '../data/factions';
import { fleetWorldPos } from '../game/units';
import type { GameState } from '../game/state';
import { shipModel, stationModel } from './ships';

const GLOW_GEO = new THREE.SphereGeometry(0.12, 10, 10);
const EXHAUST_GEO = new THREE.ConeGeometry(0.03, 0.16, 6);

interface FleetMesh {
  group: THREE.Group;
  model: THREE.Group;
  /** Дополнительные модельки стека (2-й и 3-й кораблик соединения). */
  extras: THREE.Group[];
  exhaust: THREE.Mesh;
  exhaustMat: THREE.MeshBasicMaterial;
  last: THREE.Vector2;
  yaw: number;
  phase: number;
  special: boolean;
  stackShown: number;
}

/** Сколько корабликов показывать: ≤10 корпусов — 1, 11–20 — 2, 21+ — 3. */
function stackSize(hulls: number): number {
  if (hulls > 20) return 3;
  if (hulls > 10) return 2;
  return 1;
}

/** Кратчайшая интерполяция угла (через ±π). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

export class FleetLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<string, FleetMesh>();
  private t = 0;

  constructor(private scale: number) {}

  private make(fleet: Fleet): FleetMesh {
    const color = new THREE.Color(FACTIONS[fleet.faction].color);
    const special = !!fleet.special;
    const model = special ? stationModel(color) : shipModel(fleet.faction, color);

    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(GLOW_GEO, glowMat);
    glow.scale.setScalar(special ? 2.4 : 1.5);

    // Выхлоп двигателей — виден только в полёте.
    const exhaustMat = new THREE.MeshBasicMaterial({
      color: 0x9fd4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const exhaust = new THREE.Mesh(EXHAUST_GEO, exhaustMat);
    exhaust.rotation.x = Math.PI / 2; // остриё назад вдоль -Z
    exhaust.position.z = -0.24;
    model.add(exhaust);

    // Стек: до двух уменьшенных копий модели рядом (11–20 и 21+ корпусов).
    const extras: THREE.Group[] = [];
    if (!special) {
      for (const [dx, dz] of [[-0.16, -0.1], [0.16, -0.1]] as const) {
        const copy = shipModel(fleet.faction, color);
        copy.scale.setScalar(0.75);
        copy.position.set(dx, -0.02, dz);
        copy.visible = false;
        model.add(copy);
        extras.push(copy);
      }
    }

    const g = new THREE.Group();
    g.add(model, glow);
    const fm: FleetMesh = {
      group: g,
      model,
      extras,
      exhaust,
      exhaustMat,
      last: new THREE.Vector2(),
      yaw: 0,
      phase: Math.random() * Math.PI * 2,
      special,
      stackShown: 1,
    };
    this.group.add(g);
    return fm;
  }

  /** Обновить число корабликов в стеке по количеству корпусов соединения. */
  private syncStack(fm: FleetMesh, fleet: Fleet): void {
    const want = fm.special ? 1 : stackSize(fleet.ships + fleet.dreadnoughts + fleet.battleships);
    if (want === fm.stackShown) return;
    fm.stackShown = want;
    fm.extras.forEach((ex, i) => (ex.visible = i < want - 1));
  }

  update(state: GameState, dt: number): void {
    this.t += dt;
    const seen = new Set<string>();

    // Флоты на стоянке делят орбиту планеты — распределяем по слотам.
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
      this.syncStack(fm, fleet);

      const bob = Math.sin(this.t * 2.2 + fm.phase) * 0.012;

      if (!fleet.transit) {
        // На орбите: кружим у кромки планеты.
        const planet = state.galaxy.planets.get(fleet.at);
        if (planet) {
          const slots = docked.get(fleet.at)!;
          const slot = slots.indexOf(fleet);
          const planetR = 0.42 * planet.scale;
          const orbitR = planetR * 1.8 + (slot % 3) * 0.16;
          const angle = this.t * (0.5 - (slot % 3) * 0.11) + (slot * Math.PI * 2) / Math.max(1, slots.length);
          const x = planet.pos.x * this.scale + Math.cos(angle) * orbitR;
          const z = planet.pos.y * this.scale + Math.sin(angle) * orbitR;
          fm.group.position.set(x, (fm.special ? 0.3 : 0.16) + bob, z);
          // нос по касательной к орбите
          const targetYaw = Math.atan2(-Math.cos(angle), Math.sin(angle));
          fm.yaw = lerpAngle(fm.yaw, targetYaw, dt * 4);
          fm.model.rotation.y = fm.yaw;
          if (fm.special) fm.model.rotation.y += Math.sin(this.t * 0.4) * 0.2;
          fm.exhaustMat.opacity = Math.max(0, fm.exhaustMat.opacity - dt * 2);
          fm.last.set(x, z);
          continue;
        }
      }

      // В полёте по линиям снабжения.
      const wp = fleetWorldPos(state.galaxy, fleet);
      const x = wp.x * this.scale;
      const z = wp.y * this.scale;
      const dx = x - fm.last.x;
      const dz = z - fm.last.y;
      if (Math.abs(dx) + Math.abs(dz) > 1e-6) {
        fm.yaw = lerpAngle(fm.yaw, Math.atan2(dx, dz), dt * 5);
      }
      fm.model.rotation.y = fm.yaw;
      fm.group.position.set(x, (fm.special ? 0.32 : 0.2) + bob, z);
      // выхлоп: разгорается в полёте и пульсирует
      fm.exhaustMat.opacity = Math.min(0.75, fm.exhaustMat.opacity + dt * 3);
      fm.exhaust.scale.y = 0.85 + Math.sin(this.t * 9 + fm.phase) * 0.25;
      fm.last.set(x, z);
    }

    // Удаляем меши исчезнувших флотов.
    for (const [id, fm] of this.meshes) {
      if (!seen.has(id)) {
        this.group.remove(fm.group);
        this.meshes.delete(id);
      }
    }
  }
}
