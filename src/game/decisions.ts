import { fleetsAt, isHuman, pushChronicle, pushLog, type GameState } from './state';
import { buildDepot, onOwnerChanged } from './supply';
import { beginBuild, hasOrBuilding } from './construction';
import { DIVISION_COST, DIVISION_SIZE, FACTORY_DEFS, SHIP_CLASSES, troopDef, type ShipClassId } from '../data/troops';
import { SPECIALS } from '../data/factions';
import { spawnFleet } from './state';
import type { FactionId } from '../core/types';
import { retreatFleets } from './units';
import { removeFleet } from './state';
import { FACTION_GEN } from '../data/factions';
import { bonusesFor, buyBonus, canBuyBonus } from './politics';

// ---------------------------------------------------------------------------
// «Решения» — спецмеханики, открываемые фокусами:
//   • Мрак (терминиды): выбранный сектор постепенно окутывается спорами;
//     чужие флоты без спецтехнологии не могут входить в окутанные миры.
//   • Бездна (иллюминаты): экзошпиль на своей планете через время утягивает
//     её из реальности — планета исчезает с карты для всех, кроме иллюминатов.
//   • Точки снабжения — доступны всем фракциям (ИИ строит их сам).
// ---------------------------------------------------------------------------

const SPIRE_DAYS = 30;
export const GLOOM_SEED_DAYS = 60;

/** Сектор планеты полностью принадлежит фракции (обломки не в счёт)? */
export function sectorFullyOwned(state: GameState, planetId: string, faction: FactionId): boolean {
  const planet = state.galaxy.planets.get(planetId);
  if (!planet) return false;
  const sector = [...state.galaxy.sectors.values()].find((sec) => sec.planets.includes(planetId));
  if (!sector) return false;
  return sector.planets
    .map((id) => state.galaxy.planets.get(id)!)
    .filter((p) => !p.shattered)
    .every((p) => p.owner === faction);
}

/**
 * Заронить зачаток Мрака на планете терминидов. Требования: изучен фокус
 * «Споровое облако» и планета лежит в СЕКТОРЕ, ПОЛНОСТЬЮ захваченном роем.
 * Мрак зреет 60 дней, после чего планета скрывается в споровом дыму.
 */
export function plantGloomSeed(state: GameState, planetId: string): boolean {
  if (!state.factions.terminids.flags.gloomSpread) return false;
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.owner !== 'terminids' || p.gloom || p.abyss || p.shattered) return false;
  if (state.gloomSeeds.some((g) => g.planet === planetId)) return false;
  if (!sectorFullyOwned(state, planetId, 'terminids')) return false;
  state.gloomSeeds.push({ planet: planetId, daysLeft: GLOOM_SEED_DAYS });
  pushLog(state, {
    faction: 'terminids',
    text: `На ${p.name} заронен зачаток Мрака. Споровые тучи сгустятся через ${GLOOM_SEED_DAYS} дней.`,
    tone: 'alert',
  });
  return true;
}

/** Воздвигнуть экзошпиль на планете иллюминатов. */
export function raiseSpire(state: GameState, planetId: string): boolean {
  if (!state.factions.illuminate.flags.abyss) return false;
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.owner !== 'illuminate' || p.abyss) return false;
  if (state.spires.some((s) => s.planet === planetId)) return false;
  state.spires.push({ planet: planetId, daysLeft: SPIRE_DAYS });
  pushLog(state, {
    faction: 'illuminate',
    text: `Над ${p.name} воздвигнут экзошпиль. Пространство вокруг начинает истончаться…`,
    tone: 'alert',
  });
  return true;
}

/** Ежедневный шаг Мрака, Бездны и ИИ-решений. */
export function stepDecisions(state: GameState): void {
  stepGloom(state);
  stepAbyss(state);
  stepFederationDefection(state);
  aiDecisions(state);
}

function stepGloom(state: GameState): void {
  const term = state.factions.terminids;
  if (!term.flags.gloomSpread || !term.alive) return;

  // Зреющие зачатки: планета теряет зачаток вместе с потерей планеты.
  for (const seed of [...state.gloomSeeds]) {
    const p = state.galaxy.planets.get(seed.planet);
    if (!p || p.owner !== 'terminids' || p.shattered) {
      state.gloomSeeds = state.gloomSeeds.filter((g) => g !== seed);
      continue;
    }
    seed.daysLeft--;
    if (seed.daysLeft <= 0) {
      state.gloomSeeds = state.gloomSeeds.filter((g) => g !== seed);
      p.gloom = true;
      pushLog(state, {
        text: `Мрак поглощает ${p.name}. Планета скрылась в споровом дыму — чужие корабли не могут пробиться.`,
        tone: 'alert',
      });
    }
  }

  // ИИ терминидов сам зарождает Мрак в полностью захваченных секторах.
  if (!isHuman(state, 'terminids') && state.gloomSeeds.length < 2 && state.day % 15 === 0) {
    const candidate = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .find((p) =>
        p.owner === 'terminids' && !p.gloom && !p.abyss && !p.shattered &&
        !state.gloomSeeds.some((g) => g.planet === p.id) &&
        sectorFullyOwned(state, p.id, 'terminids'));
    if (candidate) plantGloomSeed(state, candidate.id);
  }
}

function stepAbyss(state: GameState): void {
  for (const spire of [...state.spires]) {
    const p = state.galaxy.planets.get(spire.planet);
    if (!p || p.owner !== 'illuminate') {
      // Шпиль разрушен вместе с потерей планеты.
      state.spires = state.spires.filter((s) => s !== spire);
      continue;
    }
    spire.daysLeft--;
    if (spire.daysLeft <= 0) {
      state.spires = state.spires.filter((s) => s !== spire);
      p.abyss = true;
      p.battle = undefined;
      // Чужие флоты на орбите: успевают отступить — или исчезают вместе с планетой.
      for (const faction of ['superEarth', 'automatons', 'terminids', 'superFederation'] as const) {
        retreatFleets(state, p.id, faction);
      }
      for (const fid of [...state.fleetOrder]) {
        const f = state.fleets.get(fid);
        if (f && f.at === p.id && !f.transit && f.faction !== 'illuminate') {
          pushLog(state, {
            faction: f.faction,
            text: `Флот ${FACTION_GEN[f.faction]} исчезает вместе с ${p.name} — поглощён Бездной.`,
            tone: f.faction === state.player ? 'bad' : 'info',
          });
          removeFleet(state, fid);
        }
      }
      pushLog(state, {
        text: `${p.name} погружается в БЕЗДНУ. Планета исчезла из реального пространства.`,
        tone: 'alert',
      });
    }
  }

  // ИИ иллюминатов время от времени топит очередной тыловой мир.
  const ill = state.factions.illuminate;
  if (ill.flags.abyss && ill.alive && !isHuman(state, 'illuminate')
    && state.day % 35 === 0 && state.spires.length === 0) {
    const candidates = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .filter((p) => p.owner === 'illuminate' && !p.abyss && !p.isCapital && !p.battle);
    if (candidates.length) raiseSpire(state, state.rng.pick(candidates).id);
  }
}

/** Построить фабрику особого отряда (только автоматоны). */
export function buildFactory(state: GameState, faction: FactionId, planetId: string, kind: string): boolean {
  if (faction !== 'automatons') return false;
  const def = FACTORY_DEFS.find((f) => f.id === kind);
  const p = state.galaxy.planets.get(planetId);
  const fs = state.factions[faction];
  if (!def || !p || p.owner !== faction || p.build || hasOrBuilding(p, kind) || fs.production < def.cost) return false;
  fs.production -= def.cost;
  return beginBuild(state, p, kind, def.cost);
}

/** Развернуть добычу Е-711 (Супер-Земля, разовое решение). */
export function enableE711Mining(state: GameState): boolean {
  const se = state.factions.superEarth;
  if (se.flags.e711Mining || se.production < 40) return false;
  se.production -= 40;
  se.flags.e711Mining = true;
  pushLog(state, {
    faction: 'superEarth',
    text: 'Развёрнута добыча Е-711 на освобождённых терминидских мирах. Топливо потечёт во флот.',
    tone: 'good',
  });
  return true;
}

/** Произвести пехотную дивизию (+15 в пул типа) за очки производства. */
export function produceDivision(state: GameState, faction: FactionId, troopId: string): boolean {
  const fs = state.factions[faction];
  const def = troopDef(troopId);
  if (!def || def.faction !== faction || fs.production < DIVISION_COST) return false;
  // Особые правила: легионы киборгов требуют Киберстан, отряды АВТ — фабрик,
  // Великий флот иллюминатов невосполним даже производством.
  if (troopId === 'greatFleet') return false;
  if (troopId === 'cyborgLegion') {
    const hasCyberstan = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .some((p) => p.owner === 'automatons' && p.isCapital && p.origin === 'automatons');
    if (!hasCyberstan) return false;
  }
  if (troopId === 'incinerators' || troopId === 'jets') {
    const need = troopId === 'incinerators' ? 'incinFactory' : 'jetFactory';
    const has = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .some((p) => p.owner === faction && p.buildings.includes(need));
    if (!has) return false;
  }
  fs.production -= DIVISION_COST;
  fs.units[troopId] = (fs.units[troopId] ?? 0) + DIVISION_SIZE;
  return true;
}

/** Построить корабли выбранного класса: пополняют флот у столицы или встают новым.
 *  Корпуса требуют и производства, и ископаемых. */
export function produceShips(state: GameState, faction: FactionId, cls: ShipClassId): boolean {
  const fs = state.factions[faction];
  const def = SHIP_CLASSES.find((c) => c.id === cls)!;
  if (fs.production < def.cost || fs.resources.minerals < def.minerals) return false;
  fs.resources.minerals -= def.minerals;
  const worlds = state.galaxy.order
    .map((id) => state.galaxy.planets.get(id)!)
    .filter((p) => p.owner === faction && !p.shattered);
  const yard = worlds.find((p) => p.isCapital) ?? worlds[0];
  if (!yard) return false;
  fs.production -= def.cost;
  const docked = fleetsAt(state, yard.id).find((f) => f.faction === faction && !f.special);
  const apply = (fl: { ships: number; dreadnoughts: number; battleships: number }) => {
    if (cls === 'destroyer') fl.ships += def.count;
    else if (cls === 'dreadnought') fl.dreadnoughts += def.count;
    else fl.battleships += def.count;
  };
  if (docked) apply(docked);
  else {
    const fl = spawnFleet(state, faction, yard.id, { ships: 0, infantry: 0 });
    apply(fl);
  }
  pushLog(state, {
    faction,
    text: `Верфи ${yard.name}: со стапелей сходит ${def.name.toLowerCase()} (${def.count} корп.).`,
    tone: faction === state.player ? 'good' : 'info',
  });
  return true;
}

export const TERMICIDE_COST = 60;

/** Установить систему распространения термицида на своей планете (СЗ). */
export function installTermicide(state: GameState, planetId: string): boolean {
  const se = state.factions.superEarth;
  if (!se.flags.termicide || se.production < TERMICIDE_COST) return false;
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.owner !== 'superEarth' || p.build || hasOrBuilding(p, 'termicide')) return false;
  se.production -= TERMICIDE_COST;
  return beginBuild(state, p, 'termicide', TERMICIDE_COST);
}

export const SPECIAL_REBUILD_COST = 300;
export const SUPER_SHOT_COOLDOWN = 1000;
export const SPECIAL_DOCK_COST = 120;
export const E711_STATION_COST = 60;

/** Планета фракции с сервисным доком супероружия (если есть). */
export function specialDockWorld(state: GameState, faction: FactionId): string | null {
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    if (p.owner === faction && p.buildings.includes('specialDock') && !p.shattered) return id;
  }
  return null;
}

/** Построить особую верфь и сервисный док супероружия (нужны чертежи). */
export function buildSpecialDock(state: GameState, faction: FactionId, planetId: string): boolean {
  const fs = state.factions[faction];
  const p = state.galaxy.planets.get(planetId);
  if (!fs.specialUnlocked || !p || p.owner !== faction || !p.supplied) return false;
  if (p.build || hasOrBuilding(p, 'specialDock') || specialDockWorld(state, faction)) return false;
  if (fs.production < SPECIAL_DOCK_COST) return false;
  fs.production -= SPECIAL_DOCK_COST;
  return beginBuild(state, p, 'specialDock', SPECIAL_DOCK_COST);
}

/** Станция добычи Е-711 на жучьем мире-марионетке (только Супер-Земля). */
export function buildE711Station(state: GameState, planetId: string): boolean {
  const se = state.factions.superEarth;
  const p = state.galaxy.planets.get(planetId);
  if (!p || p.puppetOf !== 'superEarth' || p.build || hasOrBuilding(p, 'e711Station')) return false;
  if (se.production < E711_STATION_COST) return false;
  se.production -= E711_STATION_COST;
  return beginBuild(state, p, 'e711Station', E711_STATION_COST);
}

/** Дней до готовности планетарного залпа (0 = заряжен). */
export function superShotReadyIn(state: GameState, faction: FactionId): number {
  return Math.max(0, SUPER_SHOT_COOLDOWN - (state.day - state.factions[faction].superShotDay));
}

/**
 * Планетарный залп DSS/ASS: мгновенно уничтожает планету, на орбите которой
 * стоит станция. Остаётся лишь поле обломков — линии снабжения к нему мертвы.
 * Перезарядка — 1000 дней.
 */
export function fireSuperweapon(state: GameState, faction: FactionId, planetId: string): boolean {
  if (faction !== 'superEarth' && faction !== 'automatons') return false;
  const fs = state.factions[faction];
  const planet = state.galaxy.planets.get(planetId);
  if (!planet || planet.shattered || planet.abyss || planet.owner === faction) return false;
  if (superShotReadyIn(state, faction) > 0) return false;
  const station = fleetsAt(state, planetId).find((f) => f.faction === faction && f.special);
  if (!station) return false;

  fs.superShotDay = state.day;
  const name = planet.name;

  // Всё на орбите, кроме стрелявшей станции, гибнет во взрыве.
  for (const fid of [...state.fleetOrder]) {
    const f = state.fleets.get(fid);
    if (!f || f.at !== planetId || f.transit || f.id === station.id) continue;
    if (f.special) state.factions[f.faction].lostSpecial = true;
    removeFleet(state, fid);
  }

  // Планета перестаёт существовать.
  planet.shattered = true;
  planet.garrison = 0;
  planet.cities = [];
  planet.battle = undefined;
  planet.depot = false;
  planet.buildings = [];
  planet.gloom = false;
  planet.e711Rich = false;
  planet.fortification = 0;
  planet.value = 0;
  state.spires = state.spires.filter((sp) => sp.planet !== planetId);

  pushChronicle(state, `${SPECIALS[faction].name} уничтожает планету ${name} орбитальным залпом.`);
  pushLog(state, {
    faction,
    text: `${SPECIALS[faction].name} открывает огонь по ${name}. Планета УНИЧТОЖЕНА — осталось лишь поле обломков. Перезарядка: ${SUPER_SHOT_COOLDOWN} дней.`,
    tone: 'alert',
  });
  return true;
}

/**
 * Переприсяга: после восстания Супер-Федерации миры Супер-Земли, оставшиеся
 * без орбитального прикрытия при низкой стабильности, добровольно переходят
 * под оранжевое знамя.
 */
function stepFederationDefection(state: GameState): void {
  if (!state.superFederationRisen || !state.factions.superFederation.alive) return;
  if (state.factions.superEarth.stability >= 40) return;
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    if (p.owner !== 'superEarth' || p.isCapital || p.shattered || p.battle) continue;
    // «Фрегаты» СЗ на орбите удерживают лояльность.
    const guarded = fleetsAt(state, id).some((f) => f.faction === 'superEarth');
    if (guarded) continue;
    if (state.rng.chance(0.018)) {
      p.owner = 'superFederation';
      onOwnerChanged(p);
      for (const c of p.cities) c.holder = 'superFederation';
      pushLog(state, {
        text: `${p.name} присягает СУПЕР-ФЕДЕРАЦИИ: стабильность пала, орбита пуста — колония сделала выбор.`,
        tone: 'alert',
      });
    }
  }
}

/** Восстановить уничтоженное супероружие — очень дорого.
 *  Сервисный док вдвое удешевляет работы, и станция сходит со стапелей там. */
export function rebuildSpecial(state: GameState, faction: FactionId): boolean {
  const fs = state.factions[faction];
  const dockId = specialDockWorld(state, faction);
  const cost = dockId ? SPECIAL_REBUILD_COST * 0.5 : SPECIAL_REBUILD_COST;
  if (!fs.specialUnlocked || !fs.lostSpecial || fs.production < cost) return false;
  const worlds = state.galaxy.order
    .map((id) => state.galaxy.planets.get(id)!)
    .filter((p) => p.owner === faction);
  const home = (dockId ? state.galaxy.planets.get(dockId) : undefined)
    ?? worlds.find((p) => p.isCapital) ?? worlds[0];
  if (!home) return false;
  fs.production -= cost;
  fs.lostSpecial = false;
  spawnFleet(state, faction, home.id, { ships: 14, infantry: 30, special: SPECIALS[faction].id });
  pushLog(state, {
    faction,
    text: `${SPECIALS[faction].name} — восстановлен(а) ценой колоссальных ресурсов и вновь на орбите ${home.name}.`,
    tone: faction === state.player ? 'good' : 'alert',
  });
  return true;
}

/** ИИ-фракции строят точки снабжения на ценных мирах. */
function aiDecisions(state: GameState): void {
  // Живая фракция ПОД ИИ. За человеческие стороны здесь не решает никто: в
  // сетевой партии их несколько, и тратить чужое производство «за игрока» —
  // ровно тот рассинхрон, из-за которого казалось, что мир живёт своей жизнью.
  const ai = (f: FactionId): boolean => state.factions[f].alive && !isHuman(state, f);

  // Утраченное супероружие ИИ восстанавливает, как только накопит ресурсы.
  for (const faction of ['automatons', 'illuminate', 'terminids', 'superFederation'] as const) {
    const fs = state.factions[faction];
    if (ai(faction) && fs.lostSpecial && fs.production >= SPECIAL_REBUILD_COST + 60) {
      rebuildSpecial(state, faction);
    }
  }
  // ASS автоматонов, зависнув над вражеским миром с заряженным орудием, стреляет.
  if (ai('automatons') && superShotReadyIn(state, 'automatons') === 0) {
    for (const fid of state.fleetOrder) {
      const f = state.fleets.get(fid);
      if (!f || f.faction !== 'automatons' || !f.special || f.transit) continue;
      const p = state.galaxy.planets.get(f.at);
      if (p && p.owner !== 'automatons' && !p.shattered && !p.abyss && p.garrison > 40) {
        fireSuperweapon(state, 'automatons', p.id);
      }
      break;
    }
  }
  // План «плацдарм супероружия»: заняв магмовый мир с богатыми залежами,
  // автоматоны разворачивают там особую верфь и сервисный док ССА.
  const autFs = state.factions.automatons;
  if (ai('automatons') && autFs.specialUnlocked && !specialDockWorld(state, 'automatons')) {
    const site = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .find((p) => p.owner === 'automatons' && p.biome === 'magma' && p.minerals >= 2 && p.supplied);
    if (site && autFs.production >= SPECIAL_DOCK_COST + 40) {
      buildSpecialDock(state, 'automatons', site.id);
    }
  }

  // Автоматоны в приоритете строят фабрики особых отрядов.
  const aut = state.factions.automatons;
  if (ai('automatons') && aut.production >= 120) {
    const own = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .filter((p) => p.owner === 'automatons' && p.supplied)
      .sort((a, b) => b.value - a.value);
    const built = new Set(own.flatMap((p) => p.buildings));
    for (const def of FACTORY_DEFS) {
      if (!built.has(def.id) && own.length) {
        buildFactory(state, 'automatons', own[0]!.id, def.id);
        break;
      }
    }
  }
  for (const faction of ['automatons', 'illuminate', 'terminids', 'superFederation'] as const) {
    const fs = state.factions[faction];
    if (!ai(faction)) continue;
    if (fs.production >= 120) {
      const worlds = state.galaxy.order
        .map((id) => state.galaxy.planets.get(id)!)
        .filter((p) => p.owner === faction && !p.depot && p.supplied)
        .sort((a, b) => b.value - a.value);
      if (worlds.length) buildDepot(state, faction, worlds[0]!.id);
    }
    // Богатый ИИ вкладывается в тяжёлые корабли и дивизии.
    if (fs.production >= 380) produceShips(state, faction, 'battleship');
    else if (fs.production >= 220) produceShips(state, faction, 'dreadnought');
    // Накопленную политвласть ИИ тратит на первый доступный бонус.
    if (fs.politicalPower >= 160) {
      const pick = bonusesFor(faction).find((b) => canBuyBonus(state, faction, b.id));
      if (pick) buyBonus(state, faction, pick.id);
    }
    if (fs.production >= 150) {
      const own = Object.entries(fs.units)
        .filter(([id]) => id !== 'greatFleet')
        .sort(([, a], [, b]) => a - b);
      if (own.length && own[0]![1] < 60) produceDivision(state, faction, own[0]![0]);
    }
  }
}
