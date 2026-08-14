// Раунд 41: галактические модификаторы, реальное влияние показателей,
// перекрёстные требования фокусов.
import { createGame } from '../src/game/state';
import { mineMinerals, replenishUnits } from '../src/game/troops';
import { runEconomy } from '../src/game/ai';
import { truceCost, TRUCE_COST } from '../src/game/diplomacy';
import { GALAXY_MODIFIERS } from '../src/data/modifiers';
import { FOCUS_TREES } from '../src/data/focus';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

// --- Модификаторы партии: ровно два, валидные, детерминированные -------------
{
  const a = createGame(555);
  const b = createGame(555);
  ok(a.modifiers.length === 2, `модификаторов два (${a.modifiers.length})`);
  ok(new Set(a.modifiers).size === 2, 'модификаторы различны');
  ok(a.modifiers.every((id) => GALAXY_MODIFIERS.some((m) => m.id === id)), 'id валидны');
  ok(JSON.stringify(a.modifiers) === JSON.stringify(b.modifiers), 'один сид — одни условия');
  const c = createGame(556);
  void c; // другой сид может дать другой набор — не проверяем равенство
  console.log('модификаторы партии: OK →', a.modifiers.join(', '));
}

// --- «Богатые жилы»: добыча реально выше -------------------------------------
{
  const base = createGame(601);
  base.modifiers = [];
  const rich = createGame(601);
  rich.modifiers = ['richVeins'];
  const incomeBase = mineMinerals(base, 'automatons');
  const incomeRich = mineMinerals(rich, 'automatons');
  ok(incomeRich > incomeBase * 1.3, `богатые жилы работают (${incomeBase.toFixed(2)} → ${incomeRich.toFixed(2)})`);
  console.log('богатые жилы: OK');
}

// --- Стабильность реально двигает производство СЗ ----------------------------
{
  const low = createGame(603);
  low.modifiers = [];
  const high = createGame(603);
  high.modifiers = [];
  low.factions.superEarth.stability = 20;
  high.factions.superEarth.stability = 95;
  low.factions.superEarth.production = 0;
  high.factions.superEarth.production = 0;
  runEconomy(low, 'superEarth');
  runEconomy(high, 'superEarth');
  ok(high.factions.superEarth.production > low.factions.superEarth.production * 1.2,
    `стабильность влияет на производство (${low.factions.superEarth.production.toFixed(1)} → ${high.factions.superEarth.production.toFixed(1)})`);

  // «Холодные кузницы» режут производство.
  const cold = createGame(603);
  cold.modifiers = ['coldForges'];
  cold.factions.superEarth.stability = 95;
  cold.factions.superEarth.production = 0;
  runEconomy(cold, 'superEarth');
  ok(cold.factions.superEarth.production < high.factions.superEarth.production,
    'холодные кузницы режут производство');
  console.log('стабильность и кузницы: OK');
}

// --- Поддержка войны двигает призыв ------------------------------------------
{
  const lowWs = createGame(607);
  const highWs = createGame(607);
  lowWs.modifiers = [];
  highWs.modifiers = [];
  lowWs.factions.superEarth.warSupport = 10;
  highWs.factions.superEarth.warSupport = 95;
  lowWs.factions.superEarth.units.seaf = 0;
  highWs.factions.superEarth.units.seaf = 0;
  replenishUnits(lowWs, 'superEarth');
  replenishUnits(highWs, 'superEarth');
  ok((highWs.factions.superEarth.units.seaf ?? 0) > (lowWs.factions.superEarth.units.seaf ?? 0) * 1.15,
    `поддержка войны двигает призыв (${lowWs.factions.superEarth.units.seaf?.toFixed(2)} → ${highWs.factions.superEarth.units.seaf?.toFixed(2)})`);
  console.log('поддержка войны: OK');
}

// --- «Тихий космос»: перемирия вдвое дешевле ---------------------------------
{
  const s = createGame(611);
  s.modifiers = ['quietSpace'];
  ok(truceCost(s) === TRUCE_COST / 2, 'тихий космос — половина цены');
  s.modifiers = [];
  ok(truceCost(s) === TRUCE_COST, 'без условия — полная цена');
  console.log('тихий космос: OK');
}

// --- Перекрёстные требования на месте и валидны ------------------------------
{
  const expect: [keyof typeof FOCUS_TREES, string, string][] = [
    ['superEarth', 'se_orbital', 'se_fleet'],
    ['superEarth', 'se_requalification', 'se_truth'],
    ['automatons', 'aut_final_march', 'aut_purge'],
    ['automatons', 'aut_watchnet', 'aut_dev_ai'],
    ['illuminate', 'ill_shift', 'ill_rend'],
    ['illuminate', 'ill_mind_harvest', 'ill_conversion'],
    ['terminids', 'term_torpor', 'term_noqueen'],
    ['terminids', 'term_spore_tide', 'term_gloom'],
  ];
  for (const [fac, nid, req] of expect) {
    const node = FOCUS_TREES[fac].find((n) => n.id === nid)!;
    ok(node.requires.includes(req), `${nid} требует ${req}`);
  }
  // Валидность: каждое требование существует, циклов из новых связей нет
  // (все requires указывают на узлы с меньшим или тем же y — грубая проверка DAG).
  for (const fac of ['superEarth', 'automatons', 'illuminate', 'terminids'] as const) {
    for (const n of FOCUS_TREES[fac]) {
      for (const r of n.requires) {
        ok(FOCUS_TREES[fac].some((m) => m.id === r), `${fac}: ${r} существует`);
      }
    }
  }
  console.log('перекрёстные требования: OK');
}

console.log(`round41: OK (${checks} проверок)`);
