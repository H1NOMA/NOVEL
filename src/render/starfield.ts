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

/** Цветные туманности на краях владений фракций: живой фон галактики. */
export function createFactionNebulae(worldRadius: number): THREE.Group {
  const group = new THREE.Group();
  // [угол клина, цвет]: терминиды — золото, автоматоны — багрянец, иллюминаты — фиолет.
  const zones: [number, string][] = [
    [0, '255,180,70'],
    [(135 * Math.PI) / 180, '255,80,60'],
    [(257 * Math.PI) / 180, '170,110,255'],
  ];
  for (const [ang, rgb] of zones) {
    const tex = blobTexture(rgb);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0.16 + i * 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      const a = ang + (i - 1) * 0.28;
      const r = worldRadius * (1.35 + i * 0.22);
      sp.position.set(Math.cos(a) * r, -2.5 - i * 1.2, Math.sin(a) * r);
      sp.scale.setScalar(worldRadius * (0.9 + i * 0.35));
      group.add(sp);
    }
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
  const g = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(120,180,255,0.2)');
  g.addColorStop(0.25, 'rgba(60,110,190,0.12)');
  g.addColorStop(0.6, 'rgba(30,50,110,0.06)');
  g.addColorStop(1, 'rgba(8,10,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Sprinkle faint spiral dust.
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.pow(Math.random(), 0.5) * (size / 2);
    const x = size / 2 + Math.cos(a + rr * 0.02) * rr;
    const y = size / 2 + Math.sin(a + rr * 0.02) * rr;
    ctx.fillStyle = `rgba(200,220,255,${Math.random() * 0.06})`;
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
