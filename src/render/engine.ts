import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// ---------------------------------------------------------------------------
// Общая обвязка движка.
//
// Игра ездит на Babylon.js: у него из коробки есть то, ради чего в прежнем
// рендере пришлось бы писать свои проходы, — слой свечения, конвейер
// постобработки с bloom/FXAA/виньеткой, честный PBR и тонкие инстансы.
// Здесь собрано только то, что нужно всем модулям рендера сразу.
//
// ГЛАВНОЕ РЕШЕНИЕ ПОРТА: сцена ПРАВОСТОРОННЯЯ.
//
// Babylon по умолчанию левосторонний, и это не косметика. Вся карта живёт в
// правосторонних координатах: планеты кладутся как (pos.x, 0, pos.y), сектора
// рисуются по углам через cos/sin, экранные оси панорамы выведены из yaw
// формулами (−sin, −cos) и (cos, −sin), а glTF по стандарту тоже правосторонний.
// В левосторонней сцене галактика вышла бы ЗЕРКАЛЬНОЙ: плиты секторов легли бы
// мимо своих планет, «вправо» на клавиатуре поехало бы влево, а импортёр
// подвесил бы каждой модели узел с масштабом −1 по X. Один флаг здесь дешевле,
// чем отрицание Z в шести файлах.
// ---------------------------------------------------------------------------

export interface EngineHost {
  engine: Engine;
  scene: Scene;
}

/** Движок и сцена под готовым canvas. Дальше их наполняет GalaxyScene. */
export function createEngine(canvas: HTMLCanvasElement): EngineHost {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    // Буфер глубины на 32 бита: карта тянется на сотни единиц, и на 24 битах
    // плиты секторов начинали спорить с линиями снабжения над ними.
    useHighPrecisionMatrix: true,
    powerPreference: 'high-performance',
  }, true);
  engine.setHardwareScalingLevel(1 / Math.min(2, window.devicePixelRatio));

  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  // Космос ровно чёрный: цвет ему дают галактический диск и туманности, то
  // есть настоящие объекты сцены, проходящие свет по общим правилам. Заливка,
  // поднятая до синевы, выцвечивала весь кадр и читалась как «мыло».
  scene.clearColor = new Color4(0, 0, 0, 1);
  scene.ambientColor = new Color3(0, 0, 0);
  // Сортировка прозрачного по расстоянию: у планеты до десятка полупрозрачных
  // оболочек (атмосфера, щит, дымка Мрака), и без неё они спорят за порядок.
  scene.setRenderingAutoClearDepthStencil(0, true);
  // Ничего не подсвечивать по наведению средствами движка — у карты своя
  // подсветка кольцами.
  scene.constantlyUpdateMeshUnderPointer = false;
  scene.skipPointerMovePicking = true;

  return { engine, scene };
}

/** «#rrggbb» → Color3. Общая точка перевода цветов фракций в движок. */
export function hexColor(hex: string): Color3 {
  return Color3.FromHexString(hex.startsWith('#') ? hex : `#${hex}`);
}

/**
 * Сдвиг цвета в HSL — тем же смыслом, что offsetHSL из прежнего рендера.
 * По нему каждая планета получает свой оттенок суши и моря из seed'а, поэтому
 * миры одного биома не выглядят копиями.
 */
export function offsetHSL(c: Color3, dH: number, dS: number, dL: number): Color3 {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  let s = 0;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6 : 0);
    else if (max === c.g) h = (c.b - c.r) / d + 2;
    else h = (c.r - c.g) / d + 4;
    h /= 6;
  }
  h = (h + dH + 1) % 1;
  s = Math.min(1, Math.max(0, s + dS));
  const nl = Math.min(1, Math.max(0, l + dL));
  if (s <= 1e-6) return new Color3(nl, nl, nl);
  const q = nl < 0.5 ? nl * (1 + s) : nl + s - nl * s;
  const p = 2 * nl - q;
  const hue = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return new Color3(hue(h + 1 / 3), hue(h), hue(h - 1 / 3));
}

/** Линейное смешение двух цветов — замена Color.lerp прежнего рендера. */
export function mixColor(a: Color3, b: Color3, t: number): Color3 {
  return new Color3(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

/**
 * Направление НА солнце в мировых координатах — ОДНО на всю карту.
 *
 * Прежде это был общий uniform-объект, который Three раздавал материалам по
 * ссылке. У Babylon ShaderMaterial значения копируются при setVector3, поэтому
 * солнце живёт здесь, а материалы читают его каждый кадр.
 */
export const SUN_DIR = new Vector3(0.48, 0.62, 0.62).normalize();

/** Повернуть общее солнце карты. */
export function setSunDirection(x: number, y: number, z: number): void {
  SUN_DIR.set(x, y, z);
  SUN_DIR.normalize();
}
