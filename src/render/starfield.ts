import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Scene } from '@babylonjs/core/scene';
import { offsetHSL } from './engine';

// ---------------------------------------------------------------------------
// Звёздное небо.
//
// Звёзды — собственный шейдер поверх облака точек: круглый профиль с мягким
// краем, размер в ПИКСЕЛЯХ (звезда не должна раздуваться, когда камера
// подлетает к краю карты), собственная яркость и класс цвета у каждой,
// медленное мерцание с индивидуальной фазой.
//
// Шейдер перенесён с прежнего движка дословно; поменялась только шапка.
// Babylon не подставляет атрибуты и матрицы сам, поэтому они объявлены явно, а
// `projectionMatrix * modelViewMatrix` схлопнулось в `worldViewProjection`.
// ---------------------------------------------------------------------------

Effect.ShadersStore['galaxyStarsVertexShader'] = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec4 color;
attribute float aSize;
attribute float aPhase;
attribute float aBright;
uniform mat4 worldViewProjection;
uniform float uTime;
uniform float uPixelRatio;
varying vec3 vCol;
varying float vAlpha;
void main(){
  gl_Position = worldViewProjection * vec4(position, 1.0);
  // Мерцание медленное и у каждой звезды своё: синхронное подмигивание всего
  // неба сразу выглядит как сбой, а не как атмосфера.
  float tw = 0.78 + 0.22 * sin(uTime * 0.7 + aPhase);
  gl_PointSize = aSize * uPixelRatio * tw;
  vCol = color.rgb;
  vAlpha = aBright * tw;
}
`;

Effect.ShadersStore['galaxyStarsFragmentShader'] = /* glsl */ `
precision highp float;
varying vec3 vCol;
varying float vAlpha;
void main(){
  // Круг с мягким краем вместо квадрата: расстояние от центра точки.
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  // Ядро ярче края — звезда получает крошечное гало вместо плоского диска.
  float core = 1.0 - smoothstep(0.0, 0.55, r);
  float halo = 1.0 - smoothstep(0.35, 1.0, r);
  float a = vAlpha * (core * 0.85 + halo * 0.35);
  gl_FragColor = vec4(vCol, a);
}
`;

export interface Starfield {
  mesh: Mesh;
  /** Мерцание: вызывать раз в кадр с общим временем сцены. */
  update(t: number, pixelRatio: number): void;
  /** Сколько звёзд рисовать (пресет качества режет хвост, не пересобирая). */
  setCount(n: number): void;
}

export function createStarfield(scene: Scene, count = 3200, radius = 260): Starfield {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const bright = new Float32Array(count);
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const r = radius * (0.6 + Math.random() * 0.4);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.55;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    // Спектральные классы вместо одного голубого оттенка: небо перестаёт быть
    // однородно синим, появляются тёплые и оранжевые точки.
    const roll = Math.random();
    const c = roll < 0.06 ? hsl(0.06, 0.55, 0.72)      // красноватые гиганты
      : roll < 0.20 ? hsl(0.10, 0.35, 0.82)            // жёлтые
      : roll < 0.55 ? hsl(0.58, 0.10, 0.92)            // белые
      : hsl(0.58, 0.38, 0.86);                         // голубые
    colors[i * 4] = c.r;
    colors[i * 4 + 1] = c.g;
    colors[i * 4 + 2] = c.b;
    colors[i * 4 + 3] = 1;

    // Степенное распределение: ярких звёзд единицы, тусклой пыли — большинство.
    const mag = Math.pow(Math.random(), 2.2);
    sizes[i] = 1.5 + mag * 4.2;
    bright[i] = 0.34 + mag * 0.66;
    phases[i] = Math.random() * Math.PI * 2;
    indices[i] = i;
  }

  const mesh = new Mesh('stars', scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.colors = colors;
  vd.indices = indices;
  vd.applyToMesh(mesh, false);
  mesh.setVerticesData('aSize', sizes, false, 1);
  mesh.setVerticesData('aPhase', phases, false, 1);
  mesh.setVerticesData('aBright', bright, false, 1);

  const mat = new ShaderMaterial('starsMat', scene, 'galaxyStars', {
    attributes: ['position', 'color', 'aSize', 'aPhase', 'aBright'],
    uniforms: ['worldViewProjection', 'uTime', 'uPixelRatio'],
    needAlphaBlending: true,
  });
  // Аддитивно: звёзды складываются со свечением, а не вырезают дыры в фоне.
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  mesh.material = mat;
  // Точечный режим отрисовки — иначе индексы станут треугольниками.
  mesh.setVerticesData(VertexBuffer.PositionKind, positions, false, 3);
  mesh.material.pointsCloud = true;
  mesh.material.fillMode = 2; // PointFillMode
  // Небо всегда позади всего остального и никогда не отсекается.
  mesh.renderingGroupId = 0;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isPickable = false;
  mesh.infiniteDistance = false;

  return {
    mesh,
    update(t: number, pixelRatio: number) {
      mat.setFloat('uTime', t);
      mat.setFloat('uPixelRatio', pixelRatio);
    },
    setCount(n: number) {
      // Пресеты качества не пересобирают геометрию, а рисуют часть точек.
      mesh.subMeshes[0]!.indexCount = Math.max(0, Math.min(count, Math.floor(n)));
    },
  };
}

/** Цвет из HSL — прежний рендер задавал спектральные классы именно так. */
function hsl(h: number, s: number, l: number): Color3 {
  return offsetHSL(new Color3(l, l, l), h, s, 0);
}

/** Мягкое цветное пятно для фоновых туманностей. */
function blobTexture(scene: Scene, rgb: string, key: string): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture(`nebula_${key}`, { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 6, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb},0.5)`);
  g.addColorStop(0.4, `rgba(${rgb},0.22)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/**
 * Дальние туманности — именно ФОН, а не декорация вокруг планет.
 *
 * Каждое облако висит на сфере радиусом в несколько диаметров карты и
 * развёрнуто billboard'ом к камере. Материал пишет только цвет (в глубину не
 * пишет) и рендерится в самой дальней группе: как бы близко ни подлетела
 * камера к краю галактики, туманность останется позади всего.
 *
 * Форма набирается из нескольких перекрывающихся пятен со случайным
 * поворотом и вытяжкой — одно круглое пятно читалось бы как размытый шар.
 */
export function createNebulaField(scene: Scene, worldRadius: number, count = 7): TransformNode {
  const root = new TransformNode('nebulae', scene);
  const palettes = ['86,132,214', '132,96,196', '58,120,168', '176,104,150', '92,150,180'];
  const texes = palettes.map((p, i) => blobTexture(scene, p, `${i}`));
  // Далеко: ближний край облаков втрое дальше края карты.
  const R = worldRadius * 9;

  for (let i = 0; i < count; i++) {
    const cloud = new TransformNode(`cloud${i}`, scene);
    cloud.parent = root;
    const theta = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    // Облака держатся вблизи плоскости галактики, но не строго в ней.
    const phi = (Math.random() - 0.5) * 0.9;
    const r = R * (0.85 + Math.random() * 0.4);
    cloud.position.set(
      Math.cos(theta) * Math.cos(phi) * r,
      Math.sin(phi) * r * 0.55,
      Math.sin(theta) * Math.cos(phi) * r,
    );

    const tex = texes[i % texes.length]!;
    const blobs = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < blobs; k++) {
      const w = worldRadius * (2.4 + Math.random() * 2.6);
      const plane = CreatePlane(`blob${i}_${k}`, { width: w, height: w * (0.45 + Math.random() * 0.5) }, scene);
      const mat = new StandardMaterial(`blobMat${i}_${k}`, scene);
      mat.emissiveTexture = tex;
      mat.opacityTexture = tex;
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.specularColor = new Color3(0, 0, 0);
      mat.alpha = 0.16 + Math.random() * 0.12;
      mat.alphaMode = Constants.ALPHA_ADD;
      mat.disableDepthWrite = true;
      mat.disableLighting = true;
      plane.material = mat;
      plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
      plane.position.set(
        (Math.random() - 0.5) * w * 0.7,
        (Math.random() - 0.5) * w * 0.3,
        (Math.random() - 0.5) * w * 0.7,
      );
      plane.parent = cloud;
      plane.renderingGroupId = 0;
      plane.isPickable = false;
      plane.alwaysSelectAsActiveMesh = true;
    }
  }
  return root;
}

/** Мягкий диск галактической пыли под картой. */
export function createNebulaDisc(scene: Scene, worldRadius: number): Mesh {
  const size = 512;
  const tex = new DynamicTexture('nebulaDisc', { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  // Диск рисуется АДДИТИВНО и занимает почти весь кадр, поэтому даже слабая
  // заливка складывается сама с собой и высветляет всю карту. Значения срезаны
  // намеренно: галактическая пыль должна ЕДВА угадываться, а не заливать экран
  // ровным синим — именно из-за неё космос переставал быть чёрным.
  const g = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(120,180,255,0.030)');
  g.addColorStop(0.25, 'rgba(60,110,190,0.017)');
  g.addColorStop(0.6, 'rgba(30,50,110,0.008)');
  g.addColorStop(1, 'rgba(8,10,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Тонкая спиральная пыль.
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.pow(Math.random(), 0.5) * (size / 2);
    const x = size / 2 + Math.cos(a + rr * 0.02) * rr;
    const y = size / 2 + Math.sin(a + rr * 0.02) * rr;
    ctx.fillStyle = `rgba(200,220,255,${Math.random() * 0.016})`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  tex.update();
  tex.hasAlpha = true;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;

  const mesh = CreatePlane('nebulaDiscMesh', { size: worldRadius * 2.4 }, scene);
  const mat = new StandardMaterial('nebulaDiscMat', scene);
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.disableDepthWrite = true;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mesh.material = mat;
  // Плоскость строится в XY — кладём её в галактическую плоскость XZ.
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.05;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.renderingGroupId = 0;
  return mesh;
}
