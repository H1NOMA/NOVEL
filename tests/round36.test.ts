// Раунд 36: сцепка боем, высадка десанта на атакуемую планету, прекращение
// захлебнувшегося штурма.
import { createGame, spawnFleet } from '../src/game/state';
import { resolveGround } from '../src/game/combat';
import { garrisonReinforce, lockedInBattle, orderFleetTo } from '../src/game/units';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

// --- Сцепка боем ------------------------------------------------------------
{
  const s = createGame(41);
  const target = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!)
    .find((p) => p.owner === 'automatons' && p.links.length > 0)!;
  target.garrison = 50;
  const attacker = spawnFleet(s, 'superEarth', target.id, { ships: 10, infantry: 40 });
  const defenderFleet = spawnFleet(s, 'automatons', target.id, { ships: 8, infantry: 10 });
  resolveGround(s); // битва завязалась
  ok(!!target.battle, 'битва началась');
  ok(lockedInBattle(s, attacker), 'атакующий скован боем');
  ok(lockedInBattle(s, defenderFleet), 'обороняющийся скован боем');
  const anyLink = target.links[0]!;
  ok(!orderFleetTo(s, attacker, anyLink, false), 'скованный флот не может уйти с орбиты');
  // Третья сторона не участвует — свободна.
  const bystander = spawnFleet(s, 'illuminate', target.id, { ships: 3, infantry: 3 });
  ok(!lockedInBattle(s, bystander), 'сторонний флот боем не скован');
  console.log('сцепка боем: OK');
}

// --- Высадка десанта на атакуемую планету -----------------------------------
{
  const s = createGame(43);
  const target = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!)
    .find((p) => p.owner === 'automatons')!;
  target.garrison = 60;
  const inv = spawnFleet(s, 'superEarth', target.id, { ships: 10, infantry: 30 });
  resolveGround(s);
  ok(!!target.battle && target.battle.attacker === 'superEarth', 'битва идёт');
  garrisonReinforce(s, inv);
  // Первый день боя уже снял часть пехоты — важно, что на землю сошло всё оставшееся.
  ok((target.battle!.landed ?? 0) >= 20, `десант высажен (${target.battle!.landed})`);
  ok(inv.infantry === 0, 'пехота покинула борт');

  // Флот уничтожен/убран — десант продолжает бой сам.
  s.fleetOrder.splice(s.fleetOrder.indexOf(inv.id), 1);
  s.fleets.delete(inv.id);
  const libBefore = target.battle!.liberation;
  const garrisonBefore = target.garrison;
  for (let i = 0; i < 5; i++) resolveGround(s);
  ok(!!target.battle, 'битва не угасла без флота — десант дерётся');
  ok(target.garrison < garrisonBefore, `гарнизон несёт потери от десанта (${garrisonBefore} → ${target.garrison.toFixed(1)})`);
  void libBefore;
  console.log('высадка десанта: OK');
}

// --- Захлебнувшийся штурм прекращается ---------------------------------------
{
  const s = createGame(47);
  const target = s.galaxy.order.map((id) => s.galaxy.planets.get(id)!)
    .find((p) => p.owner === 'automatons')!;
  target.garrison = 80;
  const inv = spawnFleet(s, 'superEarth', target.id, { ships: 6, infantry: 0 });
  resolveGround(s);
  ok(!!target.battle, 'битва завязалась даже с пустым десантом');
  target.battle!.days = 9;
  target.battle!.liberation = 0;
  resolveGround(s);
  ok(!target.battle, 'штурм без пехоты и десанта свёрнут');
  ok(!lockedInBattle(s, inv), 'флот освобождён после прекращения штурма');
  console.log('прекращение штурма: OK');
}

console.log(`round36: OK (${checks} проверок)`);
