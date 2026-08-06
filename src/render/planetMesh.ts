import * as THREE from 'three';
import type { Planet } from '../core/types';
import { BIOMES } from '../data/biomes';
import { FACTIONS } from '../data/factions';

// Ashima simplex noise (3D) + fbm, used to give every planet a unique,
// volumetric procedural surface instead of a flat sprite.
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p){
  float f = 0.0; float amp = 0.5;
  // Дальняя камера рубит октавы (uOct 3 вместо 5) — деталей всё равно не видно.
  for(int i=0;i<5;i++){
    if (float(i) >= uOct) break;
    f += amp*snoise(p); p *= 2.02; amp *= 0.5;
  }
  return f;
}
`;

const VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vView;
void main(){
  vObj = position;
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uLand; uniform vec3 uSea; uniform vec3 uAtmo;
uniform vec3 uTint; uniform float uWater; uniform float uRough;
uniform float uClouds; uniform float uTime; uniform float uSeed;
uniform float uFreq; uniform float uWarp; uniform float uBands;
uniform float uCity; uniform float uCapSize; uniform float uContinent;
uniform float uRidges; uniform float uCraters;
uniform float uBattle; uniform float uDim; uniform float uScar;
uniform float uOct; uniform float uLava; uniform float uIce; uniform float uToxic;
uniform sampler2D uMask; uniform float uUseMask;
varying vec3 vObj; varying vec3 vNormal; varying vec3 vView;
${NOISE_GLSL}
void main(){
  vec3 n = normalize(vObj);
  vec3 sp = n * (uFreq + uRough) + vec3(uSeed);

  // Доменное искажение — континенты обретают естественные рваные очертания.
  vec3 w = vec3(fbm(sp + 13.1), fbm(sp + 71.7), fbm(sp + 29.3));
  vec3 q = sp + uWarp * w;
  // Крупная низкочастотная компонента сливает сушу в настоящие континенты.
  float h = mix(fbm(q), fbm(q * 0.42 + 5.7), uContinent);

  // Газовые гиганты: турбулентные широтные полосы.
  if (uBands > 0.5) {
    h = mix(h, sin(n.y * uBands + w.x * 4.0 + uSeed) * 0.55, 0.7);
  }

  float hn = h * 0.5 + 0.5;

  // Настоящая карта континентов (Супер-Земля): маска в эквидистантной проекции
  // задаёт сушу, fbm слегка рвёт береговую линию.
  if (uUseMask > 0.5) {
    float lon = atan(n.z, n.x) / 6.2831853 + 0.5;
    float latv = asin(clamp(n.y, -1.0, 1.0)) / 3.1415926 + 0.5;
    float m = texture2D(uMask, vec2(lon, latv)).r;
    float coast = fbm(q * 3.2) * 0.14;
    hn = mix(uWater - 0.22, uWater + 0.3, clamp(m + coast, 0.0, 1.0));
  }

  float land = smoothstep(uWater - 0.05, uWater + 0.05, hn);
  vec3 surf = mix(uSea, uLand, land);

  // Высотная окраска суши: низины темнее и сочнее, нагорья светлее.
  float relief = fbm(q * 2.6);
  surf = mix(surf * 0.8, surf * 1.25, smoothstep(-0.4, 0.6, relief) * land);
  // Мелкий рельеф.
  float detail = fbm(q * 5.3);
  surf *= 0.86 + 0.24 * (detail * 0.5 + 0.5);
  // Прибрежная полоса чуть светлее (отмели).
  float shore = smoothstep(uWater - 0.05, uWater, hn) * (1.0 - land);
  surf += uSea * shore * 0.5;

  // Хребты: тёмные жилы горных цепей (пустыни и безводные миры).
  if (uRidges > 0.5) {
    float ridge = 1.0 - abs(fbm(q * 2.2 + 31.0));
    float chains = smoothstep(0.78, 0.94, ridge);
    surf = mix(surf, surf * 0.45, chains * 0.8);
    // подсветка гребней
    float crest = smoothstep(0.9, 0.98, ridge);
    surf += vec3(0.16, 0.13, 0.09) * crest;
  }

  // Кратерные поля мёртвых миров: чаши с подсвеченными валами.
  if (uCraters > 0.5) {
    float cr = abs(snoise(q * 3.1 + 60.0));
    float bowl = 1.0 - smoothstep(0.0, 0.09, cr);
    float rim = smoothstep(0.05, 0.09, cr) - smoothstep(0.09, 0.2, cr);
    surf = mix(surf, surf * 0.5, bowl * 0.85);
    surf += vec3(0.12, 0.11, 0.1) * rim;
  }

  // Полярные шапки — только там, где им положено быть (uCapSize > 1 = нет шапок).
  // Кромка льда рваная: шум ломает ровную границу.
  float lat = abs(n.y);
  float cap = smoothstep(uCapSize, uCapSize + 0.1, lat + relief * 0.05 + fbm(q * 3.1 + 9.0) * 0.045);
  surf = mix(surf, vec3(0.93, 0.96, 1.0), cap * 0.85);

  // Большой шторм-вихрь газового гиганта (у каждого — свой, по сиду).
  if (uBands > 0.5) {
    float lonS = atan(n.z, n.x);
    vec2 sd = vec2(sin(lonS - uSeed), (n.y - 0.22) * 2.6);
    float storm = 1.0 - smoothstep(0.1, 0.4, length(sd));
    float swirl = fbm(sp * 3.0 + vec3(uTime * 0.05, 0.0, 0.0)) * 0.5 + 0.5;
    surf = mix(surf, surf * 1.45 + uLand * 0.3, storm * (0.55 + 0.45 * swirl));
  }

  // Два слоя облаков: крупные массивы + перистая рябь.
  float c1 = fbm(sp * 1.6 + vec3(uTime * 0.03, 0.0, 0.0));
  float c2 = fbm(sp * 4.2 + vec3(-uTime * 0.05, uTime * 0.01, 0.0));
  float clouds = smoothstep(0.32, 0.72, c1 * 0.5 + 0.5) * 0.75 + smoothstep(0.55, 0.9, c2 * 0.5 + 0.5) * 0.35;
  clouds *= uClouds;
  // Токсичные миры: кислотно-зелёные вихри вместо белых облаков.
  vec3 cloudCol = mix(vec3(1.0), vec3(0.72, 1.0, 0.5), uToxic);
  surf = mix(surf, cloudCol, clamp(clouds, 0.0, 1.0) * 0.6);

  // Освещение.
  vec3 nrm = normalize(vNormal);
  vec3 sun = normalize(vec3(0.55, 0.35, 0.75));
  float diff = clamp(dot(nrm, sun), 0.0, 1.0);
  vec3 col = surf * (0.26 + 1.0 * diff);

  // Тёплая полоса терминатора — «закат» на границе дня и ночи.
  float term = smoothstep(0.0, 0.14, diff) * (1.0 - smoothstep(0.14, 0.4, diff));
  col += vec3(0.45, 0.22, 0.07) * term * 0.3 * (1.0 - clouds * 0.5);

  // Солнечный блик на воде.
  vec3 vd = normalize(vView);
  float spec = pow(clamp(dot(reflect(-sun, nrm), vd), 0.0, 1.0), 28.0);
  col += vec3(1.0, 0.97, 0.85) * spec * (1.0 - land) * (1.0 - clouds) * 0.55;

  // Ледяные миры: сеть трещин и холодный зеркальный блеск.
  if (uIce > 0.5) {
    float cracks = smoothstep(0.84, 0.96, 1.0 - abs(fbm(q * 5.5 + 23.0)));
    col = mix(col, vec3(0.6, 0.8, 1.0), cracks * 0.3);
    col += vec3(0.7, 0.85, 1.0) * spec * 0.4;
  }

  // Магмовые миры: лавовые океаны светятся и ночью, по коре бегут жилы огня.
  if (uLava > 0.5) {
    float pulse = 0.8 + 0.2 * sin(uTime * 0.9 + uSeed * 5.0);
    col += uSea * (1.0 - land) * 0.5 * pulse;
    float veins = smoothstep(0.78, 0.93, 1.0 - abs(fbm(q * 4.2 + 7.0)));
    col += vec3(1.0, 0.36, 0.06) * veins * land * 0.8 * pulse;
  }

  // Ночные огни городов на тёмной стороне обитаемых миров.
  if (uCity > 0.5) {
    float night = 1.0 - smoothstep(0.0, 0.25, diff);
    float lights = smoothstep(0.72, 0.86, fbm(q * 7.0) * 0.5 + 0.5);
    col += vec3(1.0, 0.82, 0.45) * lights * night * land * (1.0 - clouds) * 0.9;
  }

  // Погода войны: на сражающейся планете тлеют пожары и стелется гарь.
  if (uBattle > 0.5) {
    float fire = smoothstep(0.74, 0.94, fbm(q * 6.0 + vec3(uTime * 0.25)) * 0.5 + 0.5);
    float flicker = 0.7 + 0.3 * sin(uTime * 5.0 + uSeed * 40.0 + n.x * 9.0);
    col += vec3(1.0, 0.42, 0.1) * fire * land * flicker * 0.9;
    float smoke = smoothstep(0.5, 0.85, fbm(q * 2.4 + vec3(-uTime * 0.06, uTime * 0.04, 0.0)) * 0.5 + 0.5);
    col = mix(col, vec3(0.16, 0.14, 0.13), smoke * 0.35);
  }
  // Шрамы войны: выжженные пятна на месте долгих сражений — навсегда.
  if (uScar > 0.5) {
    float burn = smoothstep(0.68, 0.9, fbm(q * 3.4 + 17.0) * 0.5 + 0.5);
    col = mix(col, vec3(0.07, 0.06, 0.05), burn * 0.55 * land);
    float ash = smoothstep(0.8, 0.95, fbm(q * 6.8 + 41.0) * 0.5 + 0.5);
    col = mix(col, vec3(0.2, 0.18, 0.16), ash * 0.3);
  }

  // Осада: отрезанный от снабжения мир меркнет.
  col *= uDim;

  // Фракционный ободок — единственная цветовая кодировка на сфере.
  float fres = pow(1.0 - clamp(dot(nrm, vd), 0.0, 1.0), 3.0);
  col += uTint * fres * 1.15;
  col += uAtmo * fres * 0.12;
  gl_FragColor = vec4(col, 1.0);
}
`;

const ATMO_VERT = /* glsl */ `
varying vec3 vNormal; varying vec3 vView;
void main(){
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const ATMO_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec3 vNormal; varying vec3 vView;
void main(){
  vec3 nrm = normalize(vNormal);
  vec3 vd = normalize(vView);
  float fres = pow(1.0 - clamp(dot(nrm, vd), 0.0, 1.0), 3.4);
  gl_FragColor = vec4(uColor, fres * 0.5);
}
`;

const SPHERE_GEO = new THREE.SphereGeometry(1, 72, 54);
const SHELL_GEO = new THREE.SphereGeometry(1, 28, 20);

// Кольцо наведения: три дуги с тремя квадратными вырезами, равномерно
// распределёнными по окружности. Вращается вокруг оси планеты.
const HOVER_ARC = (Math.PI * 2) / 3 - 0.38; // дуга ~101°, вырез ~22°
function buildHoverRing(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const start = (i * Math.PI * 2) / 3 + 0.19;
    const geo = new THREE.RingGeometry(1.42, 1.58, 20, 1, start, HOVER_ARC);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd24a,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const arc = new THREE.Mesh(geo, mat);
    g.add(arc);
  }
  g.rotation.x = -Math.PI / 2;
  return g;
}

export interface PlanetVisual {
  group: THREE.Group;
  surface: THREE.Mesh;
  material: THREE.ShaderMaterial;
  planetId: string;
  baseRadius: number;
  update(t: number, dt: number): void;
  setOwner(hex: string): void;
  setSelected(on: boolean): void;
  setHovered(on: boolean): void;
  setGloom(on: boolean): void;
  setAbyss(on: boolean): void;
  setShattered(on: boolean): void;
  /** Пожары войны на поверхности сражающейся планеты. */
  setBattle(on: boolean): void;
  /** Затемнение осаждённого мира (1 — норма, <1 — меркнет). */
  setDim(v: number): void;
  /** Шрамы долгих битв на поверхности (перманентные). */
  setScar(on: boolean): void;
  /** Обломки погибших флотов на орбите (0 — чисто). */
  setWreckage(amount: number): void;
  /** Уровень детализации шейдера: октавы шума (5 — вблизи, 3 — издали). */
  setLod(octaves: number): void;
  /** Планетарный щит: голубая сфера; active — под ударом (ярче, пульс). */
  setShield(on: boolean, active: boolean): void;
  /** Орбитальная боевая станция, кружащая над планетой. */
  setStation(on: boolean): void;
}

// ---------------------------------------------------------------------------
// Карта Земли для Супер-Земли: узнаваемые очертания континентов рисуются на
// канве (эквидистантная проекция) и подаются в шейдер маской суши.
// ---------------------------------------------------------------------------

let earthMaskTex: THREE.Texture | null = null;
let dummyMaskTex: THREE.Texture | null = null;

type LL = [number, number]; // [долгота, широта] в градусах

const CONTINENTS: LL[][] = [
  // Северная Америка (с Аляской и Мексикой)
  [[-168, 66], [-152, 71], [-130, 70], [-110, 72], [-95, 73], [-82, 74], [-74, 66], [-60, 55], [-52, 47], [-65, 44], [-70, 41], [-75, 35], [-81, 30], [-80, 25], [-90, 29], [-97, 26], [-97, 20], [-95, 16], [-84, 10], [-79, 8], [-83, 14], [-92, 15], [-105, 22], [-114, 30], [-121, 34], [-124, 42], [-128, 50], [-135, 57], [-152, 58], [-165, 55], [-168, 60]],
  // Гренландия
  [[-58, 76], [-45, 82], [-25, 83], [-20, 76], [-25, 70], [-40, 60], [-50, 62], [-55, 68]],
  // Южная Америка
  [[-79, 9], [-70, 12], [-62, 10], [-52, 5], [-44, -3], [-35, -6], [-37, -13], [-40, -22], [-48, -28], [-58, -34], [-62, -41], [-66, -48], [-69, -54], [-72, -50], [-71, -38], [-72, -30], [-70, -18], [-76, -10], [-80, -3], [-78, 3]],
  // Африка
  [[-17, 21], [-10, 32], [0, 36], [10, 37], [20, 32], [32, 31], [35, 27], [34, 15], [43, 12], [51, 10], [48, 2], [41, -4], [40, -13], [35, -22], [30, -30], [20, -35], [17, -32], [14, -22], [12, -14], [8, -1], [9, 4], [4, 6], [-5, 5], [-13, 9], [-17, 15]],
  // Европа + Азия
  [[-10, 44], [-9, 52], [-2, 58], [5, 62], [12, 65], [20, 70], [35, 68], [45, 68], [60, 70], [75, 73], [90, 76], [105, 77], [120, 73], [140, 72], [160, 70], [178, 66], [178, 62], [162, 60], [155, 53], [142, 47], [132, 43], [122, 38], [121, 30], [110, 20], [106, 10], [103, 2], [99, 7], [95, 16], [88, 22], [80, 8], [76, 15], [70, 22], [62, 25], [56, 26], [48, 30], [35, 36], [26, 38], [15, 40], [3, 43]],
  // Австралия
  [[113, -22], [115, -35], [125, -33], [130, -32], [137, -35], [140, -38], [147, -38], [153, -30], [151, -24], [145, -15], [140, -12], [135, -12], [130, -13], [122, -14], [114, -20]],
  // Антарктида (сплошной пояс)
  [[-180, -70], [180, -70], [180, -90], [-180, -90]],
];

function buildEarthMask(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#fff';
  const X = (lon: number) => ((lon + 180) / 360) * cv.width;
  const Y = (lat: number) => ((90 - lat) / 180) * cv.height;
  for (const poly of CONTINENTS) {
    ctx.beginPath();
    poly.forEach(([lon, lat], i) => (i === 0 ? ctx.moveTo(X(lon), Y(lat)) : ctx.lineTo(X(lon), Y(lat))));
    ctx.closePath();
    ctx.fill();
  }
  // Крупные острова: Великобритания, Мадагаскар, Япония, Новая Зеландия, Борнео.
  const isle = (lon: number, lat: number, rx: number, ry: number, rot = 0) => {
    ctx.save(); ctx.translate(X(lon), Y(lat)); ctx.rotate(rot);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  };
  isle(-3, 54, 4, 7);
  isle(47, -19, 4, 9);
  isle(139, 37, 4, 10, 0.5);
  isle(172, -42, 3, 8, 0.3);
  isle(114, 0, 8, 6);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function maskFor(planetId: string): { tex: THREE.Texture; use: number } {
  if (planetId === 'p_super_earth') {
    if (!earthMaskTex) earthMaskTex = buildEarthMask();
    return { tex: earthMaskTex, use: 1 };
  }
  if (!dummyMaskTex) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 2;
    dummyMaskTex = new THREE.CanvasTexture(cv);
  }
  return { tex: dummyMaskTex, use: 0 };
}

/** Deterministic 0..1 stream from a planet seed — drives per-planet variety. */
function seededStream(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPlanetVisual(planet: Planet, scale: number): PlanetVisual {
  const biome = BIOMES[planet.biome];
  const baseRadius = 0.42 * planet.scale * scale;
  const rand = seededStream(planet.seed);

  // Every planet gets its own surface: jittered colours, water level,
  // terrain frequency, spin and axial tilt — all derived from planet.seed.
  const land = new THREE.Color(biome.land).offsetHSL(rand() * 0.08 - 0.04, rand() * 0.2 - 0.1, rand() * 0.16 - 0.08);
  const sea = new THREE.Color(biome.sea).offsetHSL(rand() * 0.06 - 0.03, rand() * 0.2 - 0.1, rand() * 0.12 - 0.06);
  const water = Math.min(0.95, Math.max(0.02, biome.water + rand() * 0.26 - 0.13));
  const freq = 1.0 + rand() * 2.3;
  const clouds = Math.min(1, Math.max(0, biome.clouds + rand() * 0.25 - 0.12));
  const spinSpeed = (0.0012 + rand() * 0.003) * (rand() < 0.15 ? -1 : 1);
  const tilt = (rand() * 2 - 1) * 0.35;
  // Дополнительная уникальность поверхности.
  const warp = 0.35 + rand() * 0.85;                       // рваность континентов
  const bands = planet.biome === 'gas' ? 6 + rand() * 10 : 0; // полосы гигантов
  // Полярные шапки — только на землеподобных и ледяных мирах.
  const hasCaps = planet.biome === 'terran' || planet.biome === 'ice';
  const capSize = hasCaps ? 0.72 + rand() * 0.2 : 2.0;
  const city = planet.cities.length > 0 ? 1 : 0;           // ночные огни городов
  // Стиль суши: архипелаги / материки / пангея — треть миров каждого типа.
  // Магма всегда тяготеет к крупным лавовым океанам и цельным материкам.
  const styleRoll = rand();
  const continent = planet.biome === 'magma'
    ? 0.75 + rand() * 0.15
    : styleRoll < 0.3 ? 0.12 + rand() * 0.2   // архипелаг: россыпь островов
    : styleRoll < 0.72 ? 0.45 + rand() * 0.25 // классические континенты
    : 0.78 + rand() * 0.17;                    // пангея: единый сверхматерик
  // Горные хребты вместо воды на пустынных/бесплодных мирах.
  const ridges = planet.biome === 'desert' || planet.biome === 'barren' ? 1 : 0;
  // Кратерные поля: бесплодные — всегда, ледяные/пустынные — через раз.
  const craters = planet.biome === 'barren' || ((planet.biome === 'ice' || planet.biome === 'desert') && rand() < 0.45) ? 1 : 0;
  const mask = maskFor(planet.id);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uLand: { value: land },
      uSea: { value: sea },
      uAtmo: { value: new THREE.Color(biome.atmo) },
      uTint: { value: new THREE.Color(FACTIONS[planet.owner].color) },
      uWater: { value: water },
      uRough: { value: biome.rough },
      uClouds: { value: clouds },
      uTime: { value: 0 },
      uSeed: { value: (planet.seed % 8933) * 0.017 },
      uFreq: { value: freq },
      uWarp: { value: warp },
      uBands: { value: bands },
      uCity: { value: city },
      uCapSize: { value: capSize },
      uContinent: { value: continent },
      uRidges: { value: ridges },
      uCraters: { value: craters },
      uBattle: { value: 0 },
      uDim: { value: 1 },
      uScar: { value: 0 },
      uOct: { value: 5 },
      uLava: { value: planet.biome === 'magma' || planet.biome === 'volcanic' ? 1 : 0 },
      uIce: { value: planet.biome === 'ice' ? 1 : 0 },
      uToxic: { value: planet.biome === 'toxic' ? 1 : 0 },
      uMask: { value: mask.tex },
      uUseMask: { value: mask.use },
    },
  });

  const surface = new THREE.Mesh(SPHERE_GEO, material);
  surface.scale.setScalar(baseRadius);
  surface.rotation.z = tilt;
  surface.userData.planetId = planet.id;

  // Faction-coloured halo — ownership is always read from this one colour.
  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    uniforms: { uColor: { value: new THREE.Color(FACTIONS[planet.owner].color) } },
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const atmo = new THREE.Mesh(SHELL_GEO, atmoMat);
  atmo.scale.setScalar(baseRadius * 1.15);

  // Кольцо наведения (появляется только при hover/выборе, крутится вокруг оси).
  const hoverRing = buildHoverRing();
  hoverRing.scale.setScalar(baseRadius);
  hoverRing.visible = false;

  // Мрак: плотный клуб спорового дыма, скрывающий планету целиком,
  // плюс внешняя рваная дымка.
  const gloomMat = new THREE.MeshBasicMaterial({
    color: 0x8a742c,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const gloomShell = new THREE.Mesh(SHELL_GEO, gloomMat);
  gloomShell.scale.setScalar(baseRadius * 1.28);
  gloomShell.visible = false;

  const gloomHazeMat = new THREE.MeshBasicMaterial({
    color: 0xd8b32a,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const gloomHaze = new THREE.Mesh(SHELL_GEO, gloomHazeMat);
  gloomHaze.scale.set(baseRadius * 1.75, baseRadius * 1.45, baseRadius * 1.75);
  gloomHaze.visible = false;

  // Пелена Бездны: почти чёрная воронка на месте исчезнувшей планеты.
  const abyssMat = new THREE.MeshBasicMaterial({
    color: 0x1a0630,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const abyssShell = new THREE.Mesh(SHELL_GEO, abyssMat);
  abyssShell.scale.setScalar(baseRadius * 1.1);
  abyssShell.visible = false;

  // Поле обломков — кольцо каменной крошки на месте уничтоженной планеты.
  const debrisCount = 70;
  const debrisPos = new Float32Array(debrisCount * 3);
  for (let i = 0; i < debrisCount; i++) {
    const a = (i / debrisCount) * Math.PI * 2 + rand() * 0.3;
    const r = 0.7 + rand() * 0.75;
    debrisPos[i * 3] = Math.cos(a) * r;
    debrisPos[i * 3 + 1] = (rand() - 0.5) * 0.16;
    debrisPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const debrisGeo = new THREE.BufferGeometry();
  debrisGeo.setAttribute('position', new THREE.BufferAttribute(debrisPos, 3));
  const debrisMat = new THREE.PointsMaterial({ color: 0x9a938a, size: 0.09, sizeAttenuation: true });
  const debris = new THREE.Points(debrisGeo, debrisMat);
  debris.scale.setScalar(baseRadius);
  debris.visible = false;

  // Обломки погибших флотов: редкое тёмное кольцо крошки над орбитой.
  // Появляется после сражений и тает вместе с запасом обломков в состоянии.
  const wreckCount = 34;
  const wreckPos = new Float32Array(wreckCount * 3);
  for (let i = 0; i < wreckCount; i++) {
    const a = (i / wreckCount) * Math.PI * 2 + rand() * 0.4;
    const r = 1.7 + rand() * 0.7;
    wreckPos[i * 3] = Math.cos(a) * r;
    wreckPos[i * 3 + 1] = (rand() - 0.5) * 0.3;
    wreckPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const wreckGeo = new THREE.BufferGeometry();
  wreckGeo.setAttribute('position', new THREE.BufferAttribute(wreckPos, 3));
  const wreckMat = new THREE.PointsMaterial({
    color: 0x8a827a,
    size: 0.055,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const wreck = new THREE.Points(wreckGeo, wreckMat);
  wreck.scale.setScalar(baseRadius);
  wreck.visible = false;

  // Планетарный щит: полупрозрачная голубая сфера, при штурме — ярче и пульсирует.
  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0x66c8ff,
    transparent: true,
    opacity: 0.07,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shield = new THREE.Mesh(SHELL_GEO, shieldMat);
  shield.scale.setScalar(baseRadius * 1.34);
  shield.visible = false;

  // Орбитальная боевая станция: корпус-октаэдр с кольцом, кружит над миром.
  const stationGrp = new THREE.Group();
  const stBody = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.055),
    new THREE.MeshLambertMaterial({ color: 0x9aa4b0 })
  );
  const stRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.085, 0.008, 6, 18),
    new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.8 })
  );
  stRing.rotation.x = Math.PI / 2;
  stationGrp.add(stBody, stRing);
  stationGrp.visible = false;

  const group = new THREE.Group();
  group.add(surface, atmo, hoverRing, gloomShell, gloomHaze, abyssShell, debris, wreck, shield, stationGrp);
  group.userData.planetId = planet.id;

  let spin = rand() * Math.PI * 2;
  let hovered = false;
  let selected = false;
  let inAbyss = false;
  let shieldActive = false;
  const stationPhase = rand() * Math.PI * 2;

  const syncRing = () => {
    hoverRing.visible = (hovered || selected) && !inAbyss;
    for (const arc of hoverRing.children) {
      ((arc as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(selected ? 0xffd24a : 0xdce6f5);
    }
  };

  return {
    group,
    surface,
    material,
    planetId: planet.id,
    baseRadius,
    update(t: number, dt: number) {
      material.uniforms.uTime.value = t;
      spin += spinSpeed;
      surface.rotation.y = spin;
      if (hoverRing.visible) hoverRing.rotation.z += dt * 0.9;
      if (gloomShell.visible) {
        gloomShell.rotation.y += dt * 0.15;
        gloomHaze.rotation.y -= dt * 0.1;
        // дым «дышит»
        const puff = 1 + Math.sin(t * 0.7) * 0.04;
        gloomShell.scale.setScalar(baseRadius * 1.28 * puff);
      }
      if (abyssShell.visible) abyssShell.rotation.y -= dt * 0.4;
      if (debris.visible) debris.rotation.y += dt * 0.08;
      if (wreck.visible) wreck.rotation.y += dt * 0.05;
      if (shield.visible) {
        shieldMat.opacity = shieldActive ? 0.16 + Math.sin(t * 6) * 0.07 : 0.07;
        shield.rotation.y += dt * 0.2;
      }
      if (stationGrp.visible) {
        const a = t * 0.35 + stationPhase;
        const r = baseRadius * 2.1;
        stationGrp.position.set(Math.cos(a) * r, baseRadius * 0.45, Math.sin(a) * r);
        stationGrp.rotation.y = -a;
        stRing.rotation.z += dt * 0.8;
      }
    },
    setOwner(hex: string) {
      material.uniforms.uTint.value.set(hex);
      (atmoMat.uniforms.uColor.value as THREE.Color).set(hex);
    },
    setSelected(on: boolean) {
      selected = on;
      syncRing();
    },
    setHovered(on: boolean) {
      hovered = on;
      syncRing();
    },
    setGloom(on: boolean) {
      gloomShell.visible = on && !inAbyss;
      gloomHaze.visible = on && !inAbyss;
      // Дым скрывает саму планету.
      surface.visible = !on && !inAbyss;
      atmo.visible = !on && !inAbyss;
    },
    setAbyss(on: boolean) {
      inAbyss = on;
      // Планета исчезает из реального пространства: видна лишь тёмная воронка.
      surface.visible = !on;
      atmo.visible = !on;
      abyssShell.visible = on;
      if (on) gloomShell.visible = false;
      syncRing();
    },
    setShattered(on: boolean) {
      surface.visible = !on;
      atmo.visible = !on;
      debris.visible = on;
      if (on) {
        gloomShell.visible = false;
        abyssShell.visible = false;
      }
    },
    setBattle(on: boolean) {
      material.uniforms.uBattle.value = on ? 1 : 0;
    },
    setDim(v: number) {
      material.uniforms.uDim.value = v;
    },
    setScar(on: boolean) {
      material.uniforms.uScar.value = on ? 1 : 0;
    },
    setWreckage(amount: number) {
      const on = amount > 0.5 && surface.visible;
      wreck.visible = on;
      wreckMat.opacity = on ? Math.min(0.85, 0.25 + amount / 30) : 0;
    },
    setLod(octaves: number) {
      material.uniforms.uOct.value = octaves;
    },
    setShield(on: boolean, active: boolean) {
      shield.visible = on && surface.visible;
      shieldActive = active;
    },
    setStation(on: boolean) {
      stationGrp.visible = on && surface.visible;
    },
  };
}
