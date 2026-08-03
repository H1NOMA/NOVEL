import type { FocusNode } from '../core/types';
import { FACTIONS } from '../data/factions';

// ---------------------------------------------------------------------------
// Тематические эмблемы фокусов. Рисуются процедурно (канва) и подбираются по
// смыслу узла: боевые, флотские, промышленные, политические, спецпроекты…
// Тонируются в цвета фракции. Кэш — по мотиву и фракции.
// ---------------------------------------------------------------------------

type Motif =
  | 'crossed' | 'helmet' | 'gear' | 'fleet' | 'shield' | 'flag' | 'scales'
  | 'special' | 'gloom' | 'abyss' | 'fuel' | 'skull' | 'fed' | 'ark' | 'star' | 'territory';

/** Подбор мотива по ветке, эффектам и ключевым словам узла. */
function motifFor(node: FocusNode): Motif {
  if (node.branch === 'ark') return 'ark';
  if (node.branch === 'federation') return 'fed';
  for (const e of node.effects) {
    if (e.kind === 'spawnSuperFederation') return 'fed';
    if (e.kind === 'unlockSpecial') return 'special';
    if (e.kind === 'flag') {
      if (e.flag === 'gloomSpread' || e.flag === 'gloomTravel') return 'gloom';
      if (e.flag === 'abyss') return 'abyss';
      if (e.flag === 'e711Mining') return 'fuel';
      if (e.flag === 'termicide') return 'skull';
      return 'special';
    }
  }
  const kinds = new Set(node.effects.map((e) => e.kind));
  if (kinds.has('fleet') || kinds.has('shipCap')) return 'fleet';
  if (kinds.has('fortify')) return 'shield';
  if (kinds.has('industry')) return 'gear';
  if (kinds.has('stability')) return 'scales';
  if (kinds.has('recruitment') || kinds.has('manpower')) return 'helmet';
  if (kinds.has('combat')) return 'crossed';
  if (kinds.has('warSupport')) return 'flag';
  return 'star';
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, points: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

/** Нарисовать мотив в системе координат с центром (48,48), поле ~64. */
function drawMotif(ctx: CanvasRenderingContext2D, motif: Motif, accent: string): void {
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  switch (motif) {
    case 'crossed': // скрещённые клинки + звезда
      ctx.beginPath(); ctx.moveTo(26, 26); ctx.lineTo(70, 70); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(70, 26); ctx.lineTo(26, 70); ctx.stroke();
      star(ctx, 48, 48, 5, 12, 5);
      break;
    case 'helmet': // каска с прорезью визора
      ctx.beginPath(); ctx.arc(48, 52, 24, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillRect(24, 52, 48, 8);
      ctx.fillStyle = '#0b0f18';
      ctx.fillRect(32, 44, 32, 6);
      break;
    case 'gear': { // шестерня
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const r = i % 2 === 0 ? 26 : 19;
        const a = (i / 16) * Math.PI * 2;
        if (i === 0) ctx.moveTo(48 + Math.cos(a) * r, 48 + Math.sin(a) * r);
        else ctx.lineTo(48 + Math.cos(a) * r, 48 + Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#0b0f18';
      ctx.beginPath(); ctx.arc(48, 48, 9, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'fleet': // силуэт корабля-стрелы
      ctx.beginPath();
      ctx.moveTo(48, 20); ctx.lineTo(60, 52); ctx.lineTo(74, 66); ctx.lineTo(52, 60);
      ctx.lineTo(48, 72); ctx.lineTo(44, 60); ctx.lineTo(22, 66); ctx.lineTo(36, 52);
      ctx.closePath(); ctx.fill();
      break;
    case 'shield': // щит
      ctx.beginPath();
      ctx.moveTo(28, 28); ctx.lineTo(68, 28); ctx.lineTo(68, 50);
      ctx.quadraticCurveTo(68, 66, 48, 74); ctx.quadraticCurveTo(28, 66, 28, 50);
      ctx.closePath(); ctx.stroke();
      star(ctx, 48, 46, 5, 10, 4);
      break;
    case 'flag': // знамя
      ctx.beginPath(); ctx.moveTo(32, 22); ctx.lineTo(32, 74); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(32, 24); ctx.quadraticCurveTo(52, 18, 70, 26);
      ctx.lineTo(70, 44); ctx.quadraticCurveTo(52, 36, 32, 42); ctx.closePath(); ctx.fill();
      break;
    case 'scales': // весы
      ctx.beginPath(); ctx.moveTo(48, 24); ctx.lineTo(48, 70); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(26, 32); ctx.lineTo(70, 32); ctx.stroke();
      ctx.beginPath(); ctx.arc(30, 46, 10, 0, Math.PI, false); ctx.stroke();
      ctx.beginPath(); ctx.arc(66, 46, 10, 0, Math.PI, false); ctx.stroke();
      ctx.fillRect(38, 70, 20, 5);
      break;
    case 'special': // атом
      ctx.lineWidth = 3.5;
      for (const rot of [0, Math.PI / 3, -Math.PI / 3]) {
        ctx.save(); ctx.translate(48, 48); ctx.rotate(rot);
        ctx.beginPath(); ctx.ellipse(0, 0, 26, 11, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(48, 48, 6, 0, Math.PI * 2); ctx.fill();
      break;
    case 'gloom': // споровые тучи
      for (const [cx, cy, r] of [[36, 52, 14], [52, 44, 16], [64, 56, 12]] as const) {
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(30 + i * 10, 70, 2.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      break;
    case 'abyss': // ромб-глаз Бездны
      ctx.beginPath(); ctx.moveTo(48, 22); ctx.lineTo(70, 48); ctx.lineTo(48, 74); ctx.lineTo(26, 48);
      ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(48, 48, 8, 0, Math.PI * 2); ctx.fill();
      break;
    case 'fuel': // канистра Е-711
      ctx.beginPath();
      ctx.moveTo(48, 24);
      ctx.quadraticCurveTo(70, 50, 48, 74);
      ctx.quadraticCurveTo(26, 50, 48, 24);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#0b0f18';
      ctx.beginPath(); ctx.moveTo(50, 38); ctx.lineTo(42, 54); ctx.lineTo(48, 54); ctx.lineTo(44, 66);
      ctx.lineTo(56, 48); ctx.lineTo(50, 48); ctx.closePath(); ctx.fill();
      break;
    case 'skull': // череп (термицид)
      ctx.beginPath(); ctx.arc(48, 44, 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(38, 56, 20, 12);
      ctx.fillStyle = '#0b0f18';
      ctx.beginPath(); ctx.arc(41, 42, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(55, 42, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(44, 60, 3, 7); ctx.fillRect(50, 60, 3, 7);
      break;
    case 'fed': // расколотый щит Федерации
      ctx.beginPath();
      ctx.moveTo(28, 26); ctx.lineTo(68, 26); ctx.lineTo(68, 50);
      ctx.quadraticCurveTo(68, 66, 48, 74); ctx.quadraticCurveTo(28, 66, 28, 50);
      ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(46, 26); ctx.lineTo(52, 42); ctx.lineTo(44, 52); ctx.lineTo(50, 72); ctx.stroke();
      break;
    case 'ark': // Ковчег, восходящий из тьмы
      ctx.beginPath(); ctx.moveTo(48, 18); ctx.lineTo(62, 62); ctx.lineTo(48, 54); ctx.lineTo(34, 62);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 3;
      for (const dx of [-18, 0, 18]) {
        ctx.beginPath(); ctx.moveTo(48 + dx, 68); ctx.lineTo(48 + dx * 1.2, 78); ctx.stroke();
      }
      break;
    case 'territory': // флажок на планете
      ctx.beginPath(); ctx.arc(48, 58, 18, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(48, 58); ctx.lineTo(48, 26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(48, 26); ctx.lineTo(66, 32); ctx.lineTo(48, 38); ctx.closePath(); ctx.fill();
      break;
    case 'star':
    default:
      star(ctx, 48, 48, 5, 24, 10);
      break;
  }
}

const cache = new Map<string, string>();

/** Data-URL тематической эмблемы фокуса (96×96). */
export function focusIconURL(node: FocusNode): string {
  const motif = motifFor(node);
  const key = `${node.faction}_${motif}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const ctx = cv.getContext('2d')!;
  const def = FACTIONS[node.faction];

  // Подложка: тёмная плашка с виньеткой в цвет фракции.
  const grad = ctx.createRadialGradient(48, 42, 6, 48, 48, 62);
  grad.addColorStop(0, '#1b2740');
  grad.addColorStop(1, '#0b0f18');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(2, 2, 92, 92, 14);
  ctx.fill();
  ctx.strokeStyle = def.color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;

  drawMotif(ctx, motif, def.accent || def.color);

  const url = cv.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
