import type { FactionId } from '../core/types';

// ---------------------------------------------------------------------------
// Портреты правителей фракций. Полностью оригинальная стилизованная графика
// (канва): силуэт-бюст в цветах фракции на фоне лучей — «официальное фото»
// для досье. Никаких заимствованных изображений.
// ---------------------------------------------------------------------------

export interface Ruler {
  name: string;
  title: string;
}

export const RULERS: Record<FactionId, Ruler> = {
  superEarth: { name: 'Президент Аделаида Ривас', title: 'Верховный лидер Управляемой Демократии' },
  automatons: { name: 'РАЗУМ-9', title: 'Центральный вычислитель легионов' },
  terminids: { name: 'Мать-Королева выводка', title: 'Сердце бесконечного роя' },
  illuminate: { name: 'Верховный Пророк Ат\'уул', title: 'Голос Великого флота' },
  superFederation: { name: 'Канцлер Дариус Конкорд', title: 'Глава отколовшихся колоний' },
};

const COLORS: Record<FactionId, { bg: string; skin: string; suit: string; accent: string }> = {
  superEarth: { bg: '#0d2a4a', skin: '#e8c39a', suit: '#16406e', accent: '#3fa9f5' },
  automatons: { bg: '#2a0c0a', skin: '#8a8f99', suit: '#3d1210', accent: '#ff3b26' },
  terminids: { bg: '#3a2c07', skin: '#c9a23a', suit: '#57430e', accent: '#e8b830' },
  illuminate: { bg: '#1d0c3a', skin: '#a98fd6', suit: '#2a1052', accent: '#c39bff' },
  superFederation: { bg: '#3a2208', skin: '#e8c39a', suit: '#59300a', accent: '#ff8c1a' },
};

function rays(ctx: CanvasRenderingContext2D, accent: string): void {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 7;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(110 + Math.cos(a) * 46, 92 + Math.sin(a) * 46);
    ctx.lineTo(110 + Math.cos(a) * 150, 92 + Math.sin(a) * 150);
    ctx.stroke();
  }
  ctx.restore();
}

/** Человеческий бюст: китель с высоким воротом, волевое лицо. */
function drawHuman(ctx: CanvasRenderingContext2D, c: (typeof COLORS)['superEarth'], opts: { hair: string; cape?: boolean }): void {
  // китель
  ctx.fillStyle = c.suit;
  ctx.beginPath();
  ctx.moveTo(30, 220);
  ctx.quadraticCurveTo(38, 150, 110, 142);
  ctx.quadraticCurveTo(182, 150, 190, 220);
  ctx.closePath();
  ctx.fill();
  // погоны/ворот
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(72, 168);
  ctx.lineTo(110, 190);
  ctx.lineTo(148, 168);
  ctx.stroke();
  // шея и голова
  ctx.fillStyle = c.skin;
  ctx.fillRect(96, 118, 28, 28);
  ctx.beginPath();
  ctx.ellipse(110, 92, 34, 40, 0, 0, Math.PI * 2);
  ctx.fill();
  // волосы
  ctx.fillStyle = opts.hair;
  ctx.beginPath();
  ctx.ellipse(110, 68, 34, 22, 0, Math.PI, 0);
  ctx.fill();
  // глаза и рот
  ctx.fillStyle = '#20222a';
  ctx.fillRect(94, 88, 10, 4);
  ctx.fillRect(116, 88, 10, 4);
  ctx.fillRect(100, 110, 20, 3);
  // орденская планка
  ctx.fillStyle = c.accent;
  ctx.fillRect(66, 196, 30, 8);
  ctx.fillStyle = '#ffe14d';
  ctx.fillRect(100, 196, 12, 8);
}

/** Автоматоны: стальной череп-процессор с багровым окуляром. */
function drawMachine(ctx: CanvasRenderingContext2D, c: (typeof COLORS)['automatons']): void {
  ctx.fillStyle = c.suit;
  ctx.beginPath();
  ctx.moveTo(34, 220);
  ctx.quadraticCurveTo(48, 156, 110, 150);
  ctx.quadraticCurveTo(172, 156, 186, 220);
  ctx.closePath();
  ctx.fill();
  // голова-корпус
  ctx.fillStyle = c.skin;
  ctx.beginPath();
  ctx.roundRect(76, 48, 68, 96, 10);
  ctx.fill();
  ctx.strokeStyle = '#3c4048';
  ctx.lineWidth = 4;
  ctx.stroke();
  // окуляр
  ctx.fillStyle = '#16090a';
  ctx.beginPath();
  ctx.arc(110, 92, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.arc(110, 92, 11, 0, Math.PI * 2);
  ctx.fill();
  // решётка-вокодер
  ctx.strokeStyle = '#3c4048';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(92, 120 + i * 7);
    ctx.lineTo(128, 120 + i * 7);
    ctx.stroke();
  }
  // антенны
  ctx.strokeStyle = c.accent;
  ctx.beginPath(); ctx.moveTo(80, 52); ctx.lineTo(66, 26); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(140, 52); ctx.lineTo(154, 26); ctx.stroke();
}

/** Терминиды: хитиновая голова королевы с мандибулами. */
function drawQueen(ctx: CanvasRenderingContext2D, c: (typeof COLORS)['terminids']): void {
  ctx.fillStyle = c.suit;
  ctx.beginPath();
  ctx.moveTo(30, 220);
  ctx.quadraticCurveTo(52, 158, 110, 152);
  ctx.quadraticCurveTo(168, 158, 190, 220);
  ctx.closePath();
  ctx.fill();
  // голова
  ctx.fillStyle = c.skin;
  ctx.beginPath();
  ctx.ellipse(110, 96, 40, 50, 0, 0, Math.PI * 2);
  ctx.fill();
  // фасеточные глаза
  ctx.fillStyle = '#1c1206';
  ctx.beginPath(); ctx.ellipse(90, 86, 12, 17, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(130, 86, 12, 17, 0.3, 0, Math.PI * 2); ctx.fill();
  // мандибулы
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(88, 132); ctx.quadraticCurveTo(74, 152, 88, 168); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(132, 132); ctx.quadraticCurveTo(146, 152, 132, 168); ctx.stroke();
  // рога-антенны
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(88, 52); ctx.quadraticCurveTo(70, 24, 84, 10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(132, 52); ctx.quadraticCurveTo(150, 24, 136, 10); ctx.stroke();
}

/** Иллюминаты: пророк под капюшоном, светящиеся глаза, щупальца. */
function drawProphet(ctx: CanvasRenderingContext2D, c: (typeof COLORS)['illuminate']): void {
  // мантия с капюшоном
  ctx.fillStyle = c.suit;
  ctx.beginPath();
  ctx.moveTo(28, 220);
  ctx.quadraticCurveTo(36, 130, 78, 74);
  ctx.quadraticCurveTo(110, 40, 142, 74);
  ctx.quadraticCurveTo(184, 130, 192, 220);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 4;
  ctx.stroke();
  // тьма под капюшоном
  ctx.fillStyle = '#0d0620';
  ctx.beginPath();
  ctx.ellipse(110, 100, 30, 36, 0, 0, Math.PI * 2);
  ctx.fill();
  // глаза
  ctx.fillStyle = c.accent;
  ctx.beginPath(); ctx.arc(98, 96, 6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(122, 96, 6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(110, 82, 4, 0, Math.PI * 2); ctx.fill();
  // щупальца из-под капюшона
  ctx.strokeStyle = c.skin;
  ctx.lineWidth = 7;
  for (const [x0, dx] of [[92, -14], [110, 0], [128, 14]] as const) {
    ctx.beginPath();
    ctx.moveTo(x0, 128);
    ctx.quadraticCurveTo(x0 + dx, 152, x0 + dx * 1.6, 172);
    ctx.stroke();
  }
}

const cache = new Map<FactionId, string>();

/** «Официальное фото» правителя фракции (data-URL, 220×220). */
export function portraitDataURL(faction: FactionId): string {
  const cached = cache.get(faction);
  if (cached) return cached;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 220;
  const ctx = cv.getContext('2d')!;
  const c = COLORS[faction];
  // фон с виньеткой
  const grad = ctx.createRadialGradient(110, 92, 20, 110, 110, 160);
  grad.addColorStop(0, c.bg);
  grad.addColorStop(1, '#05070f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 220, 220);
  rays(ctx, c.accent);
  switch (faction) {
    case 'superEarth': drawHuman(ctx, c, { hair: '#5a3a22' }); break;
    case 'superFederation': drawHuman(ctx, c, { hair: '#8a8f99' }); break;
    case 'automatons': drawMachine(ctx, c); break;
    case 'terminids': drawQueen(ctx, c); break;
    case 'illuminate': drawProphet(ctx, c); break;
  }
  // рамка
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, 214, 214);
  const url = cv.toDataURL('image/png');
  cache.set(faction, url);
  return url;
}
