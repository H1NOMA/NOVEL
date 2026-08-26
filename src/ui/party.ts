import { FACTIONS, factionColor } from '../data/factions';
import type { NetAdapter } from '../net/bridge';
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
 * Задержка до хоста строкой и цветом: до 60 мс — зелёный, до 150 — жёлтый,
 * дальше красный. У хоста прочерк: до себя ходить некуда.
 */
function pingCell(m: PartyMember): string {
  if (m.isHost) return '<span class="party-ping host">хост</span>';
  const p = m.ping;
  if (p === null || p === undefined) return '<span class="party-ping wait">— мс</span>';
  const cls = p <= 60 ? 'good' : p <= 150 ? 'warn' : 'bad';
  return `<span class="party-ping ${cls}">${Math.round(p)} мс</span>`;
}

/**
 * Список людей в партии. Хосту рядом с каждым — кнопка исключения; себя
 * исключить нельзя, поэтому у строки хоста её нет. Под ником — задержка:
 * когда у кого-то отстаёт мир, первое, что надо увидеть, — чей это канал.
 */
export function rosterList(members: PartyMember[], canKick: boolean): string {
  if (!members.length) return '';
  return `<div class="party-list">
    ${members.map((m) => {
      const color = m.faction ? factionColor(m.faction) : 'var(--muted)';
      const side = m.faction ? FACTIONS[m.faction].name : 'Не выбрал сторону';
      return `<div class="party-row" style="--fac:${color}">
        <span class="party-dot"></span>
        <span class="party-who">
          <span class="party-name">${m.name}${m.isHost ? ' ★' : ''}</span>
          ${pingCell(m)}
        </span>
        <span class="party-side">${side}</span>
        ${canKick && !m.isHost
          ? `<button class="party-kick" data-kick="${m.peer}">Выгнать</button>`
          : '<span class="party-kick-gap"></span>'}
      </div>`;
    }).join('')}
  </div>`;
}

/**
 * Выбор сети партии.
 *
 * На машине с Radmin VPN, Hamachi, Docker или VirtualBox адресов несколько, и
 * программа не может знать, по какой сети игроки собрались играть: код,
 * выданный не по тому адаптеру, ведёт в пустоту и подключение висит до
 * таймаута. Список показывается целиком — обычная сеть впереди, виртуальные
 * помечены, — а выбор остаётся за хостом.
 */
export function adapterPicker(adapters: NetAdapter[], current: string | null): string {
  if (adapters.length < 2) return '';
  return `<div class="mm-adapters">
    ${adapters.map((a) => `
      <button class="mm-adapter ${a.address === current ? 'sel' : ''}" data-adapter="${a.address}">
        <span class="ad-addr">${a.address}</span>
        <span class="ad-name">${a.kind ?? a.name}</span>
      </button>`).join('')}
  </div>`;
}
