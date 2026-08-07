import * as THREE from 'three';
import type { GameState } from '../game/state';
import { FACTIONS } from '../data/factions';
import { bus } from '../core/emitter';
import { createPlanetVisual, type PlanetVisual } from './planetMesh';
import { createComets, createFactionNebulae, createNebulaDisc, createStarfield, type CometLayer } from './starfield';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FleetLayer } from './fleets';
import { emblemSprite } from './emblems';
import { reconActive } from '../game/specops';
import type { FactionId } from '../core/types';

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

  // Постобработка: мягкое свечение ярких элементов (bloom).
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private comets!: CometLayer;

  // Пульс захвата: расходящееся кольцо цвета нового владельца.
  private prevOwners = new Map<string, FactionId>();
  private pulses: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number }[] = [];

  constructor(private canvas: HTMLCanvasElement, private state: GameState) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setClearColor(0x05070f, 1);
    // Кинематографичный тон-маппинг — сочнее свет и глубже тени.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 2000);
    this.radiusWorld = state.galaxy.radiusMax * GALAXY_SCALE;
    this.fleets = new FleetLayer(GALAXY_SCALE);

    this.buildBackground();
    this.buildSectors();
    this.buildSupplyLines();
    this.buildPlanets();
    this.buildHomeworldMarkers();
    this.scene.add(this.fleets.group);

    // Стартовая карта владений — чтобы первый refreshOwners не дал ложных пульсов.
    for (const id of state.galaxy.order) {
      this.prevOwners.set(id, state.galaxy.planets.get(id)!.owner);
    }

    // Композер: обычный проход + едва заметный bloom только для по-настоящему
    // ярких точек (лава, выстрелы). Порог поднят — карта не «плывёт» в неоне.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.5, 0.9);
    this.composer.addPass(this.bloom);

    this.resize();
    this.attachInput();
    window.addEventListener('resize', () => this.resize());
  }

  // --- construction --------------------------------------------------------

  private buildBackground(): void {
    this.scene.add(createStarfield(3200, this.radiusWorld * 16));
    this.scene.add(createNebulaDisc(this.radiusWorld));
    // Живой фон: цветные туманности у границ фракций и редкие кометы.
    this.scene.add(createFactionNebulae(this.radiusWorld));
    this.comets = createComets(this.radiusWorld);
    this.scene.add(this.comets.group);
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
      opacity: 0.24,
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

  /** Эмблемы родных миров фракций, парящие над их планетами. */
  private homeMarkers: { sprite: THREE.Sprite; baseY: number; phase: number }[] = [];
  private fedMarkerPlaced = false;

  private addHomeMarker(planetId: string, faction: FactionId): void {
    const p = this.state.galaxy.planets.get(planetId);
    if (!p) return;
    const sprite = emblemSprite(faction);
    const baseY = 0.42 * p.scale + 0.62;
    sprite.position.set(p.pos.x * GALAXY_SCALE, baseY, p.pos.y * GALAXY_SCALE);
    this.scene.add(sprite);
    this.homeMarkers.push({ sprite, baseY, phase: Math.random() * Math.PI * 2 });
  }

  private buildHomeworldMarkers(): void {
    // Родные миры: Супер-Земля, Киберстан, Святилище Скв'бай, Кеплер Прайм.
    for (const id of this.state.galaxy.order) {
      const p = this.state.galaxy.planets.get(id)!;
      if (p.id === 'p_super_earth') this.addHomeMarker(id, 'superEarth');
      else if (p.name === 'Киберстан') this.addHomeMarker(id, 'automatons');
      else if (p.name === "Святилище Скв'бай") this.addHomeMarker(id, 'illuminate');
      else if (p.name === 'Кеплер Прайм') this.addHomeMarker(id, 'terminids');
    }
  }

  /** Re-colour supply lines by the owner of their endpoints. */
  private refreshSupplyColors(): void {
    const arr = this.supplyColors.array as Float32Array;
    this.state.galaxy.lines.forEach((ln, li) => {
      const pa = this.state.galaxy.planets.get(ln.a)!;
      const pb = this.state.galaxy.planets.get(ln.b)!;
      const dim = pa.abyss || pb.abyss || pa.shattered || pb.shattered ? 0.12 : 1;
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
      const alive = sector.planets.map((pid) => this.state.galaxy.planets.get(pid)!).filter((p) => !p.shattered);
      const owners = new Set(alive.map((p) => p.owner));
      if (owners.size === 1 && alive.length > 0) {
        const color = FACTIONS[[...owners][0]!].color;
        vis.fillMat.color.set(color);
        vis.fillMat.opacity = 0.05;
        vis.borderMat.color.set(color);
        vis.borderMat.opacity = 0.38;
      } else {
        vis.fillMat.color.copy(NEUTRAL_SECTOR);
        vis.fillMat.opacity = 0.02;
        vis.borderMat.color.copy(NEUTRAL_SECTOR);
        vis.borderMat.opacity = 0.15;
      }
    }
  }

  refreshOwners(): void {
    // Эмблема Супер-Федерации появляется вместе с Новым Конкордом.
    if (this.state.superFederationRisen && !this.fedMarkerPlaced) {
      const cap = this.state.galaxy.order
        .map((id) => this.state.galaxy.planets.get(id)!)
        .find((p) => p.name === 'Новый Конкорд');
      if (cap) {
        this.addHomeMarker(cap.id, 'superFederation');
        this.fedMarkerPlaced = true;
      }
    }
    for (const id of this.state.galaxy.order) {
      const p = this.state.galaxy.planets.get(id)!;
      const vis = this.planets.get(id);
      if (!vis) continue;
      vis.setOwner(FACTIONS[p.owner].color);
      vis.setGloom(p.gloom);
      vis.setAbyss(p.abyss);
      vis.setShattered(p.shattered);
      // Погода войны: пожары на сражающихся мирах, осаждённые меркнут.
      vis.setBattle(!!p.battle && !p.gloom && !p.abyss && !p.shattered);
      vis.setDim(p.supplied ? 1 : 0.72);
      vis.setScar(!!p.scarred);
      vis.setWreckage(p.wreckage ?? 0);
      vis.setShield(p.buildings.includes('shieldGen'), !!p.battle);
      vis.setStation(p.buildings.includes('orbStation'));
      // Смена владельца → расходящийся пульс цвета нового хозяина.
      const prev = this.prevOwners.get(id);
      if (prev !== undefined && prev !== p.owner && !p.abyss && !p.shattered) {
        this.spawnCapturePulse(p.pos.x * GALAXY_SCALE, p.pos.y * GALAXY_SCALE, FACTIONS[p.owner].color);
      }
      this.prevOwners.set(id, p.owner);
    }
    this.refreshSupplyColors();
    this.refreshSectors();
  }

  private spawnCapturePulse(x: number, z: number, hex: string): void {
    const geo = new THREE.RingGeometry(0.86, 1.0, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.05, z);
    mesh.scale.setScalar(0.2);
    this.scene.add(mesh);
    this.pulses.push({ mesh, mat, life: 0 });
  }

  private updatePulses(dt: number): void {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i]!;
      p.life += dt;
      const k = p.life / 2.2; // полный цикл ~2.2 с
      p.mesh.scale.setScalar(0.2 + k * 2.4);
      p.mat.opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mat.dispose();
        this.pulses.splice(i, 1);
      }
    }
  }

  // --- selection -----------------------------------------------------------

  private selectedId: string | null = null;
  private boxSelected = new Set<string>();

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.refreshSelection();
  }

  /** Групповое выделение планет рамкой (подсветка колец). */
  setBoxSelected(ids: Iterable<string>): void {
    this.boxSelected = new Set(ids);
    this.refreshSelection();
  }

  private refreshSelection(): void {
    for (const [pid, vis] of this.planets) {
      vis.setSelected(pid === this.selectedId || this.boxSelected.has(pid));
    }
  }

  /** Планеты, чьи центры попадают в экранный прямоугольник (px). */
  planetsInRect(x0: number, y0: number, x1: number, y1: number): string[] {
    const rect = this.canvas.getBoundingClientRect();
    const [minX, maxX] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [minY, maxY] = y0 < y1 ? [y0, y1] : [y1, y0];
    const out: string[] = [];
    const v = new THREE.Vector3();
    for (const id of this.state.galaxy.order) {
      const p = this.state.galaxy.planets.get(id)!;
      if (p.abyss || p.shattered) continue;
      v.set(p.pos.x * GALAXY_SCALE, 0, p.pos.y * GALAXY_SCALE).project(this.camera);
      if (v.z > 1) continue; // за камерой
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) out.push(id);
    }
    return out;
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

  // --- Кинокамера: подлёт к планете с боем и медленный автооблёт -----------

  private cinemaPlanet: string | null = null;

  /** Включить киносопровождение боя на планете (любой ввод отключает). */
  startCinema(id: string): void {
    if (!this.state.galaxy.planets.get(id)) return;
    this.cinemaPlanet = id;
  }

  stopCinema(): void {
    this.cinemaPlanet = null;
  }

  get cinemaActive(): boolean {
    return this.cinemaPlanet !== null;
  }

  /** Тумблер bloom-постобработки (настройки → эффекты). */
  setBloomEnabled(on: boolean): void {
    this.bloom.enabled = on;
  }

  private updateCinema(dt: number): void {
    if (!this.cinemaPlanet) return;
    const p = this.state.galaxy.planets.get(this.cinemaPlanet);
    if (!p || p.shattered || p.abyss) { this.cinemaPlanet = null; return; }
    const tx = p.pos.x * GALAXY_SCALE, tz = p.pos.y * GALAXY_SCALE;
    // Плавный подлёт: цель и дистанция стягиваются к планете, камера кружит.
    const k = Math.min(1, dt * 2.2);
    this.target.x += (tx - this.target.x) * k;
    this.target.z += (tz - this.target.z) * k;
    this.distance += (5.2 - this.distance) * Math.min(1, dt * 1.6);
    this.pitch += (0.68 - this.pitch) * Math.min(1, dt * 1.2);
    this.yaw += dt * 0.14;
  }

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.surfaces, false);
    if (!hits.length) return null;
    const id = hits[0]!.object.userData.planetId as string;
    // Миры в Бездне невидимы и недоступны для выбора.
    if (this.state.galaxy.planets.get(id)?.abyss) return null;
    return id;
  }

  // --- input ---------------------------------------------------------------

  /** Зажатые клавиши WASD (по e.code — не зависит от раскладки). */
  private keys = new Set<string>();
  private boxEl: HTMLDivElement | null = null;

  private attachInput(): void {
    let dragging = false;
    let mode: 'box' | 'orbit' = 'box';
    let startX = 0, startY = 0;
    let px = 0, py = 0;
    let moved = 0;

    // WASD — перемещение карты.
    window.addEventListener('keydown', (e) => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
        this.keys.add(e.code);
        this.stopCinema();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // Белая рамка выделения.
    const ensureBox = (): HTMLDivElement => {
      if (!this.boxEl) {
        this.boxEl = document.createElement('div');
        this.boxEl.id = 'select-box';
        document.body.appendChild(this.boxEl);
      }
      return this.boxEl;
    };
    const hideBox = () => { if (this.boxEl) this.boxEl.style.display = 'none'; };

    this.canvas.addEventListener('pointerdown', (e) => {
      this.stopCinema();
      dragging = true;
      moved = 0;
      mode = e.button === 2 ? 'orbit' : 'box';
      startX = px = e.clientX;
      startY = py = e.clientY;
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
      } else if (moved >= 6) {
        // ЛКМ-перетаскивание рисует белую рамку выделения.
        const box = ensureBox();
        const x = Math.min(startX, px), y = Math.min(startY, py);
        box.style.display = 'block';
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        box.style.width = `${Math.abs(px - startX)}px`;
        box.style.height = `${Math.abs(py - startY)}px`;
      }
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      hideBox();
      if (moved < 5) {
        // Клик без перетаскивания.
        const id = this.pick(e.clientX, e.clientY);
        if (e.button === 2) {
          if (id) bus.emit('planetRightClicked', { id, queue: e.shiftKey });
        } else {
          bus.emit('planetSelected', { id });
        }
        return;
      }
      if (mode === 'box') {
        const ids = this.planetsInRect(startX, startY, e.clientX, e.clientY);
        bus.emit('planetsBoxSelected', { ids });
      }
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', () => { dragging = false; hideBox(); });
    this.canvas.addEventListener('dblclick', (e) => {
      const id = this.pick(e.clientX, e.clientY);
      if (id) this.focusOn(id);
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.stopCinema();
      const f = Math.exp(e.deltaY * 0.0012);
      this.distance = Math.max(this.minDist, Math.min(this.maxDist, this.distance * f));
    }, { passive: false });
  }

  /** Сдвиг камеры от WASD; вызывается каждый кадр. */
  private applyKeyPan(dt: number): void {
    if (this.keys.size === 0) return;
    let fx = 0, fy = 0; // экранные оси: fy>0 — вверх экрана, fx>0 — вправо
    if (this.keys.has('KeyW')) fy += 1;
    if (this.keys.has('KeyS')) fy -= 1;
    if (this.keys.has('KeyD')) fx += 1;
    if (this.keys.has('KeyA')) fx -= 1;
    if (!fx && !fy) return;
    // dt зажат: при просадке кадров карта не должна прыгать к краю.
    const spd = this.distance * 0.55 * Math.min(dt, 0.05);
    // Оси строго ОТ ЭКРАНА при любом повороте камеры: камера стоит в
    // target + (sin(yaw)·h, y, cos(yaw)·h) и смотрит на target, поэтому
    // «вверх экрана» на плоскости = (−sin, −cos), «вправо» = (cos, −sin).
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    this.target.x += (fx * cos - fy * sin) * spd;
    this.target.z += (-fx * sin - fy * cos) * spd;
    this.clampTarget();
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

  // --- Стрелки заготовленных атак: «эскалатор» вдоль линии снабжения ---

  private arrowGroup: THREE.Group | null = null;
  private arrowSig = '';
  private arrowRuns: { from: THREE.Vector3; to: THREE.Vector3; meshes: THREE.Mesh[] }[] = [];
  private static arrowGeo = new THREE.ConeGeometry(0.085, 0.24, 4);

  /** Все линии атак: планы игрока + видимые вражеские вторжения (с плацдармов). */
  private collectArrowRuns(): { from: string; to: string; color: string }[] {
    const runs: { from: string; to: string; color: string }[] = [];
    const playerColor = FACTIONS[this.state.player].color;
    for (const p of this.state.attackPlans) runs.push({ from: p.from, to: p.to, color: playerColor });
    // Вражеские вторжения: у планеты с битвой видно, С КАКОГО плацдарма бьют.
    const seen = new Set<string>(runs.map((r) => `${r.from}>${r.to}`));
    const viewer = this.state.player;
    const revealAll = this.state.playerDefeated || !!this.state.winner;
    for (const id of this.state.galaxy.order) {
      const p = this.state.galaxy.planets.get(id)!;
      if (!p.battle) continue;
      // Туман войны: чужие линии атак видны на СВОИХ планетах, в разведанных
      // секторах (и наблюдателю после поражения).
      if (!revealAll && p.owner !== viewer && p.battle.attacker !== viewer &&
          !reconActive(this.state, p.sector)) continue;
      for (const fid of this.state.fleetOrder) {
        const f = this.state.fleets.get(fid);
        if (!f || f.transit || f.at !== id || !f.origin) continue;
        if (f.faction !== p.battle.attacker) continue;
        const o = this.state.galaxy.planets.get(f.origin);
        if (!o || !p.links.includes(o.id)) continue;
        const key = `${f.origin}>${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        runs.push({ from: f.origin, to: id, color: FACTIONS[f.faction].color });
      }
    }
    return runs;
  }

  private syncAttackArrows(): void {
    const runsData = this.collectArrowRuns();
    const sig = runsData.map((r) => `${r.from}>${r.to}:${r.color}`).join('|');
    if (sig === this.arrowSig) return;
    this.arrowSig = sig;
    if (this.arrowGroup) {
      this.scene.remove(this.arrowGroup);
      this.arrowGroup.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
      });
    }
    this.arrowRuns = [];
    this.arrowGroup = new THREE.Group();
    for (const plan of runsData) {
      const a = this.state.galaxy.planets.get(plan.from);
      const b = this.state.galaxy.planets.get(plan.to);
      if (!a || !b) continue;
      const from = new THREE.Vector3(a.pos.x * GALAXY_SCALE, 0.1, a.pos.y * GALAXY_SCALE);
      const to = new THREE.Vector3(b.pos.x * GALAXY_SCALE, 0.1, b.pos.y * GALAXY_SCALE);
      const dir = to.clone().sub(from);
      const len = dir.length();
      dir.normalize();
      const n = Math.max(4, Math.floor(len / 0.42));
      const meshes: THREE.Mesh[] = [];
      // Стрелки атаки — в заглавном цвете атакующей фракции.
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(plan.color),
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(GalaxyScene.arrowGeo, mat);
        // остриё конуса (+Y) разворачиваем по направлению атаки
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        this.arrowGroup.add(m);
        meshes.push(m);
      }
      this.arrowRuns.push({ from, to, meshes });
    }
    this.scene.add(this.arrowGroup);
  }

  private animateAttackArrows(t: number): void {
    for (const run of this.arrowRuns) {
      const n = run.meshes.length;
      const shift = (t * 0.22) % (1 / n);
      run.meshes.forEach((m, i) => {
        const k = (i / n + shift) % 1;
        // не наезжаем на сами планеты — небольшой отступ с обеих сторон
        const kk = 0.08 + k * 0.84;
        m.position.lerpVectors(run.from, run.to, kk);
      });
    }
  }

  // --- Маршрут выбранного флота: пунктир через цель и очередь приказов -----

  private routeLine: THREE.Line | null = null;
  private routeSig = '';

  private syncRoute(): void {
    const s = this.state;
    const f = s.selectedFleet ? s.fleets.get(s.selectedFleet) : null;
    // Точки маршрута: текущая цель перелёта + все цели очереди.
    const stops: string[] = [];
    if (f) {
      if (f.transit) stops.push(f.transit.to);
      for (const q of f.orderQueue ?? []) stops.push(q.target);
    }
    const sig = f && stops.length ? `${f.id}:${f.at}:${stops.join('>')}` : '';
    if (sig === this.routeSig) return;
    this.routeSig = sig;
    if (this.routeLine) {
      this.scene.remove(this.routeLine);
      this.routeLine.geometry.dispose();
      (this.routeLine.material as THREE.Material).dispose();
      this.routeLine = null;
    }
    if (!f || !stops.length) return;
    const pts: THREE.Vector3[] = [];
    const start = this.state.galaxy.planets.get(f.transit ? f.transit.from : f.at);
    if (start) pts.push(new THREE.Vector3(start.pos.x * GALAXY_SCALE, 0.14, start.pos.y * GALAXY_SCALE));
    for (const pid of stops) {
      const p = this.state.galaxy.planets.get(pid);
      if (p) pts.push(new THREE.Vector3(p.pos.x * GALAXY_SCALE, 0.14, p.pos.y * GALAXY_SCALE));
    }
    if (pts.length < 2) return;
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineDashedMaterial({
      color: new THREE.Color(FACTIONS[f.faction].color),
      transparent: true,
      opacity: 0.75,
      dashSize: 0.22,
      gapSize: 0.16,
      depthWrite: false,
    });
    this.routeLine = new THREE.Line(geo, mat);
    this.routeLine.computeLineDistances();
    this.scene.add(this.routeLine);
  }

  private lodOct = 5;

  render(): void {
    const dt = this.clock.getDelta();
    const t = this.clock.elapsedTime;
    // LOD шейдера планет: издали хватает трёх октав шума вместо пяти.
    const wantOct = this.distance > 24 ? 3 : 5;
    if (wantOct !== this.lodOct) {
      this.lodOct = wantOct;
      for (const vis of this.planets.values()) vis.setLod(wantOct);
    }
    for (const vis of this.planets.values()) vis.update(t, dt);
    for (const m of this.homeMarkers) {
      m.sprite.position.y = m.baseY + Math.sin(t * 1.1 + m.phase) * 0.05;
    }
    this.fleets.update(this.state, dt);
    this.syncAttackArrows();
    this.animateAttackArrows(t);
    this.syncRoute();
    this.comets.update(t);
    this.updatePulses(dt);
    this.applyKeyPan(dt);
    this.updateCinema(dt);
    this.updateCamera();
    this.composer.render();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
