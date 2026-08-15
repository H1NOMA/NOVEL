import type { BattlePhase, FactionId, Fleet, Planet } from '../core/types';
import { areHostile, FACTIONS, FACTION_GEN, SPECIALS } from '../data/factions';
import { fleetsAt, modActive, pushChronicle, pushLog, removeFleet, type GameState } from './state';
import { depotBonus } from './supply';
import { retreatFleets } from './units';
import { drawUnits, eliteShare, harvestPopulation, massShare } from './troops';
import { scuttleYard } from './shipyards';
import { hostileNow } from './diplomacy';
import { commanderOf } from './commanders';
import { demolishDefenses, STATION_POWER } from './defense';
import { gainXp, rankOf } from './veterancy';
import { originBlockaded } from './specops';
import { bus } from '../core/emitter';

// ---------------------------------------------------------------------------
// Combat resolves in two layers each day:
//   1. Orbital (space) — hostile fleets sharing a planet trade ship losses.
//   2. Ground — an attacker with surviving fleets in orbit lands infantry and
//      grinds the planetary garrison. A liberation meter tracks the invasion;
//      at 100% the planet flips to the attacker.
// ---------------------------------------------------------------------------

function combatMult(state: GameState, faction: FactionId): number {
  const fs = state.factions[faction];
  // Доля элитных войск (Хеллдайверы, Легионы киборгов, Великий флот…) даёт
  // бонус к боевой силе фракции. «Военный пыл» подстёгивает всех.
  const fervor = modActive(state, 'fervor') ? 0.05 : 0;
  return 1 + fs.bonuses.combat + (fs.warSupport - 50) / 200 + eliteShare(fs) * 0.25 + fervor;
}

/** Суммарная корабельная мощь: эсминцы ×1, дредноуты ×3, линкоры ×6. */
export function hullPower(f: Fleet): number {
  return f.ships + f.dreadnoughts * 3 + f.battleships * 6;
}

/** Фаза наземной операции по прогрессу освобождения. */
export function battlePhase(liberation: number): BattlePhase {
  if (liberation < 25) return 'landing';
  if (liberation < 70) return 'foothold';
  return 'assault';
}

export const PHASE_LABEL: Record<BattlePhase, string> = {
  landing: 'Высадка',
  foothold: 'Плацдарм',
  assault: 'Генеральный штурм',
};

/** Общее число корпусов в соединении (для стека на карте). */
export function hullCount(f: Fleet): number {
  return f.ships + f.dreadnoughts + f.battleships;
}

function fleetPower(state: GameState, f: Fleet): number {
  let p = hullPower(f);
  if (f.special) p += p * (SPECIALS[f.faction].power - 1);
  // Ветераны бьют точнее: ранг соединения усиливает бортовой залп.
  return p * combatMult(state, f.faction) * rankOf(f).mult;
}

/** Resolve one day of orbital combat over every contested planet. */
export function resolveOrbital(state: GameState): void {
  for (const id of state.galaxy.order) {
    const planet = state.galaxy.planets.get(id)!;
    if (planet.shattered) continue;
    const here = fleetsAt(state, id);
    // Орбитальная станция обороняет планету даже при пустой орбите владельца.
    const station = planet.buildings.includes('orbStation') && !planet.puppetOf;
    if (here.length < 2 && !(station && here.length === 1)) continue;

    // Group fleets by faction; only fight if at least two hostile groups exist.
    const byFaction = new Map<FactionId, Fleet[]>();
    for (const f of here) {
      if (!byFaction.has(f.faction)) byFaction.set(f.faction, []);
      byFaction.get(f.faction)!.push(f);
    }
    if (station && !byFaction.has(planet.owner)) byFaction.set(planet.owner, []);
    const factions = [...byFaction.keys()];
    if (factions.length < 2) continue;

    // Total power per faction.
    const power = new Map<FactionId, number>();
    for (const [fac, fleets] of byFaction) {
      let p = fleets.reduce((s, f) => s + fleetPower(state, f), 0);
      if (station && fac === planet.owner) p += STATION_POWER * combatMult(state, fac);
      power.set(fac, p);
    }

    // Each faction takes damage proportional to the summed hostile power.
    for (const [fac, fleets] of byFaction) {
      let incoming = 0;
      for (const [other, op] of power) {
        if (other !== fac && areHostile(fac, other)) incoming += op;
      }
      if (incoming <= 0) continue;
      const loss = incoming * 0.16;
      applyShipLosses(state, fleets, loss, planet);
      // Обстрелянные экипажи: день орбитального боя даёт опыт обеим сторонам.
      const xpMult = modActive(state, 'veteranWar') ? 1.5 : 1;
      for (const f of fleets) gainXp(f, 0.8 * xpMult);
    }
  }
}

function applyShipLosses(state: GameState, fleets: Fleet[], totalLoss: number, planet: Planet): void {
  const totalShips = fleets.reduce((s, f) => s + hullCount(f), 0);
  if (totalShips <= 0) return;
  // Погибшие корпуса остаются на орбите полем обломков (тает со временем).
  planet.wreckage = (planet.wreckage ?? 0) + Math.min(totalLoss, totalShips);
  for (const f of fleets) {
    let share = (hullCount(f) / totalShips) * totalLoss;
    // Первыми гибнут эсминцы, затем дредноуты, линкоры — последними.
    const eatFrom = (key: 'ships' | 'dreadnoughts' | 'battleships', weight: number) => {
      if (share <= 0) return;
      const hulls = Math.min(f[key], share / weight);
      f[key] = Math.max(0, f[key] - hulls);
      share -= hulls * weight;
    };
    eatFrom('ships', 1);
    eatFrom('dreadnoughts', 3);
    eatFrom('battleships', 6);
    if (hullCount(f) < 0.5) {
      if (f.special) {
        state.factions[f.faction].lostSpecial = true;
        pushLog(state, {
          faction: f.faction,
          text: `${SPECIALS[f.faction].name} — уничтожен(а) на орбите ${planet.name}! Восстановление обойдётся очень дорого.`,
          tone: f.faction === state.player ? 'bad' : 'good',
        });
      }
      removeFleet(state, f.id);
    }
  }
}

/** Resolve one day of ground combat / invasions over every planet. */
export function resolveGround(state: GameState): void {
  for (const id of state.galaxy.order) {
    const planet = state.galaxy.planets.get(id)!;
    if (planet.shattered) continue;
    // fleetsAt already excludes fleets still in transit.
    const attackers = fleetsAt(state, id).filter((f) => hostileNow(state, f.faction, planet.owner));

    // Высаженный десант дерётся сам, даже когда орбита потеряна: битва
    // продолжается силами наземной группировки.
    if (attackers.length === 0 && planet.battle && (planet.battle.landed ?? 0) >= 1 &&
        hostileNow(state, planet.battle.attacker, planet.owner)) {
      const b = planet.battle;
      b.days++;
      const phase = battlePhase(b.liberation);
      b.phase = phase;
      const attackerForce = (b.landed ?? 0) * combatMult(state, b.attacker);
      let defBonus = 1 + planet.fortification * 0.12 + state.factions[planet.owner].bonuses.fortify * 0.05;
      if (planet.buildings.includes('shieldGen') && !planet.puppetOf) defBonus *= 1.35;
      if (!planet.supplied) defBonus *= 0.55;
      const defenderForce = planet.garrison * combatMult(state, planet.owner) * defBonus;
      b.attackerForce = attackerForce;
      b.defenderForce = defenderForce;
      const ratio = attackerForce / (attackerForce + defenderForce + 0.001);
      // Без орбитального прикрытия и подвоза десант наступает медленнее.
      b.liberation = clamp(b.liberation + (ratio - 0.5) * 16, 0, 100);
      planet.garrison = Math.max(0, planet.garrison - Math.min(planet.garrison, attackerForce * 0.03));
      b.landed = Math.max(0, (b.landed ?? 0) - (b.landed ?? 0) * defenderForce * 0.0008 * (1 + planet.fortification * 0.15));
      if (b.liberation >= 100 || planet.garrison <= 0.5) {
        capturePlanet(state, planet, b.attacker, []);
      } else if ((b.landed ?? 0) < 1) {
        // Десант перебит — штурм угасает обычным порядком.
        b.landed = 0;
      }
      continue;
    }

    if (attackers.length === 0) {
      // ОКРУЖЕНИЕ: отрезанная планета медленно душится — гарнизон тает,
      // контроль утекает к осаждающему соседу, пока мир не падёт без боя.
      if (!planet.supplied && !planet.puppetOf) {
        const besieger = planet.links
          .map((lid) => state.galaxy.planets.get(lid)!)
          .find((n) => !n.shattered && hostileNow(state, n.owner, planet.owner))?.owner;
        if (besieger) {
          if (!planet.battle || planet.battle.attacker !== besieger) {
            planet.battle = {
              attacker: besieger,
              defender: planet.owner,
              attackerForce: 0,
              defenderForce: planet.garrison,
              liberation: planet.battle?.liberation ?? 0,
              days: 0,
            };
            if (planet.owner === state.player) {
              bus.emit('combatAlert', {
                planetId: planet.id,
                text: `${planet.name} — осада: мир отрезан`,
                tone: 'bad',
                voice: 'siege',
              });
            }
          }
          planet.battle.days++;
          planet.battle.liberation = clamp(planet.battle.liberation + 0.6, 0, 100);
          planet.garrison = Math.max(0, planet.garrison - 0.8);
          if (planet.battle.liberation >= 100 || planet.garrison <= 0.5) {
            capturePlanet(state, planet, besieger, []);
          }
          continue;
        }
      }
      // No invaders — decay any stale battle and slowly regrow garrison.
      if (planet.battle) {
        planet.battle.liberation = Math.max(0, planet.battle.liberation - 6);
        if (planet.battle.liberation <= 0) {
          planet.battle = undefined;
          // Вторжение отбито — города возвращаются законному владельцу.
          for (const c of planet.cities) c.holder = planet.owner;
        }
      }
      regrowGarrison(state, planet);
      continue;
    }

    // Determine the lead attacking faction (strongest present).
    const attackPower = new Map<FactionId, number>();
    for (const f of attackers) {
      attackPower.set(f.faction, (attackPower.get(f.faction) ?? 0) + f.infantry * combatMult(state, f.faction) * (commanderOf(f)?.combat ?? 1));
    }
    let lead: FactionId = attackers[0]!.faction;
    let leadVal = 0;
    for (const [fac, val] of attackPower) if (val > leadVal) { leadVal = val; lead = fac; }

    // Высаженный ранее десант ведущего атакующего дерётся вместе с бортовой пехотой.
    const landedGround = planet.battle && planet.battle.attacker === lead ? (planet.battle.landed ?? 0) : 0;
    let attackerForce = leadVal + landedGround * combatMult(state, lead);
    let defBonus = 1 + planet.fortification * 0.12 + state.factions[planet.owner].bonuses.fortify * 0.05;
    // Планетарный щит: высадка вязнет в помехах и заградительном огне.
    const shielded = planet.buildings.includes('shieldGen') && !planet.puppetOf;
    if (shielded) defBonus *= 1.35;
    // Планета в окружении (без снабжения) обороняется вполсилы.
    if (!planet.supplied) defBonus *= 0.55;
    // Мрак — стихия роя: оборона терминидов в споровом дыму сильнее.
    if (planet.gloom && planet.owner === 'terminids') defBonus *= 1.5;
    // Тень Бездны: миры иллюминатов рядом с погруженными обороняются упорнее.
    if (planet.owner === 'illuminate' &&
        planet.links.some((lid) => state.galaxy.planets.get(lid)!.abyss)) defBonus *= 1.3;
    // Снабжение атаки идёт С ПЛАЦДАРМА: планеты, с которой флот вторгся.
    // Если плацдарм потерян/отрезан, не смежен с целью — или его орбиту
    // блокирует вражеский рейдер, — атакующий получает штраф.
    const hasSupplyLine = attackers.some((f) => {
      if (f.faction !== lead || !f.origin) return false;
      const o = state.galaxy.planets.get(f.origin);
      return !!o && o.owner === lead && o.supplied && !o.shattered &&
        planet.links.includes(o.id) && !originBlockaded(state, o.id, lead);
    });
    // «Растянутые коммуникации» бьют по атаке без снабжения ещё жёстче.
    if (!hasSupplyLine) attackerForce *= modActive(state, 'longSupply') ? 0.6 : 0.75;
    // Термицид выкашивает атакующий рой.
    if (lead === 'terminids' && planet.buildings.includes('termicide')) attackerForce *= 0.45;
    let defenderForce = planet.garrison * combatMult(state, planet.owner) * defBonus;

    if (!planet.battle || planet.battle.attacker !== lead) {
      planet.battle = {
        attacker: lead,
        defender: planet.owner,
        attackerForce,
        defenderForce,
        liberation: planet.battle?.liberation ?? 0,
        days: 0,
      };
      if (planet.battle.days === 0) {
        pushLog(state, {
          faction: lead,
          text: `Силы ${FACTION_GEN[lead]} высаживаются на ${planet.name}! Начинается битва за планету.`,
          tone: planet.owner === state.player ? 'alert' : lead === state.player ? 'good' : 'info',
        });
        if (planet.owner === state.player) {
          bus.emit('combatAlert', {
            planetId: planet.id,
            text: `${planet.name} — вторжение ${FACTION_GEN[lead]}!`,
            tone: 'bad',
            voice: 'incursion',
          });
        }
      }
    }
    const b = planet.battle;
    b.days++;

    // Фазы операции: высадка (0–25) → плацдарм (25–70) → штурм (70+).
    //  • Высадка: десант уязвим, оборона встречает огнём; ЭЛИТНЫЕ войска
    //    (Хеллдайверы и аналоги) пробивают плацдарм заметно лучше.
    //  • Штурм: оборона ломается, МАССОВАЯ пехота дожимает контроль быстрее.
    const phase = battlePhase(b.liberation);
    b.phase = phase;
    let gLossMult = 1;
    if (phase === 'landing') {
      attackerForce *= 0.85 + eliteShare(state.factions[lead]) * 0.4;
      defenderForce *= 1.15;
      gLossMult = 0.8;
    } else if (phase === 'assault') {
      attackerForce *= 1.1;
      gLossMult = 1.3;
    }
    b.attackerForce = attackerForce;
    b.defenderForce = defenderForce;

    // Attrition: both sides lose strength; the meter shifts toward the winner.
    const ratio = attackerForce / (attackerForce + defenderForce + 0.001);
    // Каждый захваченный город укрепляет плацдарм атакующего; массовая
    // пехота (ВССЗ, Рой, Безмозглые массы) быстрее устанавливает контроль.
    const citiesHeld = planet.cities.filter((c) => c.holder === lead).length;
    // Супероружие на орбите (DSS, ASS, Монолит, Суперколония) ломает оборону
    // с орбиты — планета захватывается заметно быстрее.
    const hasSuperweapon = attackers.some((f) => f.faction === lead && f.special);
    const cmdCapture = Math.max(1, ...attackers.filter((f) => f.faction === lead).map((f) => commanderOf(f)?.capture ?? 1));
    // Ранг ведущего соединения ускоряет установление контроля; щит — замедляет.
    const vetCapture = Math.max(1, ...attackers.filter((f) => f.faction === lead).map((f) => rankOf(f).mult));
    const captureRate = (1 + massShare(state.factions[lead]) * (phase === 'assault' ? 0.5 : 0.3))
      * (hasSuperweapon ? 1.4 : 1)
      * cmdCapture * vetCapture * (shielded ? 0.55 : 1);
    b.liberation = clamp(b.liberation + (ratio - 0.5) * 22 * captureRate + citiesHeld * 0.9, 0, 100);

    // Города переходят из рук в руки по мере освобождения планеты.
    const CITY_THRESHOLDS = [30, 55, 80];
    planet.cities.forEach((city, ci) => {
      const th = CITY_THRESHOLDS[Math.min(ci, CITY_THRESHOLDS.length - 1)]!;
      if (b.liberation >= th && city.holder !== lead) {
        city.holder = lead;
        pushLog(state, {
          faction: lead,
          text: `Город ${city.name} (${planet.name}) захвачен силами ${FACTION_GEN[lead]}.`,
          tone: planet.owner === state.player ? 'bad' : lead === state.player ? 'good' : 'info',
        });
      }
    });

    // Casualties reduce garrison and landed infantry.
    const gLoss = Math.min(planet.garrison, attackerForce * 0.04 * gLossMult);
    planet.garrison = Math.max(0, planet.garrison - gLoss);
    for (const f of attackers) {
      const iLoss = f.infantry * defenderForce * 0.0006 * (1 + planet.fortification * 0.15);
      f.infantry = Math.max(0, f.infantry - iLoss);
      // День наземных боёв закаляет десант.
      if (f.faction === lead) gainXp(f, 1.2 * (modActive(state, 'veteranWar') ? 1.5 : 1));
    }
    // Наземный десант несёт потери наравне с бортовой пехотой.
    if (b.landed && b.attacker === lead) {
      b.landed = Math.max(0, b.landed - b.landed * defenderForce * 0.0006 * (1 + planet.fortification * 0.15));
    }

    if (b.liberation >= 100 || planet.garrison <= 0.5) {
      capturePlanet(state, planet, lead, attackers);
      continue;
    }
    // Захлебнувшийся штурм прекращается: контроль на нуле, пехоты не осталось —
    // сражение сворачивается, и скованные боем флоты снова свободны.
    if (b.liberation <= 0 && b.days > 8 && leadVal < 0.5 && (b.landed ?? 0) < 1) {
      planet.battle = undefined;
      for (const c of planet.cities) c.holder = planet.owner;
      pushLog(state, {
        faction: lead,
        text: `Штурм ${planet.name} захлебнулся: у ${FACTION_GEN[lead]} не осталось десанта. Осада снята.`,
        tone: planet.owner === state.player ? 'good' : 'info',
      });
    }
  }
}

function capturePlanet(state: GameState, planet: Planet, attacker: FactionId, attackers: Fleet[]): void {
  const prev = planet.owner;
  state.lastConqueror[prev] = attacker;
  const garrisonLost = planet.garrison;
  // Уцелевший наземный десант атакующего станет ядром нового гарнизона.
  const groundForce = planet.battle && planet.battle.attacker === attacker ? (planet.battle.landed ?? 0) : 0;
  // Долгая мясорубка оставляет на поверхности выжженные шрамы — навсегда.
  if (planet.battle && planet.battle.days >= 20) planet.scarred = true;
  planet.owner = attacker;
  planet.battle = undefined;
  planet.puppetOf = undefined;
  // Верфь достаётся победителю, но склад и стапель защитники уничтожают.
  scuttleYard(planet);
  // Щит и орбитальная станция гибнут вместе с обороной.
  demolishDefenses(planet);
  // Победный штурм — главная школа десанта.
  const victoryXp = modActive(state, 'veteranWar') ? 18 : 12;
  for (const f of attackers) if (f.faction === attacker) gainXp(f, victoryXp);
  // Мрак рассеивается, когда мир отбит у роя, — оставляя богатые залежи Е-711.
  if (planet.gloom && attacker !== 'terminids') {
    planet.gloom = false;
    planet.e711Rich = true;
    pushLog(state, {
      text: `Мрак над ${planet.name} рассеивается. Разведка сообщает о богатых залежах Е-711.`,
      tone: attacker === state.player ? 'good' : 'info',
    });
  }
  // Иллюминаты вывозят население захваченных миров Супер-Земли.
  if (attacker === 'illuminate' && prev === 'superEarth') {
    harvestPopulation(state, planet.name, garrisonLost, planet.cities.length);
  }
  // Landed infantry becomes the new garrison; ships stay in orbit.
  let landed = groundForce;
  for (const f of attackers) {
    if (f.faction === attacker) {
      landed += f.infantry * 0.6;
      f.infantry *= 0.4;
    }
  }
  planet.garrison = Math.max(8, landed);
  planet.fortification = Math.max(0, planet.fortification - 2);
  for (const c of planet.cities) c.holder = attacker;
  // Флоты прежнего владельца отступают в ближайший свой мир — но ТОЛЬКО если
  // планета была снабжена. Из окружения (без снабжения) не уходит никто.
  const retreated = planet.supplied ? retreatFleets(state, planet.id, prev) : 0;
  if (retreated > 0) {
    pushLog(state, {
      faction: prev,
      text: `Флоты ${FACTION_GEN[prev]} отступают с орбиты ${planet.name}.`,
      tone: 'info',
    });
  }
  // Кто не смог отступить — тот в полном окружении и гибнет вместе с гарнизоном.
  // Уничтоженное так супероружие придётся восстанавливать за огромную цену.
  for (const fid of [...state.fleetOrder]) {
    const f = state.fleets.get(fid);
    if (!f || f.faction !== prev || f.at !== planet.id || f.transit) continue;
    planet.wreckage = (planet.wreckage ?? 0) + hullCount(f);
    if (f.special) {
      state.factions[prev].lostSpecial = true;
      pushLog(state, {
        faction: prev,
        text: `${SPECIALS[prev].name} — уничтожен(а) в окружении на ${planet.name}! Восстановление обойдётся очень дорого.`,
        tone: prev === state.player ? 'bad' : 'good',
      });
    } else {
      pushLog(state, {
        faction: prev,
        text: `Окружённый флот ${FACTION_GEN[prev]} уничтожен на орбите ${planet.name}.`,
        tone: prev === state.player ? 'bad' : 'info',
      });
    }
    removeFleet(state, fid);
  }
  pushLog(state, {
    faction: attacker,
    text: `${planet.name} — планета захвачена силами ${FACTION_GEN[attacker]}${planet.isCapital ? '. Пала СТОЛИЦА!' : '.'}`,
    tone: prev === state.player ? 'bad' : attacker === state.player ? 'good' : 'info',
  });
  bus.emit('planetCaptured', { id: planet.id, by: attacker, prev });
  if (planet.isCapital) {
    pushChronicle(state, `Пала столица: ${planet.name} захвачена силами ${FACTION_GEN[attacker]}.`);
  }
  if (prev === state.player) {
    bus.emit('combatAlert', {
      planetId: planet.id,
      text: `${planet.name} — ПЛАНЕТА ПОТЕРЯНА`,
      tone: 'bad',
      voice: planet.isCapital ? 'capitalLost' : 'planetLost',
    });
  } else if (attacker === state.player) {
    bus.emit('combatAlert', { planetId: planet.id, text: `${planet.name} — освобождена`, tone: 'good', voice: 'planetLiberated' });
  }
  // Capitals are the head of the state: cut it off and the faction capitulates.
  // The Terminids have no capital — the swarm must be exterminated entirely.
  if (planet.isCapital && prev !== 'terminids') {
    surrenderFaction(state, prev, attacker);
  }
}

/** Total collapse: every remaining world submits to the victor, fleets scatter. */
function surrenderFaction(state: GameState, loser: FactionId, victor: FactionId): void {
  const fs = state.factions[loser];
  if (!fs.alive) return;
  fs.alive = false;
  fs.activeFocus = undefined;
  let flipped = 0;
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    if (p.owner === loser) {
      p.owner = victor;
      p.garrison = Math.max(5, p.garrison * 0.5);
      p.battle = undefined;
      // С падением их владык миры Бездны возвращаются в реальность.
      if (p.abyss) p.abyss = false;
      flipped++;
    }
  }
  for (const fid of [...state.fleetOrder]) {
    const f = state.fleets.get(fid);
    if (f && f.faction === loser) removeFleet(state, fid);
  }
  pushChronicle(state, `Фракция «${FACTIONS[loser].name}» капитулирует: ${flipped} миров переходят под контроль ${FACTION_GEN[victor]}.`);
  pushLog(state, {
    faction: loser,
    text: `Столица пала — фракция «${FACTIONS[loser].name}» КАПИТУЛИРУЕТ! Миров перешло под контроль ${FACTION_GEN[victor]}: ${flipped}.`,
    tone: loser === state.player ? 'bad' : 'alert',
  });
  if (loser === state.player) state.playerDefeated = true;
  bus.emit('factionDefeated', { faction: loser, by: victor });
}

function regrowGarrison(state: GameState, planet: Planet): void {
  // Мир-марионетка разоружён: гарнизон не восстанавливается.
  if (planet.puppetOf) return;
  // Окружённая планета не получает пополнений — гарнизон медленно тает.
  if (!planet.supplied) {
    planet.garrison = Math.max(1, planet.garrison - 0.5);
    return;
  }
  const cap = planet.isCapital ? 140 : 40 + planet.value * 8;
  if (planet.garrison < cap) {
    let growth = 0.4 + state.factions[planet.owner].bonuses.recruitment * 0.04;
    // Город-академия готовит пополнение быстрее.
    if (planet.cities.some((cc) => cc.spec === 'academy' && cc.holder === planet.owner)) growth *= 1.35;
    // Точка снабжения здесь или на соседней своей планете ускоряет пополнение.
    if (depotBonus(state, planet)) growth *= 1.8;
    // Пополнение гарнизона идёт из реальных пулов войск фракции.
    const drawn = drawUnits(state.factions[planet.owner], Math.min(growth, cap - planet.garrison));
    planet.garrison += drawn;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
