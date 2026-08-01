import type { FactionId, Fleet, Planet } from '../core/types';
import { areHostile, FACTIONS, FACTION_GEN, SPECIALS } from '../data/factions';
import { fleetsAt, pushLog, removeFleet, type GameState } from './state';
import { depotBonus } from './supply';
import { retreatFleets } from './units';
import { drawUnits, eliteShare, harvestPopulation, massShare } from './troops';

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
  // бонус к боевой силе фракции.
  return 1 + fs.bonuses.combat + (fs.warSupport - 50) / 200 + eliteShare(fs) * 0.25;
}

function fleetPower(state: GameState, f: Fleet): number {
  let p = f.ships;
  if (f.special) p += f.ships * (SPECIALS[f.faction].power - 1);
  return p * combatMult(state, f.faction);
}

/** Resolve one day of orbital combat over every contested planet. */
export function resolveOrbital(state: GameState): void {
  for (const id of state.galaxy.order) {
    const planet = state.galaxy.planets.get(id)!;
    const here = fleetsAt(state, id);
    if (here.length < 2) continue;

    // Group fleets by faction; only fight if at least two hostile groups exist.
    const byFaction = new Map<FactionId, Fleet[]>();
    for (const f of here) {
      if (!byFaction.has(f.faction)) byFaction.set(f.faction, []);
      byFaction.get(f.faction)!.push(f);
    }
    const factions = [...byFaction.keys()];
    if (factions.length < 2) continue;

    // Total power per faction.
    const power = new Map<FactionId, number>();
    for (const [fac, fleets] of byFaction) {
      power.set(fac, fleets.reduce((s, f) => s + fleetPower(state, f), 0));
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
    }
  }
}

function applyShipLosses(state: GameState, fleets: Fleet[], totalLoss: number, planet: Planet): void {
  const totalShips = fleets.reduce((s, f) => s + f.ships, 0);
  if (totalShips <= 0) return;
  for (const f of fleets) {
    const share = (f.ships / totalShips) * totalLoss;
    f.ships = Math.max(0, f.ships - share);
    if (f.ships < 0.5) {
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
    // fleetsAt already excludes fleets still in transit.
    const attackers = fleetsAt(state, id).filter((f) => areHostile(f.faction, planet.owner));

    if (attackers.length === 0) {
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
      attackPower.set(f.faction, (attackPower.get(f.faction) ?? 0) + f.infantry * combatMult(state, f.faction));
    }
    let lead: FactionId = attackers[0]!.faction;
    let leadVal = 0;
    for (const [fac, val] of attackPower) if (val > leadVal) { leadVal = val; lead = fac; }

    const attackerForce = leadVal;
    let defBonus = 1 + planet.fortification * 0.12 + state.factions[planet.owner].bonuses.fortify * 0.05;
    // Планета в окружении (без снабжения) обороняется вполсилы.
    if (!planet.supplied) defBonus *= 0.55;
    const defenderForce = planet.garrison * combatMult(state, planet.owner) * defBonus;

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
      }
    }
    const b = planet.battle;
    b.attackerForce = attackerForce;
    b.defenderForce = defenderForce;
    b.days++;

    // Attrition: both sides lose strength; the meter shifts toward the winner.
    const ratio = attackerForce / (attackerForce + defenderForce + 0.001);
    // Каждый захваченный город укрепляет плацдарм атакующего; массовая
    // пехота (ВССЗ, Рой, Безмозглые массы) быстрее устанавливает контроль.
    const citiesHeld = planet.cities.filter((c) => c.holder === lead).length;
    // Супероружие на орбите (DSS, ASS, Монолит, Суперколония) ломает оборону
    // с орбиты — планета захватывается заметно быстрее.
    const hasSuperweapon = attackers.some((f) => f.faction === lead && f.special);
    const captureRate = (1 + massShare(state.factions[lead]) * 0.3) * (hasSuperweapon ? 1.4 : 1);
    b.liberation = clamp(b.liberation + (ratio - 0.5) * 34 * captureRate + citiesHeld * 1.1, 0, 100);

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
    const gLoss = Math.min(planet.garrison, attackerForce * 0.04);
    planet.garrison = Math.max(0, planet.garrison - gLoss);
    for (const f of attackers) {
      const iLoss = f.infantry * defenderForce * 0.0006;
      f.infantry = Math.max(0, f.infantry - iLoss);
    }

    if (b.liberation >= 100 || planet.garrison <= 0.5) {
      capturePlanet(state, planet, lead, attackers);
    }
  }
}

function capturePlanet(state: GameState, planet: Planet, attacker: FactionId, attackers: Fleet[]): void {
  const prev = planet.owner;
  const garrisonLost = planet.garrison;
  planet.owner = attacker;
  planet.battle = undefined;
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
  let landed = 0;
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
  pushLog(state, {
    faction: loser,
    text: `Столица пала — фракция «${FACTIONS[loser].name}» КАПИТУЛИРУЕТ! Миров перешло под контроль ${FACTION_GEN[victor]}: ${flipped}.`,
    tone: loser === state.player ? 'bad' : 'alert',
  });
}

function regrowGarrison(state: GameState, planet: Planet): void {
  // Окружённая планета не получает пополнений — гарнизон медленно тает.
  if (!planet.supplied) {
    planet.garrison = Math.max(1, planet.garrison - 0.5);
    return;
  }
  const cap = planet.isCapital ? 140 : 40 + planet.value * 8;
  if (planet.garrison < cap) {
    let growth = 0.4 + state.factions[planet.owner].bonuses.recruitment * 0.04;
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
