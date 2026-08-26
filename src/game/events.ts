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

function triggerable(state: GameState, ev: TimelineEvent): boolean {
  if (ev.day !== undefined) return state.day >= ev.day;
  if (ev.capture) {
    const p = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .find((pl) => pl.name === ev.capture!.planet);
    return !!p && p.owner === ev.capture.by && !p.shattered;
  }
  return false;
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

/** Дневной шаг таймлайна (не больше одного датированного ивента за день). */
export function stepEvents(state: GameState): void {
  for (const ev of TIMELINE_EVENTS) {
    if (state.firedEvents.includes(ev.id)) continue;
    // Фракционный ивент не приходит мёртвой фракции.
    if (ev.faction && !state.factions[ev.faction].alive) continue;
    // Ивент по захвату не срабатывает, если фракция уже без планет.
    if (ev.capture && planetsOf(state, ev.capture.by).length === 0) continue;
    if (triggerable(state, ev)) fire(state, ev);
  }
}
