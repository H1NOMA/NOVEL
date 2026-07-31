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
varying vec3 vObj; varying vec3 vNormal; varying vec3 vView;
${NOISE_GLSL}
void main(){
  vec3 n = normalize(vObj);
  vec3 sp = n * (1.8 + uRough) + vec3(uSeed);
  float h = fbm(sp);
  float land = smoothstep(uWater - 0.06, uWater + 0.06, h * 0.5 + 0.5);
  vec3 surf = mix(uSea, uLand, land);
  float detail = fbm(sp * 3.1);
  surf *= 0.82 + 0.32 * (detail * 0.5 + 0.5);
  // polar ice caps
  float lat = abs(n.y);
  surf = mix(surf, vec3(0.92, 0.96, 1.0), smoothstep(0.82, 0.95, lat) * 0.7);
  // clouds
  float c = fbm(sp * 1.7 + vec3(uTime * 0.03, 0.0, 0.0));
  c = smoothstep(0.35, 0.75, c * 0.5 + 0.5) * uClouds;
  surf = mix(surf, vec3(1.0), c * 0.55);
  // faction tint
  surf = mix(surf, surf * 0.55 + uTint * 0.75, 0.22);
  // lighting
  vec3 nrm = normalize(vNormal);
  vec3 sun = normalize(vec3(0.55, 0.35, 0.75));
  float diff = clamp(dot(nrm, sun), 0.0, 1.0);
  vec3 col = surf * (0.28 + 0.95 * diff);
  // atmosphere rim
  vec3 vd = normalize(vView);
  float fres = pow(1.0 - clamp(dot(nrm, vd), 0.0, 1.0), 3.0);
  col += uAtmo * fres * 1.1;
  col += uTint * fres * 0.35;
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
  gl_FragColor = vec4(uColor, fres * 0.9);
}
`;

const SPHERE_GEO = new THREE.SphereGeometry(1, 40, 40);
const RING_GEO = new THREE.RingGeometry(1.35, 1.55, 48);

export interface PlanetVisual {
  group: THREE.Group;
  surface: THREE.Mesh;
  material: THREE.ShaderMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  planetId: string;
  baseRadius: number;
  update(t: number): void;
  setOwner(hex: string): void;
  setSelected(on: boolean): void;
}

function hexToVec3(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

export function createPlanetVisual(planet: Planet, scale: number): PlanetVisual {
  const biome = BIOMES[planet.biome];
  const baseRadius = 0.42 * planet.scale * scale;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uLand: { value: hexToVec3(biome.land) },
      uSea: { value: hexToVec3(biome.sea) },
      uAtmo: { value: hexToVec3(biome.atmo) },
      uTint: { value: hexToVec3(FACTIONS[planet.owner].color) },
      uWater: { value: biome.water },
      uRough: { value: biome.rough },
      uClouds: { value: biome.clouds },
      uTime: { value: 0 },
      uSeed: { value: (planet.id.length * 13 + planet.name.length * 7) % 97 },
    },
  });

  const surface = new THREE.Mesh(SPHERE_GEO, material);
  surface.scale.setScalar(baseRadius);
  surface.userData.planetId = planet.id;

  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    uniforms: { uColor: { value: hexToVec3(biome.atmo) } },
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const atmo = new THREE.Mesh(SPHERE_GEO, atmoMat);
  atmo.scale.setScalar(baseRadius * 1.22);

  const ringMat = new THREE.MeshBasicMaterial({
    color: hexToVec3(FACTIONS[planet.owner].color),
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(RING_GEO, ringMat);
  ring.scale.setScalar(baseRadius);
  ring.rotation.x = -Math.PI / 2; // lie flat on the galactic plane

  const group = new THREE.Group();
  group.add(surface, atmo, ring);
  group.userData.planetId = planet.id;

  let spin = 0;
  return {
    group,
    surface,
    material,
    ring,
    ringMat,
    planetId: planet.id,
    baseRadius,
    update(t: number) {
      material.uniforms.uTime.value = t;
      spin += 0.0025;
      surface.rotation.y = spin;
    },
    setOwner(hex: string) {
      material.uniforms.uTint.value.set(hex);
      ringMat.color.set(hex);
    },
    setSelected(on: boolean) {
      ringMat.opacity = on ? 1 : 0.85;
      ring.scale.setScalar(on ? baseRadius * 1.15 : baseRadius);
    },
  };
}
