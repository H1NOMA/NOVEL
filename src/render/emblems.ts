import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { FactionId } from '../core/types';

// ---------------------------------------------------------------------------
// Эмблемы родных миров. Оригинальные стилизации по мотивам фракций
// (цвет и настроение узнаваемы, рисунок — собственный).
// ---------------------------------------------------------------------------

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d')!;
  ctx.translate(128, 128);
  return [cv, ctx];
}

function ring(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(0, 0, 108, 0, Math.PI * 2);
  ctx.stroke();
}

/** Супер-Земля: геральдический щит, распахнутые пернатые крылья и звезда.
 *  Собственная композиция по мотивам символики Управляемой Демократии. */
function drawSuperEarth(ctx: CanvasRenderingContext2D): void {
  // распахнутые крылья: по три пера-сегмента с каждой стороны
  ctx.fillStyle = '#dce9fb';
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const baseX = s * (28 + i * 24);
      const tipX = s * (54 + i * 26);
      const topY = -34 - i * 14;
      ctx.beginPath();
      ctx.moveTo(s * 20, -6);
      ctx.lineTo(baseX, topY);
      ctx.lineTo(tipX, topY + 6);
      ctx.lineTo(s * 26, 10);
      ctx.closePath();
      ctx.fill();
    }
  }
  // щит
  const grad = ctx.createLinearGradient(0, -56, 0, 92);
  grad.addColorStop(0, '#1c4d80');
  grad.addColorStop(1, '#0d2a4c');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-52, -44);
  ctx.lineTo(52, -44);
  ctx.lineTo(52, 26);
  ctx.quadraticCurveTo(52, 66, 0, 90);
  ctx.quadraticCurveTo(-52, 66, -52, 26);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#e9f2ff';
  ctx.lineWidth = 6;
  ctx.stroke();
  // внутренняя кайма
  ctx.strokeStyle = '#3fa9f5';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-42, -35);
  ctx.lineTo(42, -35);
  ctx.lineTo(42, 24);
  ctx.quadraticCurveTo(42, 57, 0, 78);
  ctx.quadraticCurveTo(-42, 57, -42, 24);
  ctx.closePath();
  ctx.stroke();
  // звезда над глобусом-дугой
  ctx.strokeStyle = '#9fd0ff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 46, 24, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.fillStyle = '#ffe14d';
  star(ctx, 0, 8, 5, 26, 10.5);
}

/** Автоматоны: железный череп-визор со щелевым глазом в зубчатом кольце.
 *  Собственная композиция по мотивам машинной иконографии. */
function drawAutomatons(ctx: CanvasRenderingContext2D): void {
  // зубчатое кольцо-шестерня
  ctx.fillStyle = '#3a0d0b';
  ctx.strokeStyle = '#e0342b';
  ctx.lineWidth = 7;
  const teeth = 14;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? 108 : 92;
    const a = (i / (teeth * 2)) * Math.PI * 2;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // угловатый череп-визор
  const grad = ctx.createLinearGradient(0, -70, 0, 70);
  grad.addColorStop(0, '#7d1d16');
  grad.addColorStop(1, '#2a0705');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-52, -58);
  ctx.lineTo(52, -58);
  ctx.lineTo(62, -6);
  ctx.lineTo(40, 62);
  ctx.lineTo(16, 74);
  ctx.lineTo(-16, 74);
  ctx.lineTo(-40, 62);
  ctx.lineTo(-62, -6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ff6a4a';
  ctx.lineWidth = 4;
  ctx.stroke();
  // щелевой глаз-визор во всю ширину
  ctx.fillStyle = '#0c0404';
  ctx.beginPath();
  ctx.moveTo(-52, -22);
  ctx.lineTo(52, -22);
  ctx.lineTo(46, 2);
  ctx.lineTo(-46, 2);
  ctx.closePath();
  ctx.fill();
  const eye = ctx.createLinearGradient(-46, 0, 46, 0);
  eye.addColorStop(0, '#ff2a12');
  eye.addColorStop(0.5, '#ffb46a');
  eye.addColorStop(1, '#ff2a12');
  ctx.fillStyle = eye;
  ctx.fillRect(-42, -15, 84, 9);
  // «зубы»-рёбра нижней челюсти
  ctx.strokeStyle = '#0c0404';
  ctx.lineWidth = 6;
  for (const x of [-24, -8, 8, 24]) {
    ctx.beginPath();
    ctx.moveTo(x, 26);
    ctx.lineTo(x, 66);
    ctx.stroke();
  }
}

/** Терминиды: трискелион из зазубренных жвал в хитиновом кольце с насечками.
 *  Собственная композиция по мотивам знаков роя. */
function drawTerminids(ctx: CanvasRenderingContext2D): void {
  // хитиновое кольцо с насечками-сегментами
  ctx.strokeStyle = '#e8b830';
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.arc(0, 0, 106, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#141006';
  ctx.lineWidth = 4;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 98, Math.sin(a) * 98);
    ctx.lineTo(Math.cos(a) * 114, Math.sin(a) * 114);
    ctx.stroke();
  }
  // три широких зазубренных жвала, закрученных к центру
  const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, 100);
  grad.addColorStop(0, '#ffd766');
  grad.addColorStop(1, '#c8931d');
  ctx.fillStyle = grad;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 3);
    ctx.beginPath();
    ctx.moveTo(-4, -16);
    ctx.quadraticCurveTo(64, -34, 44, -88);
    // зазубрины на внешней кромке
    ctx.lineTo(30, -74);
    ctx.lineTo(34, -60);
    ctx.lineTo(20, -50);
    ctx.quadraticCurveTo(30, -34, 6, -30);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // сегментированное ядро
  ctx.fillStyle = '#e8b830';
  ctx.beginPath();
  ctx.arc(0, 0, 19, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#141006';
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 19, Math.sin(a) * 19);
    ctx.stroke();
  }
}

/** Иллюминаты: вертикальный глаз в трёх разорванных кольцах с лучами.
 *  Собственная композиция по мотивам чужой геометрии культа. */
function drawIlluminate(ctx: CanvasRenderingContext2D): void {
  // три концентрических разорванных кольца, повёрнутых друг к другу
  ctx.strokeStyle = '#8b5bd8';
  for (let k = 0; k < 3; k++) {
    const r = 108 - k * 17;
    ctx.lineWidth = 6 - k;
    const off = k * 1.1;
    for (let seg = 0; seg < 3; seg++) {
      const a0 = off + (seg / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, a0, a0 + Math.PI * 2 / 3 - 0.5);
      ctx.stroke();
    }
  }
  // косые лучи-иглы
  ctx.strokeStyle = '#c39bff';
  ctx.lineWidth = 4;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 52, Math.sin(a) * 52);
    ctx.lineTo(Math.cos(a) * 84, Math.sin(a) * 84);
    ctx.stroke();
  }
  // вертикальный миндалевидный глаз
  const grad = ctx.createLinearGradient(0, -56, 0, 56);
  grad.addColorStop(0, '#3c1a70');
  grad.addColorStop(1, '#1c0a3a');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, -56);
  ctx.quadraticCurveTo(40, -18, 40, 0);
  ctx.quadraticCurveTo(40, 18, 0, 56);
  ctx.quadraticCurveTo(-40, 18, -40, 0);
  ctx.quadraticCurveTo(-40, -18, 0, -56);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c39bff';
  ctx.lineWidth = 5;
  ctx.stroke();
  // вертикальный зрачок-щель со свечением
  ctx.fillStyle = '#efe4ff';
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8b5bd8';
  ctx.beginPath();
  ctx.ellipse(0, 0, 2.6, 22, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Супер-Федерация: расколотый щит со звездой — отражение СЗ в оранжевом. */
function drawFederation(ctx: CanvasRenderingContext2D): void {
  ring(ctx, '#ff8c1a');
  ctx.fillStyle = '#59300a';
  ctx.beginPath();
  ctx.moveTo(-58, -50);
  ctx.lineTo(58, -50);
  ctx.lineTo(58, 20);
  ctx.quadraticCurveTo(58, 64, 0, 88);
  ctx.quadraticCurveTo(-58, 64, -58, 20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ff8c1a';
  ctx.lineWidth = 7;
  ctx.stroke();
  // трещина раскола
  ctx.strokeStyle = '#ffd18a';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-6, -50);
  ctx.lineTo(10, -8);
  ctx.lineTo(-8, 12);
  ctx.lineTo(6, 56);
  ctx.stroke();
  ctx.fillStyle = '#ffd18a';
  star(ctx, 0, -24, 5, 17, 7);
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, points: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

const cache = new Map<FactionId, DynamicTexture>();
const urlCache = new Map<FactionId, string>();

function emblemCanvas(faction: FactionId): HTMLCanvasElement {
  const [cv, ctx] = makeCanvas();
  switch (faction) {
    case 'superEarth': drawSuperEarth(ctx); break;
    case 'automatons': drawAutomatons(ctx); break;
    case 'terminids': drawTerminids(ctx); break;
    case 'illuminate': drawIlluminate(ctx); break;
    case 'superFederation': drawFederation(ctx); break;
  }
  return cv;
}

/** Эмблема как data-URL — для DOM-интерфейса (флаг в шапке, досье). */
export function emblemDataURL(faction: FactionId): string {
  const cached = urlCache.get(faction);
  if (cached) return cached;
  const url = emblemCanvas(faction).toDataURL('image/png');
  urlCache.set(faction, url);
  return url;
}

export function emblemTexture(faction: FactionId, scene: Scene): DynamicTexture {
  const cached = cache.get(faction);
  if (cached) return cached;
  const cv = emblemCanvas(faction);
  const tex = new DynamicTexture(`emblem_${faction}`, { width: cv.width, height: cv.height }, scene, true);
  (tex.getContext() as CanvasRenderingContext2D).drawImage(cv, 0, 0);
  tex.update();
  tex.hasAlpha = true;
  tex.anisotropicFilteringLevel = 4;
  cache.set(faction, tex);
  return tex;
}

/** Эмблема родного мира, парящая над планетой лицом к камере. */
export function emblemSprite(faction: FactionId, scene: Scene): Mesh {
  const plane = CreatePlane(`emblem_${faction}`, { size: 0.42 }, scene);
  const mat = new StandardMaterial(`emblemMat_${faction}`, scene);
  const tex = emblemTexture(faction, scene);
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.disableDepthWrite = true;
  plane.material = mat;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  return plane;
}
