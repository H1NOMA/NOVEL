import * as THREE from 'three';
import type { GameState } from '../game/state';
import { FACTIONS } from '../data/factions';
import { bus } from '../core/emitter';
import { createPlanetVisual, type PlanetVisual } from './planetMesh';
import { createNebulaDisc, createStarfield } from './starfield';
import { FleetLayer } from './fleets';

export const GALAXY_SCALE = 0.03;

const NEUTRAL_SECTOR = new THREE.Color('#33415e');

interface SectorVisual {
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  border: THREE.LineLoop;
  borderMat: THREE.LineBasicMaterial;
}

export class GalaxyScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private planets = new Map<string, PlanetVisual>();
  private surfaces: THREE.Mesh[] = [];
  private fleets: FleetLayer;
  private supplyColors!: THREE.BufferAttribute;
  private sectorVisuals = new Map<string, SectorVisual>();

  // camera controller
  private target = new THREE.Vector3(0, 0, 0);
  private distance = 26;
  private yaw = 0;
  private pitch = 0.95;
  private readonly minDist = 3.5;
  private readonly maxDist = 62;

  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private radiusWorld: number;

  constructor(private canvas: HTMLCanvasElement, private state: GameState) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setClearColor(0x05070f, 1);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 2000);
    this.radiusWorld = state.galaxy.radiusMax * GALAXY_SCALE;
    this.fleets = new FleetLayer(GALAXY_SCALE);

    this.buildBackground();
    this.buildSectors();
    this.buildSupplyLines();
    this.buildPlanets();
    this.scene.add(this.fleets.group);

    this.resize();
    this.attachInput();
    window.addEventListener('resize', () => this.resize());
  }

  // --- construction --------------------------------------------------------

  private buildBackground(): void {
    this.scene.add(createStarfield(3200, this.radiusWorld * 16));
    this.scene.add(createNebulaDisc(this.radiusWorld));
    const amb = new THREE.AmbientLight(0x8899bb, 0.6);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(6, 10, 8);
    this.scene.add(amb, key);
    // Central Super Earth glow.
    const glow = new THREE.PointLight(0x7fc4ff, 1.3, 22);
    glow.position.set(0, 1, 0);
    this.scene.add(glow);
  }

  /** Flat annulus-sector plates + borders under the planets, one per sector. */
  private buildSectors(): void {
    const s = GALAXY_SCALE;
    const GAP = 0.018; // radians shaved off each side for visual separation
    for (const sector of this.state.galaxy.sectors.values()) {
      const a0 = sector.a0 + (sector.a1 - sector.a0 > 6 ? 0 : GAP);
      const a1 = sector.a1 - (sector.a1 - sector.a0 > 6 ? 0 : GAP);
      const r0 = sector.r0 * s;
      const r1 = sector.r1 * s;

      const shape = new THREE.Shape();
      if (r0 <= 0.001) {
        shape.absarc(0, 0, r1, 0, Math.PI * 2, false);
      } else {
        shape.absarc(0, 0, r1, a0, a1, false);
        shape.absarc(0, 0, r0, a1, a0, true);
      }
      const geo = new THREE.ShapeGeometry(shape, 28);
      const fillMat = new THREE.MeshBasicMaterial({
        color: NEUTRAL_SECTOR.clone(),
        transparent: true,
        opacity: 0.03,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const fill = new THREE.Mesh(geo, fillMat);
      fill.rotation.x = Math.PI / 2; // XY shape → XZ galactic plane (matches planet angles)
      fill.position.y = -0.42;

      // Border as an explicit line loop in world space.
      const pts: THREE.Vector3[] = [];
      const SEG = 26;
      const y = -0.4;
      if (r0 <= 0.001) {
        for (let i = 0; i < SEG * 2; i++) {
          const a = (Math.PI * 2 * i) / (SEG * 2);
          pts.push(new THREE.Vector3(Math.cos(a) * r1, y, Math.sin(a) * r1));
        }
      } else {
        for (let i = 0; i <= SEG; i++) {
          const a = a0 + ((a1 - a0) * i) / SEG;
          pts.push(new THREE.Vector3(Math.cos(a) * r1, y, Math.sin(a) * r1));
        }
        for (let i = SEG; i >= 0; i--) {
          const a = a0 + ((a1 - a0) * i) / SEG;
          pts.push(new THREE.Vector3(Math.cos(a) * r0, y, Math.sin(a) * r0));
        }
      }
      const borderGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const borderMat = new THREE.LineBasicMaterial({
        color: NEUTRAL_SECTOR.clone(),
        transparent: true,
        opacity: 0.22,
      });
      const border = new THREE.LineLoop(borderGeo, borderMat);

      this.scene.add(fill, border);
      this.sectorVisuals.set(sector.id, { fill, fillMat, border, borderMat });
    }
  }

  private buildSupplyLines(): void {
    const lines = this.state.galaxy.lines;
    const positions = new Float32Array(lines.length * 6);
    const colors = new Float32Array(lines.length * 6);
    lines.forEach((ln, i) => {
      const a = this.state.galaxy.planets.get(ln.a)!;
      const b = this.state.galaxy.planets.get(ln.b)!;
      positions[i * 6] = a.pos.x * GALAXY_SCALE;
      positions[i * 6 + 1] = 0;
      positions[i * 6 + 2] = a.pos.y * GALAXY_SCALE;
      positions[i * 6 + 3] = b.pos.x * GALAXY_SCALE;
      positions[i * 6 + 4] = 0;
      positions[i * 6 + 5] = b.pos.y * GALAXY_SCALE;
      for (let k = 0; k < 6; k++) colors[i * 6 + k] = 0.28;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.supplyColors = new THREE.BufferAttribute(colors, 3);
    geo.setAttribute('color', this.supplyColors);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.scene.add(new THREE.LineSegments(geo, mat));
  }

  private buildPlanets(): void {
    for (const id of this.state.galaxy.order) {
      const p = this.state.galaxy.planets.get(id)!;
      const vis = createPlanetVisual(p, 1);
      vis.group.position.set(p.pos.x * GALAXY_SCALE, 0, p.pos.y * GALAXY_SCALE);
      this.planets.set(id, vis);
      this.surfaces.push(vis.surface);
      this.scene.add(vis.group);
    }
    this.refreshOwners();
  }

  /** Re-colour supply lines by the owner of their endpoints. */
  private refreshSupplyColors(): void {
    const arr = this.supplyColors.array as Float32Array;
    this.state.galaxy.lines.forEach((ln, li) => {
      const pa = this.state.galaxy.planets.get(ln.a)!;
      const pb = this.state.galaxy.planets.get(ln.b)!;
      const dim = pa.abyss || pb.abyss ? 0.12 : 1;
      const ca = new THREE.Color(FACTIONS[pa.owner].color).multiplyScalar(dim);
      const cb = new THREE.Color(FACTIONS[pb.owner].color).multiplyScalar(dim);
      const base = li * 6;
      arr[base] = ca.r * 0.5; arr[base + 1] = ca.g * 0.5; arr[base + 2] = ca.b * 0.5;
      arr[base + 3] = cb.r * 0.5; arr[base + 4] = cb.g * 0.5; arr[base + 5] = cb.b * 0.5;
    });
    this.supplyColors.needsUpdate = true;
  }

  /** A fully-conquered sector lights up in its owner's colour. */
  private refreshSectors(): void {
    for (const sector of this.state.galaxy.sectors.values()) {
      const vis = this.sectorVisuals.get(sector.id);
      if (!vis) continue;
      const owners = new Set(sector.planets.map((pid) => this.state.galaxy.planets.get(pid)!.owner));
      if (owners.size === 1) {
        const color = FACTIONS[[...owners][0]!].color;
        vis.fillMat.color.set(color);
        vis.fillMat.opacity = 0.09;
        vis.borderMat.color.set(color);
        vis.borderMat.opacity = 0.6;
      } else {
        vis.fillMat.color.copy(NEUTRAL_SECTOR);
        vis.fillMat.opacity = 0.03;
        vis.borderMat.color.copy(NEUTRAL_SECTOR);
        vis.borderMat.opacity = 0.22;
      }
    }
  }

  refreshOwners(): void {
    for (const id of this.state.galaxy.order) {
      const p = this.state.galaxy.planets.get(id)!;
      const vis = this.planets.get(id);
      if (!vis) continue;
      vis.setOwner(FACTIONS[p.owner].color);
      vis.setGloom(p.gloom);
      vis.setAbyss(p.abyss);
    }
    this.refreshSupplyColors();
    this.refreshSectors();
  }

  // --- selection -----------------------------------------------------------

  setSelected(id: string | null): void {
    for (const [pid, vis] of this.planets) vis.setSelected(pid === id);
  }

  private hoveredId: string | null = null;
  setHovered(id: string | null): void {
    if (id === this.hoveredId) return;
    if (this.hoveredId) this.planets.get(this.hoveredId)?.setHovered(false);
    this.hoveredId = id;
    if (id) this.planets.get(id)?.setHovered(true);
    this.canvas.style.cursor = id ? 'pointer' : 'default';
  }

  focusOn(id: string): void {
    const p = this.state.galaxy.planets.get(id);
    if (!p) return;
    this.target.set(p.pos.x * GALAXY_SCALE, 0, p.pos.y * GALAXY_SCALE);
    this.distance = Math.max(this.minDist, Math.min(this.distance, 12));
  }

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.surfaces, false);
    return hits.length ? (hits[0]!.object.userData.planetId as string) : null;
  }

  // --- input ---------------------------------------------------------------

  private attachInput(): void {
    let dragging = false;
    let mode: 'pan' | 'orbit' = 'pan';
    let px = 0, py = 0;
    let moved = 0;

    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = 0;
      mode = e.button === 2 || e.shiftKey ? 'orbit' : 'pan';
      px = e.clientX;
      py = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });
    let lastHoverCheck = 0;
    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) {
        const now = performance.now();
        if (now - lastHoverCheck > 70) {
          lastHoverCheck = now;
          const id = this.pick(e.clientX, e.clientY);
          this.setHovered(id);
        }
        return;
      }
      const dx = e.clientX - px;
      const dy = e.clientY - py;
      px = e.clientX;
      py = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (mode === 'orbit') {
        this.yaw -= dx * 0.005;
        this.pitch = Math.max(0.35, Math.min(1.45, this.pitch - dy * 0.004));
      } else {
        // Camera follows the drag: mouse right → camera right (map slides left).
        const k = this.distance * 0.0016;
        const cos = Math.cos(this.yaw);
        const sin = Math.sin(this.yaw);
        this.target.x += (dx * cos - dy * sin) * k;
        this.target.z += (dx * sin + dy * cos) * k;
        this.clampTarget();
      }
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (moved < 5) {
        const id = this.pick(e.clientX, e.clientY);
        bus.emit('planetSelected', { id });
      }
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', () => (dragging = false));
    this.canvas.addEventListener('dblclick', (e) => {
      const id = this.pick(e.clientX, e.clientY);
      if (id) this.focusOn(id);
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(e.deltaY * 0.0012);
      this.distance = Math.max(this.minDist, Math.min(this.maxDist, this.distance * f));
    }, { passive: false });
  }

  private clampTarget(): void {
    const r = this.radiusWorld * 1.1;
    const len = Math.hypot(this.target.x, this.target.z);
    if (len > r) {
      this.target.x *= r / len;
      this.target.z *= r / len;
    }
  }

  // --- frame loop ----------------------------------------------------------

  private updateCamera(): void {
    const h = Math.cos(this.pitch) * this.distance;
    const y = Math.sin(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * h,
      this.target.y + y,
      this.target.z + Math.cos(this.yaw) * h
    );
    this.camera.lookAt(this.target);
  }

  render(): void {
    const dt = this.clock.getDelta();
    const t = this.clock.elapsedTime;
    for (const vis of this.planets.values()) vis.update(t, dt);
    this.fleets.update(this.state, dt);
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
