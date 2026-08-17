// Раунд 42: Blender-пайплайн. Проверяем, что все 13 GLB-моделей на месте,
// структурно валидны (glTF 2.0), несут меши и материалы из контракта
// hull/dark/accent/glow/organic/organicDark, а интеграция подключена.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const ROOT = process.cwd(); // тесты запускаются из корня репозитория
const SHIPS_DIR = join(ROOT, 'src', 'assets', 'ships');

const EXPECTED = [
  'se_destroyer', 'se_dreadnought', 'se_battleship',
  'aut_destroyer', 'aut_dreadnought', 'aut_battleship',
  'ill_destroyer', 'ill_dreadnought', 'ill_battleship',
  'trm_destroyer', 'trm_dreadnought', 'trm_battleship',
  'station',
];
const MATERIAL_CONTRACT = new Set(['hull', 'dark', 'accent', 'glow', 'organic', 'organicDark']);

interface GltfJson {
  asset?: { version?: string };
  meshes?: unknown[];
  materials?: { name?: string }[];
}

function parseGlb(buf: Buffer): GltfJson {
  ok(buf.readUInt32LE(0) === 0x46546c67, 'магия glTF');
  ok(buf.readUInt32LE(4) === 2, 'версия контейнера 2');
  ok(buf.readUInt32LE(8) === buf.length, 'длина файла сходится');
  const jsonLen = buf.readUInt32LE(12);
  ok(buf.readUInt32LE(16) === 0x4e4f534a, 'первый чанк — JSON');
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as GltfJson;
}

// --- Все модели на месте и валидны -------------------------------------------
{
  const files = readdirSync(SHIPS_DIR).filter((f) => f.endsWith('.glb')).sort();
  ok(files.length === EXPECTED.length, `моделей ${EXPECTED.length} (нашлось ${files.length})`);
  for (const name of EXPECTED) {
    const path = join(SHIPS_DIR, `${name}.glb`);
    const buf = readFileSync(path);
    ok(buf.length > 20_000, `${name}: не пустышка (${buf.length} байт)`);
    ok(buf.length < 500_000, `${name}: не раздут (${buf.length} байт)`);
    const json = parseGlb(buf);
    ok(json.asset?.version === '2.0', `${name}: glTF 2.0`);
    ok((json.meshes?.length ?? 0) >= 5, `${name}: есть геометрия (${json.meshes?.length} мешей)`);
    const mats = (json.materials ?? []).map((m) => (m.name ?? '').replace(/\.\d+$/, ''));
    ok(mats.length > 0, `${name}: есть материалы`);
    for (const m of mats) {
      ok(MATERIAL_CONTRACT.has(m), `${name}: материал «${m}» из контракта`);
    }
    ok(mats.includes('accent') || mats.includes('glow'), `${name}: есть акцент/свечение`);
  }
  console.log(`GLB-модели: OK (${EXPECTED.length} файлов)`);
}

// --- Интеграция подключена ----------------------------------------------------
{
  const assets = readFileSync(join(ROOT, 'src', 'render', 'shipAssets.ts'), 'utf8');
  const imports = assets.match(/\.glb\?url/g) ?? [];
  ok(imports.length === EXPECTED.length, `shipAssets импортирует все модели (${imports.length})`);

  const ships = readFileSync(join(ROOT, 'src', 'render', 'ships.ts'), 'utf8');
  ok(ships.includes('shipAsset('), 'ships.ts использует GLB с фолбэком');
  ok(ships.includes('stationAsset('), 'станция использует GLB с фолбэком');

  const main = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
  // Загрузка идёт вместе с мешами миров (раунд 43), поэтому проверяем
  // не дословный вызов, а факт ожидания до startGame.
  ok(/await[\s\S]{0,80}preloadShipModels\(\)/.test(main), 'модели грузятся до старта сцены');

  const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8');
  ok(css.includes('keyart.webp'), 'ключевой арт подключён к экрану загрузки');
}

console.log(`round42: OK (${checks} проверок)`);
