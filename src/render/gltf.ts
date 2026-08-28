import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/loaders/glTF/2.0';

// ---------------------------------------------------------------------------
// Чтение GLB в чистые данные вершин.
//
// Модели из Blender нужны игре не как готовые узлы сцены, а как ЗАГОТОВКИ:
// один и тот же корпус эсминца достаётся десяткам соединений, одна и та же
// горная порода — десяткам миров, и каждый лепит из неё свой меш со своим
// материалом. Поэтому импортированная сцена сразу разбирается на VertexData и
// выбрасывается: в памяти остаются только массивы.
//
// Заодно здесь схлопываются десятки деталей модели в ≤6 наборов — по одному на
// материал. Иначе каждый флот стоил бы сотни вызовов отрисовки.
//
// Загрузка идёт в СВОЮ безголовую сцену на NullEngine, а не в игровую. Так
// сохраняется порядок запуска: модели грузятся за экраном загрузки, ДО того
// как появится canvas и настоящая сцена, — а на выходе всё равно получаются
// массивы чисел, которым движок уже не нужен.
// ---------------------------------------------------------------------------

let loaderScene: Scene | null = null;
function scratchScene(): Scene {
  if (!loaderScene) loaderScene = new Scene(new NullEngine());
  return loaderScene;
}

export interface ShapePart {
  /** Имя материала из Blender: hull / dark / accent / glow / organic / organicDark. */
  name: string;
  data: VertexData;
}

/** Слить несколько наборов вершин в один (индексы сдвигаются). */
function mergeParts(list: VertexData[]): VertexData {
  const out = new VertexData();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let base = 0;
  for (const vd of list) {
    const p = vd.positions ?? [];
    const n = vd.normals ?? [];
    for (let i = 0; i < p.length; i++) positions.push(p[i]!);
    for (let i = 0; i < n.length; i++) normals.push(n[i]!);
    for (const idx of vd.indices ?? []) indices.push(idx + base);
    base += p.length / 3;
  }
  out.positions = positions;
  // Нормали берутся только если они есть у КАЖДОЙ детали: неполный набор
  // сломал бы соответствие вершин и нормалей после слияния.
  out.normals = normals.length === positions.length ? normals : null;
  out.indices = indices;
  return out;
}

/**
 * Разобрать GLB на наборы вершин по имени материала.
 *
 * Геометрия приводится к мировым координатам модели: в Blender детали стоят
 * на своих местах трансформациями узлов, и без запекания корабль рассыпался бы
 * в кучу деталей в начале координат.
 */
export async function loadVertexData(url: string): Promise<ShapePart[]> {
  const container = await LoadAssetContainerAsync(url, scratchScene());
  const byMat = new Map<string, VertexData[]>();
  for (const node of container.meshes) {
    if (!(node instanceof Mesh) || node.getTotalVertices() === 0) continue;
    node.computeWorldMatrix(true);
    const vd = VertexData.ExtractFromMesh(node, false, false);
    // Трансформация узла запекается в вершины.
    const m = node.getWorldMatrix();
    if (!m.isIdentity()) vd.transform(m as Matrix);
    const name = (node.material?.name ?? 'hull').replace(/\.\d+$/, '');
    if (!byMat.has(name)) byMat.set(name, []);
    byMat.get(name)!.push(vd);
  }
  container.dispose();
  return [...byMat].map(([name, list]) => ({ name, data: mergeParts(list) }));
}
