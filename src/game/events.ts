import { TIMELINE_EVENTS, type EventEffects, type TimelineEvent } from '../data/events';
import { FACTION_IDS } from '../data/factions';
import { troopsOf } from '../data/troops';
import { bus } from '../core/emitter';
import type { FactionId } from '../core/types';
import { planetsOf, pushLog, type GameState } from './state';

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

export function resolveChoice(state: GameState, eventId: string, idx: number): void {
  const ev = TIMELINE_EVENTS.find((t) => t.id === eventId);
  if (!ev?.choices || state.pendingChoice !== eventId) return;
  const ch = ev.choices[idx] ?? ev.choices[0]!;
  applyEffects(state, ev.faction ?? state.player, ch.effects);
  state.pendingChoice = null;
  pushLog(state, { faction: ev.faction, text: `Решение: «${ch.label}» (${ev.title}).`, tone: 'good' });
}

function fire(state: GameState, ev: TimelineEvent): void {
  state.firedEvents.push(ev.id);
  // Развилка: игрок выбирает сам (пауза + кнопки), ИИ берёт первый вариант.
  if (ev.choices) {
    if (ev.faction === state.player || (!ev.faction && state.factions[state.player].alive)) {
      state.pendingChoice = ev.id;
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
