import * as THREE from 'three';

export function createStarfield(count = 2600, radius = 260): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Distribute on a large sphere shell around the scene.
    const r = radius * (0.6 + Math.random() * 0.4);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.55;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const t = Math.random();
    c.setHSL(0.55 + t * 0.1, 0.4, 0.6 + Math.random() * 0.4);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.1,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
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
  const g = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(120,180,255,0.085)');
  g.addColorStop(0.25, 'rgba(60,110,190,0.05)');
  g.addColorStop(0.6, 'rgba(30,50,110,0.024)');
  g.addColorStop(1, 'rgba(8,10,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Sprinkle faint spiral dust.
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.pow(Math.random(), 0.5) * (size / 2);
    const x = size / 2 + Math.cos(a + rr * 0.02) * rr;
    const y = size / 2 + Math.sin(a + rr * 0.02) * rr;
    ctx.fillStyle = `rgba(200,220,255,${Math.random() * 0.028})`;
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
