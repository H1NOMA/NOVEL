// Инварианты детерминизма симуляции.
//
// Сетевая партия держится на том, что хост и клиент, применив одни и те же
// приказы к одному и тому же миру, получат побитово одинаковый результат.
// Здесь проверяются два условия этого, и оба обязаны пережить любую
// переработку правил.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, planetsOf } from '../src/game/state';
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

// --- Единственный источник случайности — state.rng --------------------------------
//
// Это единственная текстовая проверка, которая остаётся намеренно: Math.random
// не воспроизводится и не переживает сериализацию, поэтому один его вызов в
// правилах разводит хост и клиента навсегда — и разойдутся они не сразу, а
// через час партии, там, где отладка уже невозможна.
{
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (name.endsWith('.ts')) out.push(full);
    }
    return out;
  };
  const guilty: string[] = [];
  for (const file of walk(join(process.cwd(), 'src', 'game'))) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      // Ищем ВЫЗОВ, а не упоминание: в комментариях Math.random называется по
      // имени именно затем, чтобы объяснить, почему его здесь нет.
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
      if (/Math\.random\s*\(/.test(line)) guilty.push(`${file.split('/src/')[1]}:${i + 1}`);
    });
  }
  ok(guilty.length === 0, `в правилах нет Math.random (найдено: ${guilty.join(', ')})`);
  console.log('единственный источник случайности: OK');
}

// --- Один сид даёт один мир -------------------------------------------------------
{
  const fingerprint = (seed: number, days: number): string => {
    const s = createGame(seed, 'superEarth');
    s.humans = [];
    for (let d = 0; d < days; d++) {
      moveFleets(s, 1);
      advanceDay(s);
    }
    const parts: string[] = [];
    for (const id of s.galaxy.order) {
      const p = s.galaxy.planets.get(id)!;
      parts.push(`${p.owner}${p.garrison.toFixed(3)}${p.fortification}${p.battle?.liberation.toFixed(3) ?? ''}`);
    }
    for (const f of FACTION_IDS) {
      const fs = s.factions[f];
      parts.push(`${f}${fs.production.toFixed(4)}${fs.politicalPower.toFixed(4)}${planetsOf(s, f).length}`);
    }
    return parts.join('|');
  };

  for (const seed of [1, 42]) {
    const a = fingerprint(seed, 200);
    const b = fingerprint(seed, 200);
    ok(a === b, `сид ${seed}: два прогона по 200 дней совпадают побитово`);
  }
  ok(fingerprint(1, 200) !== fingerprint(2, 200), 'разные сиды дают разные партии');
  console.log('воспроизводимость по сиду: OK');
}

console.log(`determinism: OK (${checks} проверок)`);
