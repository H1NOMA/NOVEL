// Раунд 39: игра за любую фракцию + уникальные эффекты фокусов.
import { createGame, fleetsOf, planetsOf, spawnFleet } from '../src/game/state';
import { selectFocus, stepFocus } from '../src/game/focus';
import { FOCUS_TREES } from '../src/data/focus';
import { FACTION_IDS, FACTIONS } from '../src/data/factions';
import { reconActive } from '../src/game/specops';
import { truceActive } from '../src/game/diplomacy';
import type { FactionId } from '../src/core/types';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

/** Мгновенно завершить фокус (обходя таймер, но через штатный applyEffect). */
function rushFocus(state: ReturnType<typeof createGame>, faction: FactionId, id: string): boolean {
  // Открываем все требования напрямую — тестируем сам эффект.
  const node = FOCUS_TREES[faction].find((n) => n.id === id)!;
  for (const req of node.requires) {
    if (!state.factions[faction].completedFocus.includes(req)) {
      state.factions[faction].completedFocus.push(req);
    }
  }
  if (!selectFocus(state, faction, id)) return false;
  state.factions[faction].activeFocus!.remaining = 0.5;
  stepFocus(state, faction);
  return state.factions[faction].completedFocus.includes(id);
}

// --- Игра за каждую играбельную фракцию --------------------------------------
{
  for (const fid of FACTION_IDS.filter((f) => FACTIONS[f].playable)) {
    const s = createGame(101, fid);
    ok(s.player === fid, `игрок — ${fid}`);
    ok(s.factions[fid].politicalPower >= 30, `${fid}: стартовая политвласть`);
    ok(planetsOf(s, fid).length > 0, `${fid}: есть стартовые миры`);
  }
  console.log('выбор фракции: OK');
}

// --- Уникальные эффекты фокусов ----------------------------------------------
{
  const s = createGame(103, 'automatons');
  const aut = s.factions.automatons;

  // heavyFleet: «Флагманы Прайма» — новое соединение с тяжёлыми классами.
  const fleetsBefore = fleetsOf(s, 'automatons').length;
  ok(rushFocus(s, 'automatons', 'aut_prime_fleet'), 'фокус «Флагманы Прайма» завершён');
  const fleets = fleetsOf(s, 'automatons');
  ok(fleets.length === fleetsBefore + 1, 'тяжёлое соединение создано');
  const hf = fleets[fleets.length - 1]!;
  ok(hf.dreadnoughts === 2 && hf.battleships === 2, `дредноуты и линкоры на месте (${hf.dreadnoughts}/${hf.battleships})`);

  // production + resources: «Холодный расчёт».
  const prodBefore = aut.production;
  const minBefore = aut.resources.minerals;
  ok(rushFocus(s, 'automatons', 'aut_cold_calc'), 'фокус «Холодный расчёт» завершён');
  ok(aut.production >= prodBefore + 119, 'производство начислено');
  ok(aut.resources.minerals >= minBefore + 39, 'руда начислена');

  // fortifyAll + garrisonAll: «Тотальная переплавка».
  const world = planetsOf(s, 'automatons')[0]!;
  const fortBefore = world.fortification;
  const garBefore = world.garrison;
  ok(rushFocus(s, 'automatons', 'aut_replicate'), 'фокус «Тотальная переплавка» завершён');
  ok(world.fortification === Math.min(5, fortBefore + 1), 'укрепления выросли');
  ok(world.garrison >= garBefore + 11, 'гарнизон вырос');

  // revealAll: «Сеть слежения РАЗУМ».
  ok(rushFocus(s, 'automatons', 'aut_watchnet'), 'фокус «Сеть слежения» завершён');
  const someSector = s.galaxy.planets.get(s.galaxy.order[0]!)!.sector;
  ok(reconActive(s, someSector), 'вся галактика разведана');

  // truceAll: «Протокол холодного мира».
  ok(rushFocus(s, 'automatons', 'aut_cold_peace'), 'фокус «Холодный мир» завершён');
  ok(truceActive(s, 'automatons', 'superEarth'), 'перемирие со всеми действует');

  console.log('уникальные эффекты машин: OK');
}

{
  // recallFleets: «Пространственный сдвиг» иллюминатов.
  const s = createGame(107, 'illuminate');
  const worlds = planetsOf(s, 'illuminate');
  const home = worlds.find((p) => p.isCapital) ?? worlds[0]!;
  const far = planetsOf(s, 'superEarth')[0]!;
  const f = spawnFleet(s, 'illuminate', far.id, { ships: 3, infantry: 5 });
  ok(rushFocus(s, 'illuminate', 'ill_shift'), 'фокус «Пространственный сдвиг» завершён');
  ok(f.at === home.id && !f.transit, 'флот мгновенно вернулся к столице');
  ok((f.xp ?? 0) >= 30, 'опыт сдвига начислен');

  // gloomSurge терминидов: зачаток созревает мгновенно.
  const t = createGame(109, 'terminids');
  t.gloomSeeds.push({ planet: planetsOf(t, 'terminids')[0]!.id, daysLeft: 60 });
  ok(rushFocus(t, 'terminids', 'term_spore_tide'), 'фокус «Споровый прилив» завершён');
  ok(t.gloomSeeds[0]!.daysLeft <= 1, 'зачаток Мрака созревает немедленно');

  console.log('сдвиг и прилив: OK');
}

// --- Деревья: у всех фракций достаточно фокусов и валидные requires ----------
{
  for (const fid of ['automatons', 'illuminate', 'terminids'] as const) {
    const tree = FOCUS_TREES[fid];
    ok(tree.length >= 38, `${fid}: в древе ${tree.length} фокусов (≥38)`);
    for (const n of tree) {
      for (const r of n.requires) {
        ok(tree.some((m) => m.id === r), `${fid}: требование ${r} узла ${n.id} существует`);
      }
    }
  }
  console.log('деревья валидны: OK');
}

console.log(`round39: OK (${checks} проверок)`);
