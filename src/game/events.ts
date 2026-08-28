import { TIMELINE_EVENTS, type EventEffects, type TimelineEvent } from '../data/events';
import { FACTION_IDS } from '../data/factions';
import { troopsOf } from '../data/troops';
import { bus } from '../core/emitter';
import type { FactionId } from '../core/types';
import { planetsOf, pushChronicle, pushLog, type GameState } from './state';

// ---------------------------------------------------------------------------
// Ежедневная проверка таймлайна: ивенты по датам и по захвату миров.
// ---------------------------------------------------------------------------

function applyEffects(state: GameState, faction: FactionId, eff: EventEffects): void {
  const fs = state.factions[faction];
  if (!fs.alive) return;
  if (eff.warSupport) fs.warSupport = Math.max(0, Math.min(100, fs.warSupport + eff.warSupport));
  if (eff.stability && faction === 'superEarth') fs.stability = Math.max(0, Math.min(100, fs.stability + eff.stability));
  if (eff.production) fs.production = Math.max(0, fs.production + eff.production);
  if (eff.minerals) fs.resources.minerals = Math.max(0, fs.resources.minerals + eff.minerals);
  if (eff.politicalPower) fs.politicalPower = Math.max(0, fs.politicalPower + eff.politicalPower);
  if (eff.mass) {
    const massDef = troopsOf(faction).find((t) => t.role === 'mass');
    if (massDef) {
      fs.units[massDef.id] = Math.max(0, (fs.units[massDef.id] ?? 0) + eff.mass);
      fs.manpower = Object.values(fs.units).reduce((s, n) => s + n, 0);
    }
  }
}

/** Условие сюжетного ивента по захвату мира. */
function captureMet(state: GameState, ev: TimelineEvent): boolean {
  if (!ev.capture) return false;
  const p = state.galaxy.order
    .map((id) => state.galaxy.planets.get(id)!)
    .find((pl) => pl.name === ev.capture!.planet);
  return !!p && p.owner === ev.capture.by && !p.shattered;
}

/** Может ли ивент прийти сегодня: не выстрелил, адресат жив, срок наступил. */
function eligible(state: GameState, ev: TimelineEvent): boolean {
  if (state.firedEvents.includes(ev.id)) return false;
  if (ev.faction && !state.factions[ev.faction]?.alive) return false;
  if (ev.capture) return false;          // условные разбираются отдельно
  return ev.day === undefined || state.day >= ev.day;
}

/**
 * Разрешить развилку от имени фракции. Развилка принадлежит той стороне,
 * которой её задали: в сетевой партии кнопка на чужом экране не должна
 * закрывать чужой вопрос.
 */
export function resolveChoice(state: GameState, faction: FactionId, eventId: string, idx: number): boolean {
  const ev = TIMELINE_EVENTS.find((t) => t.id === eventId);
  if (!ev?.choices || state.pendingChoices[faction] !== eventId) return false;
  const ch = ev.choices[idx] ?? ev.choices[0]!;
  applyEffects(state, ev.faction ?? faction, ch.effects);
  delete state.pendingChoices[faction];
  pushLog(state, { faction: ev.faction ?? faction, text: `Решение: «${ch.label}» (${ev.title}).`, tone: 'good' });
  return true;
}

function fire(state: GameState, ev: TimelineEvent): void {
  state.firedEvents.push(ev.id);
  if (ev.major || ev.choices) pushChronicle(state, `${ev.title}.`);
  // Развилка: человек выбирает сам (пауза + кнопки), ИИ берёт первый вариант.
  //
  // Спрашиваем КАЖДОГО человека за столом, кого это касается: фракционный ивент
  // — только свою сторону, общий — всех живых людей. Раньше вопрос доставался
  // одному state.player, то есть в сетевой партии всегда хосту.
  if (ev.choices) {
    const asked = (state.humans?.length ? state.humans : [state.player])
      .filter((f) => state.factions[f]?.alive && (!ev.faction || ev.faction === f));
    if (asked.length) {
      for (const f of asked) state.pendingChoices[f] = ev.id;
      state.speed = 0;
      pushLog(state, { faction: ev.faction, text: `📰 ${ev.title}. ${ev.text}`, tone: 'alert' });
      bus.emit('gameEvent', { title: ev.title, text: ev.text });
      return;
    }
    applyEffects(state, ev.faction ?? 'automatons', ev.choices[0]!.effects);
    return;
  }
  if (ev.effects) {
    if (ev.faction) applyEffects(state, ev.faction, ev.effects);
    else for (const fid of FACTION_IDS) applyEffects(state, fid, ev.effects);
  }
  pushLog(state, {
    faction: ev.faction,
    text: `📰 ${ev.title}. ${ev.text}`,
    tone: ev.major ? 'alert' : 'info',
  });
  if (ev.major) bus.emit('gameEvent', { title: ev.title, text: ev.text });
}

/** Не чаще одного случайного ивента в этот срок — иначе они сливаются в шум. */
export const EVENT_GAP = 22;
/** Вероятность ивента в день, когда пауза выдержана и пул не пуст. */
export const EVENT_CHANCE = 0.075;

/**
 * Дневной шаг событий.
 *
 * Сюжетные ивенты по захвату миров срабатывают по своему условию, как и
 * раньше: они привязаны к настоящим событиям войны. А вот датированные больше
 * не выстраиваются в один и тот же сценарий — они образуют ПУЛ доступного, и
 * из него берётся случайный. Дата в данных стала нижней границей: ранние по
 * смыслу события так и остаются ранними, но какое именно и когда придёт — в
 * каждой партии своё.
 *
 * Случайность берётся из общего сида партии, а не из Math.random: иначе одна
 * и та же партия расходилась бы у хоста и клиента, а тесты перестали бы быть
 * воспроизводимыми.
 */
export function stepEvents(state: GameState): void {
  // 1. Сюжетные: условие выполнено — событие случилось.
  for (const ev of TIMELINE_EVENTS) {
    if (!ev.capture || state.firedEvents.includes(ev.id)) continue;
    if (ev.faction && !state.factions[ev.faction]?.alive) continue;
    // Ивент по захвату не срабатывает, если фракция уже без планет.
    if (planetsOf(state, ev.capture.by).length === 0) continue;
    if (captureMet(state, ev)) fire(state, ev);
  }

  // 2. Случайные из пула — с паузой между ними.
  if (state.day - state.lastEventDay < EVENT_GAP) return;
  if (state.rng.next() > EVENT_CHANCE) return;
  const pool = TIMELINE_EVENTS.filter((ev) => eligible(state, ev));
  if (!pool.length) return;
  const pick = pool[Math.min(pool.length - 1, Math.floor(state.rng.next() * pool.length))]!;
  state.lastEventDay = state.day;
  fire(state, pick);
}
