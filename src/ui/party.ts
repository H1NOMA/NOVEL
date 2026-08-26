import { FACTIONS, factionColor } from '../data/factions';
import type { PartyMember } from '../net/protocol';

// ---------------------------------------------------------------------------
// Код партии и список игроков.
//
// Одна и та же разметка нужна в двух местах: в лобби до старта и в меню
// паузы во время партии. Держим её здесь, чтобы код не расходился между
// экранами и хост везде видел одинаковые кнопки исключения.
// ---------------------------------------------------------------------------

/**
 * Код партии крупными знаками. Разбит на две группы по четыре — так его
 * проще диктовать и сверять на слух.
 */
export function partyCodeBlock(code: string): string {
  return `<div class="party-code" id="party-code" title="">
    <span class="pc-label">Код партии</span>
    <span class="pc-value">${code}</span>
  </div>`;
}

/**
 * Список людей в партии. Хосту рядом с каждым — кнопка исключения; себя
 * исключить нельзя, поэтому у строки хоста её нет.
 */
export function rosterList(members: PartyMember[], canKick: boolean): string {
  if (!members.length) return '';
  return `<div class="party-list">
    ${members.map((m) => {
      const color = m.faction ? factionColor(m.faction) : 'var(--muted)';
      const side = m.faction ? FACTIONS[m.faction].name : 'Не выбрал сторону';
      return `<div class="party-row" style="--fac:${color}">
        <span class="party-dot"></span>
        <span class="party-name">${m.name}${m.isHost ? ' ★' : ''}</span>
        <span class="party-side">${side}</span>
        ${canKick && !m.isHost
          ? `<button class="party-kick" data-kick="${m.peer}">Выгнать</button>`
          : '<span class="party-kick-gap"></span>'}
      </div>`;
    }).join('')}
  </div>`;
}
