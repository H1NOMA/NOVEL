import type { FactionId } from '../core/types';
import { FACTIONS, FACTION_IDS } from '../data/factions';
import { pushChronicle, pushLog, type GameState } from './state';

// ---------------------------------------------------------------------------
// Отношения фракций.
//
// Партия начинается в мире: у каждой пары есть числовая симпатия (-100..100),
// война — это порог на этой шкале, а не изначальное свойство мира. Отношения
// сами ползут к «естественному» уровню пары (идеология), их портят общая
// граница и чужие захваты, а лечат перемирия, подарки и время.
//
// Рой — исключение: терминиды не государство и договоров не заключают. Они
// дремлют, пока их не потревожат, и после пробуждения воюют со всеми.
// ---------------------------------------------------------------------------

export interface Relation {
  a: FactionId;
  b: FactionId;
  /** Симпатия: -100 (кровная вражда) … +100 (союз). */
  value: number;
  war: boolean;
  /** День объявления войны — по нему считается усталость. */
  warSince?: number;
}

/** Порог, ниже которого терпение кончается и начинается война. */
export const WAR_THRESHOLD = -60;
/** Выше этого воюющие стороны готовы сесть за стол. */
export const PEACE_THRESHOLD = -25;

/** «Естественный» уровень пары: куда отношения сползают сами по себе. */
const NATURAL: Record<string, number> = {
  'automatons|superEarth': -55,   // память Киберстана
  'illuminate|superEarth': -45,   // вторжение из иного измерения
  'automatons|illuminate': -15,
  'superEarth|superFederation': -50,
  'automatons|superFederation': -20,
  'illuminate|superFederation': -20,
};

export function pairKey(a: FactionId, b: FactionId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function naturalFor(a: FactionId, b: FactionId): number {
  return NATURAL[pairKey(a, b)] ?? -10;
}

/** Дипломатия с роем невозможна: у терминидов нет представителей. */
export function canNegotiate(a: FactionId, b: FactionId): boolean {
  return a !== 'terminids' && b !== 'terminids';
}

export function initRelations(state: GameState): void {
  state.relations = [];
  // Супер-Федерация появляется поздно, но пара с ней нужна с первого дня:
  // иначе, поднявшись, она осталась бы со всеми в вечном мире.
  const all = Object.keys(state.factions) as FactionId[];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      // Старт мирный у всех: даже застарелая вражда начинается как холодный мир.
      const natural = naturalFor(a, b);
      state.relations.push({ a, b, value: Math.max(-35, natural + 30), war: false });
    }
  }
}

function find(state: GameState, a: FactionId, b: FactionId): Relation | undefined {
  const key = pairKey(a, b);
  return state.relations?.find((r) => pairKey(r.a, r.b) === key);
}

export function relationOf(state: GameState, a: FactionId, b: FactionId): number {
  if (a === b) return 100;
  return find(state, a, b)?.value ?? 0;
}

export function atWar(state: GameState, a: FactionId, b: FactionId): boolean {
  if (a === b) return false;
  // Марионетка воюет там же, где её сюзерен, и никогда — против него.
  const ma = state.puppets?.[a];
  const mb = state.puppets?.[b];
  if (ma === b || mb === a) return false;
  if (ma && ma !== b) {
    const r = find(state, ma, b);
    if (r?.war) return true;
  }
  return find(state, a, b)?.war ?? false;
}

/** Словесная оценка симпатии — её показывает интерфейс. */
export function relationLabel(value: number): string {
  if (value >= 50) return 'союзные';
  if (value >= 20) return 'дружественные';
  if (value >= -20) return 'ровные';
  if (value >= -45) return 'прохладные';
  if (value > WAR_THRESHOLD) return 'напряжённые';
  return 'враждебные';
}

export function adjustRelation(state: GameState, a: FactionId, b: FactionId, delta: number): void {
  const r = find(state, a, b);
  if (!r) return;
  r.value = Math.max(-100, Math.min(100, r.value + delta));
}

export function declareWar(state: GameState, a: FactionId, b: FactionId, reason: string): boolean {
  const r = find(state, a, b);
  if (!r || r.war) return false;
  r.war = true;
  r.warSince = state.day;
  r.value = Math.min(r.value, WAR_THRESHOLD - 5);
  pushLog(state, {
    text: `${FACTIONS[a].name} объявляет войну фракции «${FACTIONS[b].name}». Причина: ${reason}.`,
    tone: 'alert',
  });
  pushChronicle(state, `Война: ${FACTIONS[a].name} против ${FACTIONS[b].name} (${reason})`);
  return true;
}

export function makePeace(state: GameState, a: FactionId, b: FactionId): boolean {
  const r = find(state, a, b);
  if (!r || !r.war) return false;
  r.war = false;
  r.warSince = undefined;
  r.value = Math.max(r.value, PEACE_THRESHOLD + 10);
  pushLog(state, {
    text: `Мир подписан: ${FACTIONS[a].name} и ${FACTIONS[b].name} прекращают огонь.`,
    tone: 'good',
  });
  pushChronicle(state, `Мир: ${FACTIONS[a].name} и ${FACTIONS[b].name}`);
  return true;
}

/**
 * Ежедневный дрейф отношений. Тут и рождается война: общая граница и чужие
 * завоевания давят симпатию вниз, пока не кончится терпение.
 */
export function stepRelations(state: GameState): void {
  if (!state.relations?.length) initRelations(state);

  // Трение границы: сколько пар соседних планет принадлежит разным фракциям.
  const friction = new Map<string, number>();
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    for (const nid of p.links) {
      const n = state.galaxy.planets.get(nid);
      if (!n || n.owner === p.owner) continue;
      const key = pairKey(p.owner, n.owner);
      friction.set(key, (friction.get(key) ?? 0) + 1);
    }
  }

  for (const r of state.relations) {
    const key = pairKey(r.a, r.b);
    const natural = naturalFor(r.a, r.b);

    if (r.war) {
      // Усталость от войны: чем дольше бойня, тем сильнее тяга к столу.
      const days = state.day - (r.warSince ?? state.day);
      if (days > 120) r.value = Math.min(100, r.value + 0.06);
      continue;
    }

    // Тяга к естественному уровню — медленная, чтобы мир прожил хотя бы годы.
    r.value += (natural - r.value) * 0.0025;
    // Трение границы: каждая спорная стыковка отнимает симпатию.
    const f = friction.get(key) ?? 0;
    if (f > 0) r.value -= Math.min(0.09, f * 0.012);
    r.value = Math.max(-100, Math.min(100, r.value));

    // Терпение кончилось.
    if (r.value <= WAR_THRESHOLD) {
      const reason = f > 0 ? 'пограничные инциденты' : 'непримиримые разногласия';
      declareWar(state, r.a, r.b, reason);
    }
  }

  // Рой просыпается: пока терминиды спят, они ни с кем не воюют. Как только
  // рой разрастается или его тревожат, война начинается сама и навсегда.
  wakeSwarm(state);
}

/** Пробуждение роя: терминиды вступают в войну со всеми и мира не заключают. */
function wakeSwarm(state: GameState): void {
  if (state.swarmAwake) return;
  const termWorlds = state.galaxy.order
    .filter((id) => state.galaxy.planets.get(id)!.owner === 'terminids').length;
  const lost = state.galaxy.order
    .some((id) => {
      const p = state.galaxy.planets.get(id)!;
      return p.origin === 'terminids' && p.owner !== 'terminids';
    });
  // Рою нужен повод: отнятый мир или собственное разрастание.
  if (!lost && termWorlds < 26 && state.day < 200) return;
  state.swarmAwake = true;
  for (const f of FACTION_IDS) {
    if (f === 'terminids') continue;
    const r = find(state, 'terminids', f);
    if (r && !r.war) declareWar(state, 'terminids', f, lost ? 'посягательство на гнёзда' : 'голод роя');
  }
  pushChronicle(state, 'Рой пробудился: терминиды больше не спят');
}

// --- Территории, вассалитет и трофеи ------------------------------------------

/** Добровольная передача мира: дорого по власти, зато сильно греет отношения. */
export const CEDE_COST = 60;

export function cedePlanet(state: GameState, from: FactionId, to: FactionId, planetId: string): boolean {
  const p = state.galaxy.planets.get(planetId);
  const fs = state.factions[from];
  if (!p || p.owner !== from || from === to) return false;
  if (p.isCapital || p.battle) return false;              // столицу и поле боя не дарят
  if (!canNegotiate(from, to) || !state.factions[to].alive) return false;
  if (fs.politicalPower < CEDE_COST) return false;
  fs.politicalPower -= CEDE_COST;
  p.owner = to;
  adjustRelation(state, from, to, 18);
  pushLog(state, {
    faction: from,
    text: `${p.name} передан фракции «${FACTIONS[to].name}» по доброй воле. Дипломаты довольны, генералы — нет.`,
    tone: 'info',
  });
  return true;
}

/**
 * Столица пала. Побеждённый становится порабощённым, а победитель получает
 * его технологии: три узла чужого древа фокусов открываются как трофейные.
 */
export function onCapitalCaptured(state: GameState, victim: FactionId, conqueror: FactionId): void {
  if (victim === conqueror) return;
  state.subjugated = state.subjugated ?? {};
  state.trophies = state.trophies ?? {};
  if (state.subjugated[victim] === conqueror) return;
  state.subjugated[victim] = conqueror;

  const taken = state.trophies[conqueror] ?? [];
  state.trophies[conqueror] = [...new Set([...taken, victim])];

  pushLog(state, {
    faction: conqueror,
    text: `Столица фракции «${FACTIONS[victim].name}» пала. Её архивы, верфи и наработки достаются победителю.`,
    tone: 'good',
  });
  pushChronicle(state, `${FACTIONS[conqueror].name} покорил столицу фракции «${FACTIONS[victim].name}»`);
}

/**
 * Освобождение: чужую столицу отбили у поработителя. Побеждённый возвращается
 * в войну марионеткой освободителя — со своей армией, но чужой внешней волей.
 */
export function onCapitalLiberated(state: GameState, victim: FactionId, liberator: FactionId): void {
  state.subjugated = state.subjugated ?? {};
  state.puppets = state.puppets ?? {};
  if (state.subjugated[victim] === undefined) return;
  if (victim === liberator) {
    delete state.subjugated[victim];
    return;
  }
  delete state.subjugated[victim];
  state.puppets[victim] = liberator;
  state.factions[victim].alive = true;
  adjustRelation(state, victim, liberator, 60);
  const r = find(state, victim, liberator);
  if (r) {
    r.war = false;
    r.warSince = undefined;
  }
  pushLog(state, {
    faction: liberator,
    text: `${FACTIONS[victim].name} освобождены и возвращаются в войну как марионетка фракции «${FACTIONS[liberator].name}».`,
    tone: 'good',
  });
  pushChronicle(state, `${FACTIONS[victim].name} — марионетка фракции «${FACTIONS[liberator].name}»`);
}

/** Восстание Супер-Федерации: отколовшиеся объявляют войну всем разом. */
export function riseFederation(state: GameState): void {
  for (const f of Object.keys(state.factions) as FactionId[]) {
    if (f === 'superFederation') continue;
    declareWar(state, 'superFederation', f, 'провозглашение независимости Конкорда');
  }
}

/** Дань марионетки сюзерену: часть производства утекает наверх. */
export function collectTribute(state: GameState): void {
  if (!state.puppets) return;
  for (const [vassal, master] of Object.entries(state.puppets) as [FactionId, FactionId][]) {
    const vs = state.factions[vassal];
    const ms = state.factions[master];
    if (!vs?.alive || !ms?.alive) continue;
    const tribute = Math.min(vs.production, vs.production * 0.15);
    vs.production -= tribute;
    ms.production += tribute;
  }
}
