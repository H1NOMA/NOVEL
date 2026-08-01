import { pushLog, type GameState } from './state';
import { buildDepot } from './supply';
import { retreatFleets } from './units';
import { removeFleet } from './state';
import { FACTION_GEN } from '../data/factions';

// ---------------------------------------------------------------------------
// «Решения» — спецмеханики, открываемые фокусами:
//   • Мрак (терминиды): выбранный сектор постепенно окутывается спорами;
//     чужие флоты без спецтехнологии не могут входить в окутанные миры.
//   • Бездна (иллюминаты): экзошпиль на своей планете через время утягивает
//     её из реальности — планета исчезает с карты для всех, кроме иллюминатов.
//   • Точки снабжения — доступны всем фракциям (ИИ строит их сам).
// ---------------------------------------------------------------------------

const SPIRE_DAYS = 30;
const GLOOM_DAILY_CHANCE = 0.3;

/** Назначить сектор целью распространения Мрака. */
export function directGloom(state: GameState, sectorId: string): boolean {
  if (!state.factions.terminids.flags.gloomSpread) return false;
  if (!state.galaxy.sectors.has(sectorId)) return false;
  state.gloomTarget = sectorId;
  const sector = state.galaxy.sectors.get(sectorId)!;
  pushLog(state, {
    faction: 'terminids',
    text: `Споровые тучи стягиваются к ${sector.name}. Мрак пришёл в движение.`,
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
  aiDecisions(state);
}

function stepGloom(state: GameState): void {
  const term = state.factions.terminids;
  if (!term.flags.gloomSpread || !term.alive) return;

  // ИИ терминидов сам выбирает цель, если её нет или она исчерпана.
  if (!state.gloomTarget || sectorFullyGloomed(state, state.gloomTarget)) {
    const candidate = pickGloomSector(state);
    if (candidate) directGloom(state, candidate);
    else state.gloomTarget = null;
  }
  if (!state.gloomTarget) return;

  if (state.rng.chance(GLOOM_DAILY_CHANCE)) {
    const sector = state.galaxy.sectors.get(state.gloomTarget)!;
    const target = sector.planets
      .map((id) => state.galaxy.planets.get(id)!)
      .find((p) => p.owner === 'terminids' && !p.gloom && !p.abyss);
    if (target) {
      target.gloom = true;
      pushLog(state, {
        text: `Мрак поглощает ${target.name}. Чужие корабли не могут пробиться сквозь споры.`,
        tone: 'alert',
      });
    }
  }
}

function sectorFullyGloomed(state: GameState, sectorId: string): boolean {
  const sector = state.galaxy.sectors.get(sectorId);
  if (!sector) return true;
  return !sector.planets
    .map((id) => state.galaxy.planets.get(id)!)
    .some((p) => p.owner === 'terminids' && !p.gloom);
}

function pickGloomSector(state: GameState): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const sector of state.galaxy.sectors.values()) {
    const count = sector.planets
      .map((id) => state.galaxy.planets.get(id)!)
      .filter((p) => p.owner === 'terminids' && !p.gloom).length;
    if (count > bestCount) {
      bestCount = count;
      best = sector.id;
    }
  }
  return best;
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
  if (ill.flags.abyss && ill.alive && state.day % 35 === 0 && state.spires.length === 0) {
    const candidates = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .filter((p) => p.owner === 'illuminate' && !p.abyss && !p.isCapital && !p.battle);
    if (candidates.length) raiseSpire(state, state.rng.pick(candidates).id);
  }
}

/** ИИ-фракции строят точки снабжения на ценных мирах. */
function aiDecisions(state: GameState): void {
  for (const faction of ['automatons', 'illuminate', 'terminids', 'superFederation'] as const) {
    const fs = state.factions[faction];
    if (!fs.alive || fs.production < 120) continue;
    const worlds = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .filter((p) => p.owner === faction && !p.depot && p.supplied)
      .sort((a, b) => b.value - a.value);
    if (worlds.length) buildDepot(state, faction, worlds[0]!.id);
  }
}
