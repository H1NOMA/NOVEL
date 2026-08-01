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
  for(int i=0;i<5;i++){ f += amp*snoise(p); p *= 2.02; amp *= 0.5; }
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
uniform float uCity; uniform float uCapSize;
varying vec3 vObj; varying vec3 vNormal; varying vec3 vView;
${NOISE_GLSL}
void main(){
  vec3 n = normalize(vObj);
  vec3 sp = n * (uFreq + uRough) + vec3(uSeed);

  // Доменное искажение — континенты обретают естественные рваные очертания.
  vec3 w = vec3(fbm(sp + 13.1), fbm(sp + 71.7), fbm(sp + 29.3));
  vec3 q = sp + uWarp * w;
  float h = fbm(q);

  // Газовые гиганты: турбулентные широтные полосы.
  if (uBands > 0.5) {
    h = mix(h, sin(n.y * uBands + w.x * 4.0 + uSeed) * 0.55, 0.7);
  }

  float hn = h * 0.5 + 0.5;
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

  // Полярные шапки переменного размера.
  float lat = abs(n.y);
  float cap = smoothstep(uCapSize, uCapSize + 0.1, lat + relief * 0.05);
  surf = mix(surf, vec3(0.93, 0.96, 1.0), cap * 0.85);

  // Два слоя облаков: крупные массивы + перистая рябь.
  float c1 = fbm(sp * 1.6 + vec3(uTime * 0.03, 0.0, 0.0));
  float c2 = fbm(sp * 4.2 + vec3(-uTime * 0.05, uTime * 0.01, 0.0));
  float clouds = smoothstep(0.32, 0.72, c1 * 0.5 + 0.5) * 0.75 + smoothstep(0.55, 0.9, c2 * 0.5 + 0.5) * 0.35;
  clouds *= uClouds;
  surf = mix(surf, vec3(1.0), clamp(clouds, 0.0, 1.0) * 0.6);

  // Освещение.
  vec3 nrm = normalize(vNormal);
  vec3 sun = normalize(vec3(0.55, 0.35, 0.75));
  float diff = clamp(dot(nrm, sun), 0.0, 1.0);
  vec3 col = surf * (0.26 + 1.0 * diff);

  // Солнечный блик на воде.
  vec3 vd = normalize(vView);
  float spec = pow(clamp(dot(reflect(-sun, nrm), vd), 0.0, 1.0), 28.0);
  col += vec3(1.0, 0.97, 0.85) * spec * (1.0 - land) * (1.0 - clouds) * 0.55;

  // Ночные огни городов на тёмной стороне обитаемых миров.
  if (uCity > 0.5) {
    float night = 1.0 - smoothstep(0.0, 0.25, diff);
    float lights = smoothstep(0.72, 0.86, fbm(q * 7.0) * 0.5 + 0.5);
    col += vec3(1.0, 0.82, 0.45) * lights * night * land * (1.0 - clouds) * 0.9;
  }

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
  float fres = pow(1.0 - clamp(dot(nrm, vd), 0.0, 1.0), 2.5);
  gl_FragColor = vec4(uColor, fres * 0.75);
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
  const water = Math.min(0.95, Math.max(0.02, biome.water + rand() * 0.2 - 0.1));
  const freq = 1.3 + rand() * 1.6;
  const clouds = Math.min(1, Math.max(0, biome.clouds + rand() * 0.25 - 0.12));
  const spinSpeed = (0.0012 + rand() * 0.003) * (rand() < 0.15 ? -1 : 1);
  const tilt = (rand() * 2 - 1) * 0.35;
  // Дополнительная уникальность поверхности.
  const warp = 0.35 + rand() * 0.85;                       // рваность континентов
  const bands = planet.biome === 'gas' ? 6 + rand() * 10 : 0; // полосы гигантов
  const capSize = 0.72 + rand() * 0.2;                     // размер полярных шапок
  const city = planet.cities.length > 0 ? 1 : 0;           // ночные огни городов

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
  atmo.scale.setScalar(baseRadius * 1.22);

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

  const group = new THREE.Group();
  group.add(surface, atmo, hoverRing, gloomShell, gloomHaze, abyssShell, debris);
  group.userData.planetId = planet.id;

  let spin = rand() * Math.PI * 2;
  let hovered = false;
  let selected = false;
  let inAbyss = false;

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
  };
}
