// Длинный прогон: 3 сида × 300 дней. Проверяем инварианты симуляции —
// никаких NaN, отрицательных величин и битых ссылок после долгой войны.
import { createGame, planetsOf, type GameState } from '../src/game/state';
import { advanceDay, moveFleets } from '../src/game/sim';
import { FACTION_IDS } from '../src/data/factions';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function invariants(state: GameState, seed: number): void {
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    ok(Number.isFinite(p.garrison) && p.garrison >= 0, `сид ${seed}: гарнизон ${p.name} = ${p.garrison}`);
    ok(!!state.galaxy.planets.get(p.id), `сид ${seed}: планета ${id} без записи`);
    if (p.wreckage !== undefined) {
      ok(Number.isFinite(p.wreckage) && p.wreckage >= 0, `сид ${seed}: обломки ${p.name} = ${p.wreckage}`);
    }
    if (p.battle) {
      ok(p.battle.liberation >= 0 && p.battle.liberation <= 100, `сид ${seed}: liberation ${p.name} = ${p.battle.liberation}`);
    }
  }
  for (const fid of state.fleetOrder) {
    const f = state.fleets.get(fid);
    ok(!!f, `сид ${seed}: флот ${fid} в порядке, но не в Map`);
    if (!f) continue;
    ok(Number.isFinite(f.ships) && f.ships >= 0, `сид ${seed}: корабли ${fid} = ${f.ships}`);
    ok(Number.isFinite(f.infantry) && f.infantry >= 0, `сид ${seed}: пехота ${fid} = ${f.infantry}`);
    ok(f.xp === undefined || (Number.isFinite(f.xp) && f.xp >= 0 && f.xp <= 500), `сид ${seed}: опыт ${fid} = ${f.xp}`);
    ok(!!state.galaxy.planets.get(f.transit ? f.transit.to : f.at), `сид ${seed}: флот ${fid} висит на несуществующей планете`);
  }
  for (const facId of FACTION_IDS) {
    const fs = state.factions[facId];
    ok(Number.isFinite(fs.production) && fs.production >= 0, `сид ${seed}: производство ${facId} = ${fs.production}`);
    ok(Number.isFinite(fs.politicalPower), `сид ${seed}: ПВ ${facId} = ${fs.politicalPower}`);
  }
}

for (const seed of [42, 1337, 900913]) {
  const state = createGame(seed);
  for (let d = 0; d < 300; d++) {
    // advanceDay флоты не двигает — в игре это делает GameClock каждый кадр.
    moveFleets(state, 1);
    advanceDay(state);
  }
  invariants(state, seed);
  const alive = FACTION_IDS.filter((f) => planetsOf(state, f).length > 0);
  ok(alive.length >= 1, `сид ${seed}: к дню 300 не осталось живых фракций`);
  console.log(`сид ${seed}: день ${state.day}, живых фракций ${alive.length}, флотов ${state.fleetOrder.length}`);
}

console.log(`longrun: OK (${checks} проверок)`);
