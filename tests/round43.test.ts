// Раунд 43: иконки подразделений и супероружия, единая геометрия карточек,
// рельефные меши миров из Blender.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TROOPS } from '../src/data/troops';
import { SPECIALS } from '../src/data/factions';
import { FACTION_IDS } from '../src/data/factions';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const ROOT = process.cwd();
const UNITS_DIR = join(ROOT, 'src', 'assets', 'units');
const PLANETS_DIR = join(ROOT, 'src', 'assets', 'planets');

function parseGlbJson(buf: Buffer): { asset?: { version?: string }; meshes?: unknown[] } {
  ok(buf.readUInt32LE(0) === 0x46546c67, 'магия glTF');
  ok(buf.readUInt32LE(8) === buf.length, 'длина файла сходится');
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

// --- У каждого подразделения и супероружия есть иконка ------------------------
{
  const files = new Set(readdirSync(UNITS_DIR).filter((f) => f.endsWith('.webp'))
    .map((f) => f.replace('.webp', '')));
  for (const t of TROOPS) {
    ok(files.has(t.id), `иконка подразделения ${t.id} (${t.name})`);
  }
  for (const f of FACTION_IDS) {
    const sp = SPECIALS[f];
    if (!sp) continue;
    ok(files.has(sp.id), `иконка супероружия ${sp.id} (${f})`);
  }
  // Каждая иконка — непустой WEBP с альфой (RIFF....WEBP).
  for (const id of files) {
    const buf = readFileSync(join(UNITS_DIR, `${id}.webp`));
    ok(buf.length > 1500, `${id}: иконка не пустышка (${buf.length} байт)`);
    ok(buf.length < 60_000, `${id}: иконка не раздута (${buf.length} байт)`);
    ok(buf.subarray(0, 4).toString('ascii') === 'RIFF', `${id}: контейнер RIFF`);
    ok(buf.subarray(8, 12).toString('ascii') === 'WEBP', `${id}: формат WEBP`);
  }
  console.log(`иконки подразделений: OK (${files.size} шт.)`);
}

// --- Иконки подключены к коду и в реестре нет лишних --------------------------
{
  const src = readFileSync(join(ROOT, 'src', 'render', 'unitIcons.ts'), 'utf8');
  const files = readdirSync(UNITS_DIR).filter((f) => f.endsWith('.webp'));
  for (const f of files) {
    ok(src.includes(f), `unitIcons импортирует ${f}`);
  }
  const imports = src.match(/\.webp\?url/g) ?? [];
  ok(imports.length === files.length, `импортов ровно по числу файлов (${imports.length})`);
}

// --- Карточки сил: единая геометрия, без «широкой» карточки -------------------
{
  const ui = readFileSync(join(ROOT, 'src', 'ui', 'ui.ts'), 'utf8');
  ok(!ui.includes('wide-card'), 'широкая карточка супероружия убрана');
  ok(ui.includes('unitIcon(t.id)'), 'карточка войск берёт иконку');
  ok(ui.includes('unitIcon(sp.id)'), 'карточка супероружия берёт иконку');
  ok(ui.includes('fc-art'), 'иконка вставляется как изображение');

  const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8');
  ok(!css.includes('.force-card.wide-card'), 'CSS широкой карточки убран');
  ok(/\.force-card\.static\s*\{\s*cursor:\s*default;\s*\}/.test(css),
    'static больше не меняет ширину и выравнивание');
  ok(css.includes('.fc-art'), 'стиль иконки на месте');
}

// --- Рельефные меши миров -----------------------------------------------------
{
  const expected = ['mountain', 'crater', 'dune', 'fracture', 'volcanic', 'smooth',
    'ring', 'moon', 'asteroid'];
  const files = readdirSync(PLANETS_DIR).filter((f) => f.endsWith('.glb'));
  ok(files.length === expected.length, `мешей миров ${expected.length} (нашлось ${files.length})`);
  for (const name of expected) {
    const buf = readFileSync(join(PLANETS_DIR, `${name}.glb`));
    ok(buf.length > 20_000, `${name}: меш не пустышка (${buf.length} байт)`);
    ok(buf.length < 400_000, `${name}: меш не раздут (${buf.length} байт)`);
    const json = parseGlbJson(buf);
    ok(json.asset?.version === '2.0', `${name}: glTF 2.0`);
    ok((json.meshes?.length ?? 0) >= 1, `${name}: есть геометрия`);
  }
  console.log(`меши миров: OK (${expected.length} файлов)`);
}

// --- Интеграция рельефа -------------------------------------------------------
{
  const assets = readFileSync(join(ROOT, 'src', 'render', 'planetAssets.ts'), 'utf8');
  ok((assets.match(/\.glb\?url/g) ?? []).length === 9, 'planetAssets импортирует все меши');
  ok(assets.includes('computeVertexNormals'), 'нормали считаются в рантайме');

  const mesh = readFileSync(join(ROOT, 'src', 'render', 'planetMesh.ts'), 'utf8');
  ok(mesh.includes('reliefGeometry('), 'меш планеты берёт рельеф');
  ok(mesh.includes('setRelief('), 'есть переключатель геометрического LOD');
  ok(mesh.includes('new THREE.Mesh(SPHERE_GEO, material)'),
    'стартует с гладкой сферы — иначе на общем плане рельеф мерцает');
  ok(mesh.includes('spinSpeed * dt * 60'), 'вращение развязано с частотой кадров');
  ok(/axis\.rotation\.set\(/.test(mesh), 'наклон оси вынесен на родителя (нет прецессии)');
  ok(mesh.includes('ringGeometry()') && mesh.includes('moonGeometry()'),
    'кольца и луны подключены');

  const scene = readFileSync(join(ROOT, 'src', 'render', 'scene.ts'), 'utf8');
  ok(scene.includes('setRelief(wantRelief)'), 'сцена переключает рельеф по дистанции');
  ok(scene.includes('lodRelief'), 'состояние LOD рельефа отслеживается');

  const main = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
  ok(main.includes('preloadPlanetModels()'), 'меши миров грузятся до старта сцены');
}

console.log(`round43: OK (${checks} проверок)`);
