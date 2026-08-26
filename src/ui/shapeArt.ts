import type { GalaxyShape } from '../game/galaxyShapes';
import disc from '../assets/galaxy/disc.webp';
import spiral from '../assets/galaxy/spiral.webp';
import ring from '../assets/galaxy/ring.webp';
import clusters from '../assets/galaxy/clusters.webp';
import bar from '../assets/galaxy/bar.webp';

// ---------------------------------------------------------------------------
// Превью форм галактики.
//
// Это не рисунки, а НАСТОЯЩИЕ снимки соответствующих галактик: игра
// запускается с каждой формой, камера уводится в зенит, интерфейс гасится, и
// кадр сохраняется (tools/shapeshots.mjs). Поэтому на карточке видно ровно то,
// что игрок получит, начав партию, — и ни одного элемента интерфейса.
// ---------------------------------------------------------------------------

export const SHAPE_ART: Record<GalaxyShape, string> = {
  disc, spiral, ring, clusters, bar,
};
