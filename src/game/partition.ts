import type { FactionId, Planet } from '../core/types';
import { FACTIONS, FACTION_GEN, FACTION_IDS } from '../data/factions';
import { bus } from '../core/emitter';
import { onOwnerChanged } from './supply';
import { pushChronicle, pushLog, planetsOf, type GameState } from './state';

// ---------------------------------------------------------------------------
// Делёж наследства побеждённой фракции.
//
// Раньше падение столицы означало, что ВСЕ миры проигравшего одним движением
// доставались тому, кто взял столицу, — даже если три года войну с ним вели
// совсем другие. Теперь наследство делится по заслугам: каждая фракция весь
// ход войны копит очки против каждой другой, и на разделе они превращаются
// в квоту миров.
//
// Очки начисляются за то, что действительно стоило крови:
//   • захват мира у этой фракции — по стратегической ценности мира;
//   • взятие столицы — отдельная крупная награда;
//   • уничтоженные корпуса её флота.
//
// Раздел останавливает время: пока участники не подтвердили итог, партия
// стоит. ИИ подтверждает сразу, люди — кнопкой.
// ---------------------------------------------------------------------------

/** Очки за взятие столицы: столица весит больше десятка обычных миров. */
export const CAPITAL_SCORE = 120;
/** Очки за уничтоженный корпус вражеского флота. */
export const HULL_SCORE = 1.5;
/** Множитель ценности мира при его захвате. */
export const PLANET_SCORE = 3;

export interface PartitionShare {
  faction: FactionId;
  /** Накопленные очки войны против проигравшего. */
  score: number;
  /** Доля от общего числа очков, 0…1. */
  share: number;
  /** Сколько миров причитается по доле. */
  quota: number;
  /** Что досталось фактически (может отличаться на ±1 из-за округления). */
  planets: string[];
}

export interface Partition {
  loser: FactionId;
  /** Кто нанёс последний удар — за ним столица проигравшего. */
  finisher: FactionId | null;
  shares: PartitionShare[];
  /** Итоговая раскладка: мир → кому уходит. */
  spoils: { planet: string; to: FactionId }[];
  /** Кто уже подтвердил итог. ИИ попадает сюда сразу. */
  confirmed: FactionId[];
  /** Скорость партии до паузы — вернём её после подтверждения. */
  prevSpeed: 0 | 1 | 2 | 3;
}

/** Начислить очки войны: `by` заработал против `against`. */
export function addWarScore(state: GameState, by: FactionId, against: FactionId, points: number): void {
  if (by === against || points <= 0) return;
  const board = (state.warScore[against] ??= {});
  board[by] = (board[by] ?? 0) + points;
}

/** Очки, накопленные фракцией против указанной. */
export function warScoreOf(state: GameState, by: FactionId, against: FactionId): number {
  return state.warScore[against]?.[by] ?? 0;
}

/**
 * Насколько мир «тянется» к фракции: сколько её владений с ним граничит.
 *
 * Раздел по одним квотам нарезал бы чересполосицу — фракция получала бы миры
 * на другом конце галактики, отрезанные от снабжения в тот же день. Поэтому
 * внутри своей квоты каждый берёт то, что ближе к его границе.
 */
function affinity(state: GameState, planet: Planet, faction: FactionId): number {
  let touch = 0;
  for (const id of planet.links) {
    const n = state.galaxy.planets.get(id);
    if (n && n.owner === faction && !n.shattered) touch++;
  }
  return touch;
}

/**
 * Составить раскладку наследства.
 *
 * Порядок намеренно такой: сначала столица уходит добившему (он оплатил её
 * штурм), затем остальные миры расходятся по квотам, и на каждом шаге мир
 * берёт та фракция, которой он ближе всего и у которой квота ещё не выбрана.
 */
export function planPartition(state: GameState, loser: FactionId, finisher: FactionId | null): Partition {
  const pool = planetsOf(state, loser).filter((p) => !p.shattered);
  const claimants = FACTION_IDS.filter(
    (f) => f !== loser && state.factions[f]?.alive && f !== state.factions[loser].id);

  const scores = claimants.map((f) => ({ faction: f, score: warScoreOf(state, f, loser) }));
  let total = scores.reduce((s, x) => s + x.score, 0);

  // Никто не воевал с проигравшим (например, фракция вымерла сама) — наследство
  // делится поровну между живыми, иначе делить было бы нечего.
  if (total <= 0) {
    for (const s of scores) s.score = 1;
    total = scores.length;
  }

  const spoils: { planet: string; to: FactionId }[] = [];
  const taken = new Set<string>();

  // Столица — добившему: её штурм и есть то, чем закончилась война.
  const capital = pool.find((p) => p.isCapital);
  if (capital && finisher && claimants.includes(finisher)) {
    spoils.push({ planet: capital.id, to: finisher });
    taken.add(capital.id);
  }

  const rest = pool.filter((p) => !taken.has(p.id));
  const shares: PartitionShare[] = scores.map((s) => ({
    faction: s.faction,
    score: s.score,
    share: total > 0 ? s.score / total : 0,
    quota: 0,
    planets: [],
  }));
  for (const sh of shares) sh.quota = Math.floor(sh.share * rest.length);
  // Остаток от округления уходит сильнейшим по очкам — по одному миру.
  let leftover = rest.length - shares.reduce((s, x) => s + x.quota, 0);
  for (const sh of [...shares].sort((a, b) => b.score - a.score)) {
    if (leftover <= 0) break;
    sh.quota++;
    leftover--;
  }

  // Мир достаётся тому, к чьей границе он ближе, среди тех, у кого есть квота.
  // Порядок обхода — от самых ценных миров к простым: ценное разбирают первым,
  // и решает именно близость, а не случайный порядок в списке.
  const byValue = [...rest].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const left = new Map(shares.map((s) => [s.faction, s.quota]));
  for (const p of byValue) {
    let best: FactionId | null = null;
    let bestScore = -1;
    for (const sh of shares) {
      if ((left.get(sh.faction) ?? 0) <= 0) continue;
      // При равной близости решают очки войны: заслуженнее — тот, кто больше
      // сделал для победы.
      const a = affinity(state, p, sh.faction) * 1000 + sh.score;
      if (a > bestScore) { bestScore = a; best = sh.faction; }
    }
    // Квоты кончились у всех (бывает при округлении вниз) — мир идёт сильнейшему.
    if (!best) best = shares.reduce((m, s) => (s.score > m.score ? s : m), shares[0]!).faction;
    spoils.push({ planet: p.id, to: best });
    left.set(best, (left.get(best) ?? 0) - 1);
  }

  for (const sp of spoils) {
    shares.find((s) => s.faction === sp.to)?.planets.push(sp.planet);
  }
  shares.sort((a, b) => b.score - a.score);
  return { loser, finisher, shares, spoils, confirmed: [], prevSpeed: state.speed };
}

/**
 * Открыть раздел: партия встаёт на паузу, ИИ сразу подтверждает свою долю.
 * Возвращает false, если делить нечего (тогда фракция просто уходит).
 */
export function openPartition(state: GameState, loser: FactionId, finisher: FactionId | null): boolean {
  if (state.partition) return false;
  const plan = planPartition(state, loser, finisher);
  if (!plan.spoils.length) return false;
  // Подтверждение нужно только от людей: ИИ согласен с разделом по очкам.
  const humans = (state.humans?.length ? state.humans : [state.player])
    .filter((f) => f !== loser && state.factions[f]?.alive);
  plan.confirmed = FACTION_IDS.filter((f) => !humans.includes(f));
  state.partition = plan;
  state.speed = 0;
  pushLog(state, {
    faction: loser,
    text: `Фракция «${FACTIONS[loser].name}» повержена. Победители делят её наследство: ${plan.spoils.length} миров.`,
    tone: 'alert',
  });
  bus.emit('partitionOpened', { loser });
  // За столом нет ни одного живого человека — делим и идём дальше.
  if (!humans.length) applyPartition(state);
  return true;
}

/** Подтвердить итог раздела от имени фракции. */
export function confirmPartition(state: GameState, faction: FactionId): boolean {
  const p = state.partition;
  if (!p || p.confirmed.includes(faction)) return false;
  if (faction === p.loser || !state.factions[faction]?.alive) return false;
  p.confirmed.push(faction);
  if (FACTION_IDS.every((f) => p.confirmed.includes(f))) applyPartition(state);
  return true;
}

/** Раздать миры по раскладке и снять паузу. */
export function applyPartition(state: GameState): void {
  const p = state.partition;
  if (!p) return;
  let moved = 0;
  for (const sp of p.spoils) {
    const planet = state.galaxy.planets.get(sp.planet);
    if (!planet || planet.owner !== p.loser) continue;
    planet.owner = sp.to;
    onOwnerChanged(planet);
    // Наследство достаётся разорённым: гарнизон побеждённого не переходит
    // новому хозяину целиком.
    planet.garrison = Math.max(5, planet.garrison * 0.5);
    planet.battle = undefined;
    // С падением владык миры Бездны возвращаются в реальность.
    if (planet.abyss) planet.abyss = false;
    moved++;
  }
  const parts = p.shares
    .filter((s: PartitionShare) => s.planets.length)
    .map((s: PartitionShare) => `${FACTIONS[s.faction].name} — ${s.planets.length}`)
    .join(', ');
  pushChronicle(state, `Раздел наследства «${FACTIONS[p.loser].name}»: ${parts || 'миров не осталось'}.`);
  pushLog(state, {
    faction: p.loser,
    text: `Наследство ${FACTION_GEN[p.loser]} разделено: ${parts || 'делить было нечего'}. Всего миров: ${moved}.`,
    tone: 'alert',
  });
  state.speed = p.prevSpeed;
  state.partition = null;
  bus.emit('partitionClosed', { loser: p.loser });
}
