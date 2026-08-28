// Раунд 57: перенос рендера на Babylon.js.
//
// Смысл проверок здесь один: движок сменился, а игра — нет. Поэтому суть
// файла — не «Babylon подключён», а «ничего не потеряно»: публичный контракт
// сцены прежний, шейдеры поверхности перенесены дословно, симуляция движка
// по-прежнему не знает, и прежний движок ушёл целиком, без хвостов.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame } from '../src/game/state';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}
const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');

// --- Прежнего движка не осталось нигде ------------------------------------------
{
  const pkg = JSON.parse(read('package.json')) as {
    dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  ok(!deps.three && !deps['@types/three'], 'three.js убран из зависимостей');
  ok(!!deps['@babylonjs/core'] && !!deps['@babylonjs/loaders'], 'Babylon подключён');
  ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
    'у игры по-прежнему нет зависимостей во время работы');

  for (const f of ['scene.ts', 'planetMesh.ts', 'planetShaders.ts', 'starfield.ts', 'fleets.ts',
    'ships.ts', 'shipAssets.ts', 'planetAssets.ts', 'emblems.ts', 'gltf.ts', 'engine.ts']) {
    const src = read('src', 'render', f);
    ok(!/from 'three/.test(src) && !src.includes('THREE.'),
      `${f}: обращений к прежнему движку не осталось`);
  }
  const vite = read('vite.config.ts');
  ok(!vite.includes("['three']"), 'отдельный чанк прежнего движка убран из сборки');
  ok(vite.includes('@babylonjs'), 'движок выносится в свой чанк');
  console.log('прежний движок убран: OK');
}

// --- Публичный контракт сцены не изменился --------------------------------------
{
  const scene = read('src', 'render', 'scene.ts');
  // Ровно то, что зовёт интерфейс и main.ts. Пропажа любого пункта — это
  // сломанный интерфейс, а не просто отсутствующий метод.
  for (const m of ['attachHotkeys(', 'focusOn(', 'refreshOwners(', 'setBloomEnabled(',
    'setBoxSelected(', 'setFactionSpotlight(', 'setQuality(', 'setSelected(',
    'startCinema(', 'stopCinema(', 'render(', 'resize(', 'planetsInRect(', 'setHovered(']) {
    ok(scene.includes(m), `контракт сцены сохранён: ${m}`);
  }
  ok(scene.includes('export const GALAXY_SCALE'), 'масштаб карты по-прежнему экспортируется');

  // Интерфейс не должен был поменяться ни на строку из-за смены движка.
  const ui = read('src', 'ui', 'ui.ts');
  ok(!ui.includes('@babylonjs') && !ui.includes('THREE.'),
    'интерфейс не знает, на чём рисуется карта');
  const main = read('src', 'main.ts');
  ok(main.includes('scene.render()'), 'кадр по-прежнему рисует общий цикл игры');
  ok(main.includes('preloadShipModels()') && main.includes('preloadPlanetModels()'),
    'модели грузятся до старта сцены — порядок запуска сохранён');
  console.log('контракт сцены: OK');
}

// --- Шейдеры поверхности перенесены дословно -------------------------------------
{
  const sh = read('src', 'render', 'planetShaders.ts');
  // Ядро процедурной поверхности: если что-то из этого потерялось, миры
  // потеряют вид, а тесты прежних раундов этого могут и не заметить.
  for (const frag of ['float snoise(vec3 v)', 'float fbm(vec3 p)', 'float ridged(',
    'float grit(', 'float band(float freq, float fw)', 'gOct = clamp(log2(',
    'const float WRAP', 'vec3 skyAmb', 'ringShadow', 'float mountains = ridged(',
    'uIce > 0.5', 'uLava > 0.5', 'uCity > 0.5', 'uBattle > 0.5', 'uScar > 0.5']) {
    ok(sh.includes(frag), `шейдер поверхности сохранён: ${frag}`);
  }
  // Babylon сам подставляет значение cameraPosition, но НЕ объявляет его.
  ok((sh.match(/uniform vec3 cameraPosition;/g) ?? []).length === 2,
    'камера объявлена в обоих фрагментных шейдерах');
  ok(sh.includes('mat3(world) * normal'), 'нормаль переводится в мир матрицей движка');
  ok(sh.includes('worldViewProjection * vec4(position, 1.0)'),
    'вершина проецируется одной матрицей движка');
  console.log('шейдеры перенесены: OK');
}

// --- Решения, без которых картинка разъезжается ----------------------------------
{
  const eng = read('src', 'render', 'engine.ts');
  // Левосторонняя сцена дала бы ЗЕРКАЛЬНУЮ галактику: плиты секторов легли бы
  // мимо своих планет, а «вправо» на клавиатуре поехало бы влево.
  ok(eng.includes('scene.useRightHandedSystem = true'), 'сцена правосторонняя');

  const mesh = read('src', 'render', 'planetMesh.ts');
  // Ближняя полусфера оболочки добавила бы поверх свой ореол — аддитивно,
  // вдвое ярче, — и тонкая кайма превратилась бы в молочный пузырь.
  ok(mesh.includes('atmo.flipFaces(false)'), 'у атмосферы рисуется только дальняя полусфера');

  const scene = read('src', 'render', 'scene.ts');
  // Счётчик кадров движка ведёт его собственный цикл отрисовки, а цикл здесь
  // общий на игру: на нуле замерло бы всё, что движется.
  ok(scene.includes('performance.now()') && !scene.includes('this.engine.getDeltaTime()'),
    'время кадра игра меряет сама, а не берёт у движка');
  ok(scene.includes('this.engine.beginFrame()') && scene.includes('this.engine.endFrame()'),
    'кадр обрамлён вызовами движка');
  console.log('решения переноса: OK');
}

// --- Симуляция не заметила смены движка ------------------------------------------
{
  // Тот же сид обязан дать ту же галактику: генерация мира к рендеру не
  // привязана, и перенос не имел права её сдвинуть.
  const a = createGame(20260828, 'superEarth');
  const b = createGame(20260828, 'superEarth');
  ok(a.galaxy.order.length === b.galaxy.order.length && a.galaxy.order.length > 150,
    `галактика прежнего размера (${a.galaxy.order.length})`);
  ok(a.galaxy.order.every((id, i) => id === b.galaxy.order[i]), 'порядок миров детерминирован');
  for (const id of a.galaxy.order) {
    const pa = a.galaxy.planets.get(id)!;
    const pb = b.galaxy.planets.get(id)!;
    ok(pa.name === pb.name && pa.owner === pb.owner && pa.biome === pb.biome
      && pa.seed === pb.seed && pa.pos.x === pb.pos.x && pa.pos.y === pb.pos.y,
      `мир ${id} совпадает при том же сиде`);
  }

  // Ни один файл симуляции не должен знать о движке или о DOM.
  for (const f of ['state.ts', 'combat.ts', 'troops.ts', 'shipyards.ts', 'supply.ts',
    'galaxy.ts', 'illuminate.ts', 'construction.ts', 'ai.ts']) {
    const src = read('src', 'game', f);
    ok(!src.includes('@babylonjs') && !src.includes('THREE.') && !src.includes('document.'),
      `src/game/${f}: симуляция не знает ни о движке, ни о DOM`);
  }
  console.log('симуляция не тронута: OK');
}

console.log(`round57: OK (${checks} проверок)`);
