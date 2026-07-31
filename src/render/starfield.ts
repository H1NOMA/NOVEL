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

/** A soft nebula disc texture generated on a 2D canvas. */
export function createNebulaDisc(worldRadius: number): THREE.Mesh {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(120,180,255,0.32)');
  g.addColorStop(0.25, 'rgba(60,110,190,0.2)');
  g.addColorStop(0.6, 'rgba(30,50,110,0.1)');
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
