import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateLineSystem, CreateDashedLines, CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Constants } from '@babylonjs/core/Engines/constants';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import '@babylonjs/core/Culling/ray';

import type { GameState } from '../game/state';
import { factionColor } from '../data/factions';
import { bus } from '../core/emitter';
import { createPlanetVisual, type PlanetVisual } from './planetMesh';
import { createNebulaDisc, createNebulaField, createStarfield, type Starfield } from './starfield';
import { FleetLayer } from './fleets';
import { emblemSprite } from './emblems';
import { reconActive } from '../game/specops';
import { QUALITY_PRESETS, type Quality } from '../ui/settings';
import type { Hotkeys } from '../ui/hotkeys';
import type { FactionId } from '../core/types';
import { createEngine, hexColor, SUN_DIR } from './engine';

export const GALAXY_SCALE = 0.03;

/** Звёзды строятся один раз по максимуму; пресеты рисуют часть из них. */
const STAR_MAX = 3200;

const NEUTRAL_SECTOR = new Color3(0.2, 0.255, 0.369); // #33415e

interface SectorVisual {
  fill: Mesh;
  fillMat: StandardMaterial;
  border: LinesMesh;
}

export class GalaxyScene {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: UniversalCamera;

  private planets = new Map<string, PlanetVisual>();
  private fleets: FleetLayer;
  private supplyLines!: LinesMesh;
  private sectorVisuals = new Map<string, SectorVisual>();
  /** Фракция, подсвеченная на карте (окно фракции открыто). */
  private spotlight: FactionId | null = null;

  // camera controller
  private target = new Vector3(0, 0, 0);
  private distance = 26;
  private yaw = 0;
  private pitch = 0.95;
  private readonly minDist = 3.5;
  private readonly maxDist = 62;

  private elapsed = 0;
  /** Отметка предыдущего кадра для собственного счёта времени. */
  private last = 0;
  private radiusWorld: number;

  // Постобработка: свечение ярких элементов, сглаживание, виньетка.
  private pipeline!: DefaultRenderingPipeline;
  private glow!: GlowLayer;
  private stars!: Starfield;
  private nebulae!: TransformNode;
  /** Текущий пресет качества — bloom-тумблер не должен его затирать. */
  private quality: Quality = 'high';
  private bloomOn = true;

  // Пульс захвата: расходящееся кольцо цвета нового владельца.
  private prevOwners = new Map<string, FactionId>();
  private pulses: { mesh: Mesh; mat: StandardMaterial; life: number }[] = [];

  constructor(private canvas: HTMLCanvasElement, private state: GameState) {
    const host = createEngine(canvas);
    this.engine = host.engine;
    this.scene = host.scene;

    // Камера ведётся вручную по yaw/pitch/distance: ArcRotateCamera считает
    // свои углы в собственной системе, а вся карта и панорама с клавиатуры уже
    // выведены из этих трёх чисел. Проще держать формулу, чем переучивать её.
    this.camera = new UniversalCamera('cam', new Vector3(0, 26, 0), this.scene);
    this.camera.fov = (46 * Math.PI) / 180;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 2000;
    this.scene.activeCamera = this.camera;

    this.radiusWorld = state.galaxy.radiusMax * GALAXY_SCALE;
    this.fleets = new FleetLayer(this.scene, GALAXY_SCALE);

    this.buildBackground();
    this.buildSectors();
    this.buildSupplyLines();
    this.buildPlanets();
    this.buildHomeworldMarkers();

    // Стартовая карта владений — чтобы первый refreshOwners не дал ложных пульсов.
    for (const id of state.galaxy.order) {
      this.prevOwners.set(id, state.galaxy.planets.get(id)!.owner);
    }

    this.buildPost();
    this.attachInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // --- Постобработка ---------------------------------------------------------

  private buildPost(): void {
    // Слой свечения — то, чего в прежнем рендере не было вовсе.
    //
    // Раньше единственным источником сияния был общий bloom на весь кадр, и
    // порог у него приходилось держать высоко: иначе свечение цеплялось за
    // облака и ледяные шапки двух сотен планет разом и затягивало карту ровной
    // светлой дымкой. Слой свечения работает иначе — он собирает ТОЛЬКО
    // самосветящиеся материалы, поэтому ходовые огни кораблей, кольца
    // выделения, опознавательные метки и трассеры светятся по-настоящему, а
    // поверхность миров не участвует и дымки не даёт.
    this.glow = new GlowLayer('glow', this.scene, { blurKernelSize: 40, mainTextureFixedSize: 512 });
    this.glow.intensity = 0.85;

    this.pipeline = new DefaultRenderingPipeline('post', true, this.scene, [this.camera]);
    this.pipeline.samples = QUALITY_PRESETS[this.quality].samples;
    // Сглаживание кадра идёт вместе с остальным сглаживанием: на низком
    // пресете, где сэмплов нет вовсе, лишний полноэкранный проход не нужен.
    this.pipeline.fxaaEnabled = QUALITY_PRESETS[this.quality].samples > 0;
    this.pipeline.bloomEnabled = true;
    this.pipeline.bloomThreshold = 0.62;
    this.pipeline.bloomWeight = QUALITY_PRESETS[this.quality].bloomStrength;
    this.pipeline.bloomKernel = 48;
    this.pipeline.bloomScale = 0.5;

    // Кинематографичный тон-маппинг — сочнее свет и глубже тени. Экспозиция
    // ниже единицы: с ней светлые миры перестают выбивать в белое, а тени на
    // кораблях и станциях получают глубину.
    const ip = this.pipeline.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 0.98;
    ip.contrast = 1.06;
    // Виньетка стала настоящей, а не CSS-накладкой поверх canvas: она считается
    // до тон-маппинга и поэтому темнит края кадра, а не мажет их серым.
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 2.2;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
  }

  // --- construction --------------------------------------------------------

  private buildBackground(): void {
    // Звёзды строятся сразу по максимуму: пресеты качества не пересобирают
    // геометрию, а просто рисуют меньше точек.
    this.stars = createStarfield(this.scene, STAR_MAX, this.radiusWorld * 16);
    createNebulaDisc(this.scene, this.radiusWorld);
    // Туманности — дальний фон: висят в девяти радиусах карты и рисуются
    // раньше всего, поэтому не лезут к планетам даже на подлёте к краю.
    this.nebulae = createNebulaField(this.scene, this.radiusWorld);

    // Свет карты мягкий и объёмный: вместо плоской подсветки — полусферный
    // источник (холодное небо сверху, тёплый отсвет галактического диска
    // снизу), ключ приглушён и слегка тёплый, плюс холодная подсветка сзади,
    // чтобы корпуса кораблей не тонули в чёрном силуэте.
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene);
    hemi.diffuse = new Color3(0.50, 0.59, 0.72);
    hemi.groundColor = new Color3(0.14, 0.12, 0.10);
    hemi.intensity = 0.34;
    // Ключ стоит ровно там, где светит солнце шейдера планет: корабль и мир
    // под ним обязаны быть освещены с одной стороны, иначе карта разваливается
    // на два несогласованных источника.
    const key = new DirectionalLight('key', SUN_DIR.scale(-1), this.scene);
    key.diffuse = new Color3(1, 0.95, 0.89);
    key.intensity = 1.05;
    const fill = new DirectionalLight('fill', new Vector3(7, -4, 6).normalize(), this.scene);
    fill.diffuse = new Color3(0.50, 0.60, 0.85);
    fill.intensity = 0.20;
  }

  /** Flat annulus-sector plates + borders under the planets, one per sector. */
  private buildSectors(): void {
    const s = GALAXY_SCALE;
    const GAP = 0.018; // radians shaved off each side for visual separation
    for (const sector of this.state.galaxy.sectors.values()) {
      const full = sector.a1 - sector.a0 > 6;
      const a0 = sector.a0 + (full ? 0 : GAP);
      const a1 = sector.a1 - (full ? 0 : GAP);
      const r0 = sector.r0 * s;
      const r1 = sector.r1 * s;

      // Плита сектора — кольцевой сегмент прямо в галактической плоскости XZ.
      const SEG = 28;
      const positions: number[] = [];
      const normals: number[] = [];
      const indices: number[] = [];
      const inner = Math.max(r0, 0.0001);
      const span = full ? Math.PI * 2 : a1 - a0;
      const start = full ? 0 : a0;
      for (let i = 0; i <= SEG; i++) {
        const a = start + (span * i) / SEG;
        const c = Math.cos(a), sn = Math.sin(a);
        // При сплошном круге внутренний радиус схлопывается в центр.
        const ri = r0 <= 0.001 ? 0 : inner;
        positions.push(c * ri, 0, sn * ri, c * r1, 0, sn * r1);
        normals.push(0, 1, 0, 0, 1, 0);
      }
      for (let i = 0; i < SEG; i++) {
        const b = i * 2;
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
      const vd = new VertexData();
      vd.positions = positions;
      vd.normals = normals;
      vd.indices = indices;
      const fill = new Mesh(`sector_${sector.id}`, this.scene);
      vd.applyToMesh(fill, false);
      const fillMat = new StandardMaterial(`sectorMat_${sector.id}`, this.scene);
      fillMat.emissiveColor = NEUTRAL_SECTOR;
      fillMat.diffuseColor = new Color3(0, 0, 0);
      fillMat.specularColor = new Color3(0, 0, 0);
      fillMat.disableLighting = true;
      fillMat.alpha = 0.03;
      fillMat.backFaceCulling = false;
      fillMat.disableDepthWrite = true;
      fill.material = fillMat;
      fill.position.y = -0.42;
      fill.isPickable = false;
      fill.alwaysSelectAsActiveMesh = true;

      // Border as an explicit line loop in world space.
      const pts: Vector3[] = [];
      const BSEG = 26;
      const y = -0.4;
      if (r0 <= 0.001) {
        for (let i = 0; i < BSEG * 2; i++) {
          const a = (Math.PI * 2 * i) / (BSEG * 2);
          pts.push(new Vector3(Math.cos(a) * r1, y, Math.sin(a) * r1));
        }
      } else {
        for (let i = 0; i <= BSEG; i++) {
          const a = a0 + ((a1 - a0) * i) / BSEG;
          pts.push(new Vector3(Math.cos(a) * r1, y, Math.sin(a) * r1));
        }
        for (let i = BSEG; i >= 0; i--) {
          const a = a0 + ((a1 - a0) * i) / BSEG;
          pts.push(new Vector3(Math.cos(a) * r0, y, Math.sin(a) * r0));
        }
      }
      pts.push(pts[0]!.clone()); // замкнуть контур
      const border = CreateLines(`sectorEdge_${sector.id}`, { points: pts }, this.scene);
      border.color = NEUTRAL_SECTOR;
      border.alpha = 0.22;
      border.isPickable = false;
      border.alwaysSelectAsActiveMesh = true;

      this.sectorVisuals.set(sector.id, { fill, fillMat, border });
    }
  }

  private buildSupplyLines(): void {
    const lines = this.state.galaxy.lines;
    const points: Vector3[][] = [];
    const colors: Color4[][] = [];
    for (const ln of lines) {
      const a = this.state.galaxy.planets.get(ln.a)!;
      const b = this.state.galaxy.planets.get(ln.b)!;
      points.push([
        new Vector3(a.pos.x * GALAXY_SCALE, 0, a.pos.y * GALAXY_SCALE),
        new Vector3(b.pos.x * GALAXY_SCALE, 0, b.pos.y * GALAXY_SCALE),
      ]);
      colors.push([new Color4(0.28, 0.28, 0.28, 1), new Color4(0.28, 0.28, 0.28, 1)]);
    }
    this.supplyLines = CreateLineSystem('supply', {
      lines: points, colors, updatable: true, useVertexAlpha: true,
    }, this.scene);
    this.supplyLines.alpha = 0.24;
    this.supplyLines.isPickable = false;
    this.supplyLines.alwaysSelectAsActiveMesh = true;
  }

  private buildPlanets(): void {
    for (const id of this.state.galaxy.order) {
      const p = this.state.galaxy.planets.get(id)!;
      const vis = createPlanetVisual(p, this.scene);
      vis.root.position.set(p.pos.x * GALAXY_SCALE, 0, p.pos.y * GALAXY_SCALE);
      this.planets.set(id, vis);
    }
    this.refreshOwners();
  }

  /** Эмблемы родных миров фракций, парящие над их планетами. */
  private homeMarkers: { node: Mesh; baseY: number; phase: number }[] = [];
  private fedMarkerPlaced = false;

  private addHomeMarker(planetId: string, faction: FactionId): void {
    const p = this.state.galaxy.planets.get(planetId);
    if (!p) return;
    const node = emblemSprite(faction, this.scene);
    const baseY = 0.42 * p.scale + 0.62;
    node.position.set(p.pos.x * GALAXY_SCALE, baseY, p.pos.y * GALAXY_SCALE);
    this.homeMarkers.push({ node, baseY, phase: Math.random() * Math.PI * 2 });
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
    const arr = this.supplyLines.getVerticesData('color');
    if (!arr) return;
    this.state.galaxy.lines.forEach((ln, li) => {
      const pa = this.state.galaxy.planets.get(ln.a)!;
      const pb = this.state.galaxy.planets.get(ln.b)!;
      const dim = pa.abyss || pb.abyss || pa.shattered || pb.shattered ? 0.12 : 1;
      const ca = hexColor(factionColor(pa.owner)).scale(dim);
      const cb = hexColor(factionColor(pb.owner)).scale(dim);
      const base = li * 8;
      arr[base] = ca.r * 0.5; arr[base + 1] = ca.g * 0.5; arr[base + 2] = ca.b * 0.5; arr[base + 3] = 1;
      arr[base + 4] = cb.r * 0.5; arr[base + 5] = cb.g * 0.5; arr[base + 6] = cb.b * 0.5; arr[base + 7] = 1;
    });
    this.supplyLines.updateVerticesData('color', arr);
  }

  /**
   * Подсветка одной фракции, как в HoI4: пока открыто её окно, сектора с её
   * мирами горят её цветом, вся остальная галактика уходит в тень. Ноль —
   * обычная карта.
   */
  setFactionSpotlight(faction: FactionId | null): void {
    if (this.spotlight === faction) return;
    this.spotlight = faction;
    this.refreshOwners();
  }

  /** A fully-conquered sector lights up in its owner's colour. */
  private refreshSectors(): void {
    for (const sector of this.state.galaxy.sectors.values()) {
      const vis = this.sectorVisuals.get(sector.id);
      if (!vis) continue;
      const alive = sector.planets.map((pid) => this.state.galaxy.planets.get(pid)!).filter((p) => !p.shattered);

      // Режим подсветки перебивает обычную раскраску: важно не «кто владеет
      // сектором целиком», а «где вообще стоит эта фракция».
      if (this.spotlight) {
        const held = alive.filter((p) => p.owner === this.spotlight).length;
        if (held > 0) {
          const color = hexColor(factionColor(this.spotlight));
          const share = held / Math.max(1, alive.length);
          vis.fillMat.emissiveColor = color;
          vis.fillMat.alpha = 0.09 + 0.15 * share;
          vis.border.color = color;
          vis.border.alpha = 0.30 + 0.35 * share;
        } else {
          vis.fillMat.emissiveColor = NEUTRAL_SECTOR;
          vis.fillMat.alpha = 0.004;
          vis.border.color = NEUTRAL_SECTOR;
          vis.border.alpha = 0.04;
        }
        continue;
      }

      const owners = new Set(alive.map((p) => p.owner));
      // Плиты секторов приглушены и затемнены. Их семьдесят с лишним, они
      // лежат сплошным ковром под всей картой, и на прежней яркости заливка
      // одного владельца превращала космос в ровный цветной пол — планеты на
      // нём теряли и тень, и глубину.
      if (owners.size === 1 && alive.length > 0) {
        // Полностью занятый сектор обязан читаться как ЧЬЯ-ТО территория —
        // цветом, а не догадкой по цвету планет внутри.
        const color = hexColor(factionColor([...owners][0]!));
        vis.fillMat.emissiveColor = color.scale(0.55);
        vis.fillMat.alpha = 0.055;
        vis.border.color = color;
        vis.border.alpha = 0.60;
      } else {
        vis.fillMat.emissiveColor = NEUTRAL_SECTOR;
        vis.fillMat.alpha = 0.020;
        vis.border.color = NEUTRAL_SECTOR;
        vis.border.alpha = 0.22;
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
      vis.setOwner(factionColor(p.owner));
      vis.setGloom(p.gloom);
      vis.setAbyss(p.abyss);
      vis.setShattered(p.shattered);
      // Погода войны: пожары на сражающихся мирах, осаждённые меркнут.
      vis.setBattle(!!p.battle && !p.gloom && !p.abyss && !p.shattered);
      // Подсветка фракции гасит чужие миры, оставляя её собственные в цвете.
      const spotDim = this.spotlight ? (p.owner === this.spotlight ? 1 : 0.30) : 1;
      vis.setDim((p.supplied ? 1 : 0.72) * spotDim);
      vis.setScar(!!p.scarred);
      vis.setWreckage(p.wreckage ?? 0);
      vis.setShield(p.buildings.includes('shieldGen'), !!p.battle);
      vis.setStation(p.buildings.includes('orbStation'));
      // Смена владельца → расходящийся пульс цвета нового хозяина.
      const prev = this.prevOwners.get(id);
      if (prev !== undefined && prev !== p.owner && !p.abyss && !p.shattered) {
        this.spawnCapturePulse(p.pos.x * GALAXY_SCALE, p.pos.y * GALAXY_SCALE, factionColor(p.owner));
      }
      this.prevOwners.set(id, p.owner);
    }
    this.refreshSupplyColors();
    this.refreshSectors();
  }

  private spawnCapturePulse(x: number, z: number, hex: string): void {
    // Кольцо в плоскости карты: тонкий диск между двумя радиусами.
    const SEG = 48;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (Math.PI * 2 * i) / SEG;
      const c = Math.cos(a), s = Math.sin(a);
      positions.push(c * 0.86, 0, s * 0.86, c * 1.0, 0, s * 1.0);
      normals.push(0, 1, 0, 0, 1, 0);
    }
    for (let i = 0; i < SEG; i++) {
      const b = i * 2;
      indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.indices = indices;
    const mesh = new Mesh('pulse', this.scene);
    vd.applyToMesh(mesh, false);
    const mat = new StandardMaterial('pulseMat', this.scene);
    mat.emissiveColor = hexColor(hex);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.alpha = 0.9;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.disableDepthWrite = true;
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.position.set(x, 0.05, z);
    mesh.scaling.setAll(0.2);
    mesh.isPickable = false;
    this.pulses.push({ mesh, mat, life: 0 });
  }

  private updatePulses(dt: number): void {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i]!;
      p.life += dt;
      const k = p.life / 2.2; // полный цикл ~2.2 с
      p.mesh.scaling.setAll(0.2 + k * 2.4);
      p.mat.alpha = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) {
        p.mesh.dispose(false, true);
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

  /** Подключить общий диспетчер клавиш (панорама, поворот, зум). */
  attachHotkeys(hk: Hotkeys): void {
    this.hotkeys = hk;
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
    const view = this.camera.getViewMatrix();
    const proj = this.camera.getProjectionMatrix();
    const vp = view.multiply(proj);
    const tmp = new Vector3();
    for (const id of this.state.galaxy.order) {
      const p = this.state.galaxy.planets.get(id)!;
      if (p.abyss || p.shattered) continue;
      tmp.set(p.pos.x * GALAXY_SCALE, 0, p.pos.y * GALAXY_SCALE);
      const clip = Vector3.TransformCoordinates(tmp, vp);
      // За камерой: в правосторонней сцене такие точки уходят за дальнюю
      // плоскость и в кадр попасть не могут.
      if (clip.z > 1 || clip.z < -1) continue;
      const sx = rect.left + ((clip.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - clip.y) / 2) * rect.height;
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

  /** Тумблер bloom-постобработки (настройки → изображение). */
  setBloomEnabled(on: boolean): void {
    this.bloomOn = on;
    // На низком пресете свечения нет вовсе — тумблер тогда ничего не включает.
    const want = on && QUALITY_PRESETS[this.quality].bloomStrength > 0;
    this.pipeline.bloomEnabled = want;
    this.glow.intensity = want ? 0.85 : 0;
  }

  /**
   * Пресет качества: плотность пикселей, число звёзд, туманности и свечение.
   * Плотность ограничена сверху ещё и возможностями экрана — на обычном
   * мониторе «высокое» не станет рисовать вчетверо больше пикселей впустую.
   */
  setQuality(q: Quality): void {
    this.quality = q;
    const p = QUALITY_PRESETS[q];
    this.engine.setHardwareScalingLevel(1 / Math.min(p.pixelRatio, window.devicePixelRatio));
    this.stars.setCount(Math.min(STAR_MAX, p.stars));
    this.nebulae.setEnabled(p.nebulae);
    this.pipeline.bloomWeight = p.bloomStrength;
    this.pipeline.samples = p.samples;
    this.pipeline.fxaaEnabled = p.samples > 0;
    this.setBloomEnabled(this.bloomOn);
    // Смена пресета сразу меняет и потолок детализации поверхностей.
    this.lodOct = -1;
    this.resize();
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
    const hit = this.scene.pick(clientX - rect.left, clientY - rect.top,
      (m) => m.isPickable && !!(m.metadata as { planetId?: string } | null)?.planetId);
    const id = (hit?.pickedMesh?.metadata as { planetId?: string } | undefined)?.planetId;
    if (!id) return null;
    // Миры в Бездне невидимы и недоступны для выбора.
    if (this.state.galaxy.planets.get(id)?.abyss) return null;
    return id;
  }

  // --- input ---------------------------------------------------------------

  /** Диспетчер горячих клавиш; ставится интерфейсом сразу после запуска. */
  private hotkeys: Hotkeys | null = null;
  private boxEl: HTMLDivElement | null = null;

  private attachInput(): void {
    let dragging = false;
    let mode: 'box' | 'orbit' = 'box';
    let startX = 0, startY = 0;
    let px = 0, py = 0;
    let moved = 0;

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

  /**
   * Движение камеры с клавиатуры; вызывается каждый кадр.
   *
   * Клавиши берутся из общего диспетчера, а не из своего набора кодов: так
   * панорама, поворот и зум переназначаются вместе со всем остальным и не
   * ломаются на нелатинской раскладке.
   */
  private applyKeyPan(dt: number): void {
    const hk = this.hotkeys;
    if (!hk) return;
    const step = Math.min(dt, 0.05);

    // Поворот и зум — независимо от панорамы, их можно совмещать.
    if (hk.held('rotateLeft')) this.yaw -= step * 1.6;
    if (hk.held('rotateRight')) this.yaw += step * 1.6;
    if (hk.held('zoomIn')) this.distance = Math.max(this.minDist, this.distance - step * this.distance * 1.8);
    if (hk.held('zoomOut')) this.distance = Math.min(this.maxDist, this.distance + step * this.distance * 1.8);

    let fx = 0, fy = 0; // экранные оси: fy>0 — вверх экрана, fx>0 — вправо
    if (hk.held('panUp')) fy += 1;
    if (hk.held('panDown')) fy -= 1;
    if (hk.held('panRight')) fx += 1;
    if (hk.held('panLeft')) fx -= 1;
    // Любое ручное движение прерывает кинокамеру: игрок забрал управление.
    if (fx || fy || hk.anyHeld(['rotateLeft', 'rotateRight', 'zoomIn', 'zoomOut'])) this.stopCinema();
    if (!fx && !fy) return;
    // dt зажат: при просадке кадров карта не должна прыгать к краю.
    const spd = this.distance * 0.55 * step;
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
    this.camera.setTarget(this.target);
  }

  // --- Стрелки заготовленных атак: «эскалатор» вдоль линии снабжения ---

  private arrowRoot: TransformNode | null = null;
  private arrowSig = '';
  private arrowRuns: { from: Vector3; to: Vector3; mesh: Mesh; n: number }[] = [];

  /** Все линии атак: планы игрока + видимые вражеские вторжения (с плацдармов). */
  private collectArrowRuns(): { from: string; to: string; color: string }[] {
    const runs: { from: string; to: string; color: string }[] = [];
    const playerColor = factionColor(this.state.player);
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
        runs.push({ from: f.origin, to: id, color: factionColor(f.faction) });
      }
    }
    return runs;
  }

  private syncAttackArrows(): void {
    const runsData = this.collectArrowRuns();
    const sig = runsData.map((r) => `${r.from}>${r.to}:${r.color}`).join('|');
    if (sig === this.arrowSig) return;
    this.arrowSig = sig;
    this.arrowRoot?.dispose(false, true);
    this.arrowRuns = [];
    this.arrowRoot = new TransformNode('arrows', this.scene);
    for (const plan of runsData) {
      const a = this.state.galaxy.planets.get(plan.from);
      const b = this.state.galaxy.planets.get(plan.to);
      if (!a || !b) continue;
      const from = new Vector3(a.pos.x * GALAXY_SCALE, 0.1, a.pos.y * GALAXY_SCALE);
      const to = new Vector3(b.pos.x * GALAXY_SCALE, 0.1, b.pos.y * GALAXY_SCALE);
      const len = to.subtract(from).length();
      const n = Math.max(4, Math.floor(len / 0.42));
      // Все наконечники одной цепочки — тонкие инстансы ОДНОГО меша: раньше
      // это были десятки отдельных объектов на каждую стрелку.
      const mesh = CreateCylinder('arrow', {
        diameterTop: 0, diameterBottom: 0.17, height: 0.24, tessellation: 4,
      }, this.scene);
      const mat = new StandardMaterial('arrowMat', this.scene);
      mat.emissiveColor = hexColor(plan.color);
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.specularColor = new Color3(0, 0, 0);
      mat.disableLighting = true;
      mat.alpha = 0.95;
      mat.alphaMode = Constants.ALPHA_ADD;
      mat.disableDepthWrite = true;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.parent = this.arrowRoot;
      mesh.thinInstanceSetBuffer('matrix', new Float32Array(n * 16), 16, false);
      this.arrowRuns.push({ from, to, mesh, n });
    }
  }

  private animateAttackArrows(t: number): void {
    const up = new Vector3(0, 1, 0);
    for (const run of this.arrowRuns) {
      const n = run.n;
      const shift = (t * 0.22) % (1 / n);
      const dir = run.to.subtract(run.from).normalize();
      // остриё конуса (+Y) разворачиваем по направлению атаки
      const axis = Vector3.Cross(up, dir);
      const dot = Math.max(-1, Math.min(1, Vector3.Dot(up, dir)));
      const q = axis.lengthSquared() < 1e-8
        ? (dot > 0 ? Quaternion.Identity() : Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI))
        : Quaternion.RotationAxis(axis.normalize(), Math.acos(dot));
      const buf = new Float32Array(n * 16);
      const pos = new Vector3();
      for (let i = 0; i < n; i++) {
        const k = (i / n + shift) % 1;
        // не наезжаем на сами планеты — небольшой отступ с обеих сторон
        const kk = 0.08 + k * 0.84;
        Vector3.LerpToRef(run.from, run.to, kk, pos);
        Matrix.ComposeToRef(Vector3.OneReadOnly, q, pos, tmpMatrix);
        tmpMatrix.copyToArray(buf, i * 16);
      }
      run.mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
    }
  }

  // --- Маршрут выбранного флота: пунктир через цель и очередь приказов -----

  private routeLine: LinesMesh | null = null;
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
    this.routeLine?.dispose();
    this.routeLine = null;
    if (!f || !stops.length) return;
    const pts: Vector3[] = [];
    const start = this.state.galaxy.planets.get(f.transit ? f.transit.from : f.at);
    if (start) pts.push(new Vector3(start.pos.x * GALAXY_SCALE, 0.14, start.pos.y * GALAXY_SCALE));
    for (const pid of stops) {
      const p = this.state.galaxy.planets.get(pid);
      if (p) pts.push(new Vector3(p.pos.x * GALAXY_SCALE, 0.14, p.pos.y * GALAXY_SCALE));
    }
    if (pts.length < 2) return;
    // Длина штриха и просвета те же, что были: 0.22 и 0.16 мировых единиц.
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Vector3.Distance(pts[i - 1]!, pts[i]!);
    const dashes = Math.max(2, Math.round(total / 0.38));
    this.routeLine = CreateDashedLines('route', {
      points: pts, dashSize: 0.22, gapSize: 0.16, dashNb: dashes,
    }, this.scene);
    this.routeLine.color = hexColor(factionColor(f.faction));
    this.routeLine.alpha = 0.75;
    this.routeLine.isPickable = false;
    this.routeLine.alwaysSelectAsActiveMesh = true;
  }

  private lodOct = 5;
  private lodRelief = false;

  render(): void {
    // Время кадра игра меряет САМА, и это не прихоть.
    //
    // Счётчик кадров у движка ведёт beginFrame(), а его вызывает только
    // собственный цикл отрисовки движка. Здесь цикл один на всю игру (сначала
    // шаг мира, потом кадр — см. main.ts), поэтому engine.getDeltaTime()
    // остаётся нулём, и на нуле замирает всё, что движется: вращение планет,
    // облёты станций, выхлоп и следы флотов, пульс захвата. Кадр при этом
    // рисуется исправно, и на неподвижной картинке подмену не видно.
    const now = performance.now();
    const dt = this.last === 0 ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.elapsed += dt;
    const t = this.elapsed;
    this.stars.update(t, 1 / this.engine.getHardwareScalingLevel());
    // LOD шейдера планет. Порог поднят: на общем плане галактики раньше
    // работали три октавы, и все миры выглядели размытыми пятнами именно
    // оттуда, откуда на них смотрят почти всё время. Теперь на общем плане
    // пять, на среднем шесть, вблизи все семь.
    const cap = QUALITY_PRESETS[this.quality].planetOct;
    const wantOct = Math.min(cap, this.distance > 34 ? 5 : this.distance > 18 ? 6 : 7);
    if (wantOct !== this.lodOct) {
      this.lodOct = wantOct;
      for (const vis of this.planets.values()) vis.setLod(wantOct);
    }
    // Геометрический LOD: рельефные меши (16 тыс. треугольников) включаются
    // только на подлёте, когда в кадре остаётся часть галактики.
    const wantRelief = this.distance < 13;
    if (wantRelief !== this.lodRelief) {
      this.lodRelief = wantRelief;
      for (const vis of this.planets.values()) vis.setRelief(wantRelief);
    }
    for (const vis of this.planets.values()) vis.update(t, dt);
    for (const m of this.homeMarkers) {
      m.node.position.y = m.baseY + Math.sin(t * 1.1 + m.phase) * 0.05;
    }
    this.fleets.update(this.state, dt);
    this.syncAttackArrows();
    this.animateAttackArrows(t);
    this.syncRoute();
    this.updatePulses(dt);
    this.applyKeyPan(dt);
    this.updateCinema(dt);
    this.updateCamera();
    // beginFrame/endFrame — то, что обычно делает собственный цикл движка:
    // без них не ведутся ни счётчик кадров, ни статистика отрисовки.
    this.engine.beginFrame();
    this.scene.render();
    this.engine.endFrame();
  }

  resize(): void {
    this.engine.resize();
  }
}

/** Рабочая матрица для раскладки тонких инстансов — чтобы не плодить мусор. */
const tmpMatrix = Matrix.Identity();
