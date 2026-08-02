import * as THREE from 'three';
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

/** Супер-Земля: щит, взмывающий орёл-стрела и звезда сверху. */
function drawSuperEarth(ctx: CanvasRenderingContext2D): void {
  ring(ctx, '#3fa9f5');
  // щит
  ctx.fillStyle = '#123a63';
  ctx.beginPath();
  ctx.moveTo(-62, -52);
  ctx.lineTo(62, -52);
  ctx.lineTo(62, 22);
  ctx.quadraticCurveTo(62, 68, 0, 92);
  ctx.quadraticCurveTo(-62, 68, -62, 22);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3fa9f5';
  ctx.lineWidth = 7;
  ctx.stroke();
  // крылья-стрела
  ctx.fillStyle = '#e9f2ff';
  ctx.beginPath();
  ctx.moveTo(0, 44);
  ctx.lineTo(-52, 6);
  ctx.lineTo(-20, 6);
  ctx.lineTo(0, 26);
  ctx.lineTo(20, 6);
  ctx.lineTo(52, 6);
  ctx.closePath();
  ctx.fill();
  // звезда
  ctx.fillStyle = '#ffe14d';
  star(ctx, 0, -22, 5, 20, 8);
}

/** Автоматоны: зубчатое кольцо-шестерня и багровый немигающий глаз. */
function drawAutomatons(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#5a1512';
  ctx.strokeStyle = '#e0342b';
  ctx.lineWidth = 9;
  // шестерня
  const teeth = 12;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? 106 : 86;
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // глаз
  ctx.fillStyle = '#0c0505';
  ctx.beginPath();
  ctx.arc(0, 0, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff3b26';
  ctx.beginPath();
  ctx.ellipse(0, 0, 40, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd9a0';
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
}

/** Терминиды: три серповидных когтя роя, сходящихся к центру. */
function drawTerminids(ctx: CanvasRenderingContext2D): void {
  ring(ctx, '#e8b830');
  ctx.fillStyle = '#e8b830';
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 3);
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.quadraticCurveTo(52, -66, 14, -96);
    ctx.quadraticCurveTo(36, -60, -6, -34);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.fill();
}

/** Иллюминаты: ромбический глаз с расходящимися лучами. */
function drawIlluminate(ctx: CanvasRenderingContext2D): void {
  ring(ctx, '#8b5bd8');
  ctx.strokeStyle = '#c39bff';
  ctx.lineWidth = 6;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 60, Math.sin(a) * 60);
    ctx.lineTo(Math.cos(a) * 92, Math.sin(a) * 92);
    ctx.stroke();
  }
  ctx.fillStyle = '#2a1052';
  ctx.beginPath();
  ctx.moveTo(0, -52);
  ctx.lineTo(46, 0);
  ctx.lineTo(0, 52);
  ctx.lineTo(-46, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8b5bd8';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.fillStyle = '#e8dcff';
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
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

const cache = new Map<FactionId, THREE.Texture>();
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

export function emblemTexture(faction: FactionId): THREE.Texture {
  const cached = cache.get(faction);
  if (cached) return cached;
  const tex = new THREE.CanvasTexture(emblemCanvas(faction));
  tex.anisotropy = 4;
  cache.set(faction, tex);
  return tex;
}

/** Спрайт-эмблема родного мира, парящая над планетой. */
export function emblemSprite(faction: FactionId): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: emblemTexture(faction),
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(0.42);
  return sprite;
}
