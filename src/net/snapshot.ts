import { RNG } from '../core/rng';
import { deserializeState, serializeState } from '../game/persist';
import type { GameState } from '../game/state';

// ---------------------------------------------------------------------------
// Снапшоты сетевой партии. Формат ровно тот же, что у сохранений: второй
// сериализатор не пишется, иначе он неизбежно разъедется с первым.
//
// ГЛАВНОЕ ПРАВИЛО: применение снапшота МУТИРУЕТ существующий объект состояния,
// а не подменяет его. Сцена, часы и интерфейс держат ссылку на один и тот же
// GameState с момента запуска — подмена оставила бы их смотреть на мёртвый
// объект: галактика замерла бы, а лог продолжал капать.
// ---------------------------------------------------------------------------

export function encodeSnapshot(state: GameState): string {
  return serializeState(state, 'net', 'net');
}

/** Наложить снапшот на живое состояние, сохранив ссылку на объект. */
export function applySnapshot(target: GameState, json: string): void {
  const fresh = deserializeState(json);

  // Карты пересобираются на месте и строго в порядке order/fleetOrder:
  // обходы ИИ, снабжения и боёв зависят от порядка вставки.
  target.galaxy.planets.clear();
  for (const id of fresh.galaxy.order) {
    const p = fresh.galaxy.planets.get(id);
    if (p) target.galaxy.planets.set(id, p);
  }
  target.galaxy.order = fresh.galaxy.order;
  target.galaxy.lines = fresh.galaxy.lines;
  target.galaxy.sectors.clear();
  for (const [id, s] of fresh.galaxy.sectors) target.galaxy.sectors.set(id, s);
  target.galaxy.radiusMax = fresh.galaxy.radiusMax;

  target.fleets.clear();
  for (const id of fresh.fleetOrder) {
    const f = fresh.fleets.get(id);
    if (f) target.fleets.set(id, f);
  }
  target.fleetOrder = fresh.fleetOrder;
  target.fleetCounter = fresh.fleetCounter;

  target.factions = fresh.factions;
  target.day = fresh.day;
  target.speed = fresh.speed;
  target.humans = fresh.humans;
  target.log = fresh.log;
  target.superFederationRisen = fresh.superFederationRisen;
  target.winner = fresh.winner;
  target.spires = fresh.spires;
  target.gloomSeeds = fresh.gloomSeeds;
  target.lastConqueror = fresh.lastConqueror;
  target.playerDefeated = fresh.playerDefeated;
  target.terminidsCapitulated = fresh.terminidsCapitulated;
  target.firedEvents = fresh.firedEvents;
  target.attackPlans = fresh.attackPlans;
  target.truces = fresh.truces;
  target.doneObjectives = fresh.doneObjectives;
  target.pendingChoice = fresh.pendingChoice;
  target.recons = fresh.recons;
  target.chronicle = fresh.chronicle;
  target.history = fresh.history;
  target.modifiers = fresh.modifiers;

  // Поток случайности хоста: клиент не симулирует, но состояние обязано
  // совпадать целиком — иначе после передачи хода числа разойдутся.
  target.seed = fresh.seed;
  target.rng = new RNG(fresh.seed);
  target.rng.restore(fresh.rng.dump());

  // player НЕ трогаем: это точка зрения ЭТОГО экрана, у каждого своя.
}
