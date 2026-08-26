import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Звёздное небо.
//
// Раньше это был PointsMaterial без текстуры, и точка рисовалась ровно тем,
// чем её рисует драйвер, — КВАДРАТОМ. При крупной точке (size 1.1 в мировых
// единицах с перспективным уменьшением) квадраты были отчётливо видны, и небо
// выглядело россыпью белых кубиков.
//
// Теперь звёзды — собственный шейдер: круглый профиль с мягким краем, размер
// в ПИКСЕЛЯХ (звезда не должна раздуваться, когда камера подлетает к краю
// карты), собственная яркость и класс цвета у каждой, медленное мерцание с
// индивидуальной фазой. Заодно небо стало гуще: 3200 квадратиков читались как
// мусор, 3200 разнокалиберных точек — как небо.
// ---------------------------------------------------------------------------

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute float aBright;
uniform float uTime;
uniform float uPixelRatio;
varying vec3 vCol;
varying float vAlpha;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Мерцание медленное и у каждой звезды своё: синхронное подмигивание всего
  // неба сразу выглядит как сбой, а не как атмосфера.
  float tw = 0.78 + 0.22 * sin(uTime * 0.7 + aPhase);
  gl_PointSize = aSize * uPixelRatio * tw;
  vCol = color;
  vAlpha = aBright * tw;
}
`;

const STAR_FRAG = /* glsl */ `
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
  points: THREE.Points;
  /** Мерцание: вызывать раз в кадр с общим временем сцены. */
  update(t: number, pixelRatio: number): void;
}

export function createStarfield(count = 3200, radius = 260): Starfield {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const bright = new Float32Array(count);
  const c = new THREE.Color();
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
    if (roll < 0.06) c.setHSL(0.06, 0.55, 0.72);        // красноватые гиганты
    else if (roll < 0.20) c.setHSL(0.10, 0.35, 0.82);   // жёлтые
    else if (roll < 0.55) c.setHSL(0.58, 0.10, 0.92);   // белые
    else c.setHSL(0.58, 0.38, 0.86);                    // голубые
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    // Степенное распределение: ярких звёзд единицы, тусклой пыли — большинство.
    const mag = Math.pow(Math.random(), 2.2);
    sizes[i] = 1.5 + mag * 4.2;
    bright[i] = 0.34 + mag * 0.66;
    phases[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    // Аддитивно: звёзды складываются со свечением, а не вырезают дыры в фоне.
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  // Небо всегда позади всего остального.
  points.renderOrder = -90;
  points.frustumCulled = false;
  return {
    points,
    update(t: number, pixelRatio: number) {
      uniforms.uTime.value = t;
      uniforms.uPixelRatio.value = pixelRatio;
    },
  };
}

/** Мягкое цветное пятно для фоновых туманностей. */
function blobTexture(rgb: string): THREE.Texture {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 6, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb},0.5)`);
  g.addColorStop(0.4, `rgba(${rgb},0.22)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

/**
 * Дальние туманности — именно ФОН, а не декорация вокруг планет.
 *
 * Каждое облако висит на сфере радиусом в несколько диаметров карты и
 * развёрнуто billboard'ом к камере. Материал пишет только цвет (depthWrite
 * выключен) и рендерится первым: как бы близко ни подлетела камера к краю
 * галактики, туманность останется позади всего.
 *
 * Форма набирается из нескольких перекрывающихся пятен со случайным
 * поворотом и вытяжкой — одно круглое пятно читалось бы как размытый шар.
 */
export function createNebulaField(worldRadius: number, count = 7): THREE.Group {
  const group = new THREE.Group();
  // renderOrder ниже всего и никакого теста глубины: слой всегда сзади.
  group.renderOrder = -100;
  const palettes = [
    '86,132,214', '132,96,196', '58,120,168', '176,104,150', '92,150,180',
  ];
  const texes = palettes.map((p) => blobTexture(p));
  // Далеко: ближний край облаков втрое дальше края карты.
  const R = worldRadius * 9;

  for (let i = 0; i < count; i++) {
    const cloud = new THREE.Group();
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
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.16 + Math.random() * 0.12,
        rotation: Math.random() * Math.PI,
      });
      const sp = new THREE.Sprite(mat);
      const w = worldRadius * (2.4 + Math.random() * 2.6);
      sp.scale.set(w, w * (0.45 + Math.random() * 0.5), 1);
      sp.position.set(
        (Math.random() - 0.5) * w * 0.7,
        (Math.random() - 0.5) * w * 0.3,
        (Math.random() - 0.5) * w * 0.7,
      );
      sp.renderOrder = -100;
      cloud.add(sp);
    }
    group.add(cloud);
  }
  return group;
}

export interface CometLayer {
  group: THREE.Group;
  update(t: number): void;
}

/** Редкие кометы, медленно чертящие фон за пределами карты. */
export function createComets(worldRadius: number): CometLayer {
  const group = new THREE.Group();
  const comets: { head: THREE.Sprite; tail: THREE.Sprite; r: number; speed: number; phase: number; y: number }[] = [];
  const headTex = blobTexture('220,240,255');
  for (let i = 0; i < 3; i++) {
    const head = new THREE.Sprite(new THREE.SpriteMaterial({
      map: headTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    head.scale.setScalar(0.5);
    const tail = new THREE.Sprite(new THREE.SpriteMaterial({
      map: headTex, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    tail.scale.set(2.6, 0.32, 1);
    group.add(head, tail);
    comets.push({
      head, tail,
      r: worldRadius * (1.5 + i * 0.35),
      speed: 0.014 + i * 0.006,
      phase: i * 2.1,
      y: -4 - i * 2,
    });
  }
  return {
    group,
    update(t: number) {
      for (const c of comets) {
        const a = c.phase + t * c.speed;
        c.head.position.set(Math.cos(a) * c.r, c.y, Math.sin(a) * c.r);
        // хвост тянется против движения
        const back = a - 0.045;
        c.tail.position.set(Math.cos(back) * c.r, c.y, Math.sin(back) * c.r);
        c.tail.material.rotation = -a - Math.PI / 2;
      }
    },
  };
}

/** A soft nebula disc texture generated on a 2D canvas. */
export function createNebulaDisc(worldRadius: number): THREE.Mesh {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  // Диск рисуется АДДИТИВНО и занимает почти весь кадр, поэтому даже слабая
  // заливка складывается сама с собой и высветляет всю карту. После того как
  // галактика выросла до восьми колец, прежние значения давали ровный синий
  // налёт поверх всего — планеты теряли тени, а космос переставал быть чёрным.
  // Значения срезаны ещё втрое: галактическая пыль должна ЕДВА угадываться,
  // а не заливать экран ровным синим — именно из-за неё космос переставал
  // быть чёрным, а карта выглядела выцветшей.
  const g = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(120,180,255,0.030)');
  g.addColorStop(0.25, 'rgba(60,110,190,0.017)');
  g.addColorStop(0.6, 'rgba(30,50,110,0.008)');
  g.addColorStop(1, 'rgba(8,10,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Sprinkle faint spiral dust.
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.pow(Math.random(), 0.5) * (size / 2);
    const x = size / 2 + Math.cos(a + rr * 0.02) * rr;
    const y = size / 2 + Math.sin(a + rr * 0.02) * rr;
    ctx.fillStyle = `rgba(200,220,255,${Math.random() * 0.016})`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const geo = new THREE.PlaneGeometry(worldRadius * 2.4, worldRadius * 2.4);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.05;
  return mesh;
}
