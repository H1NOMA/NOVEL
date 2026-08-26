// ---------------------------------------------------------------------------
// Код партии.
//
// У игры нет сервера-посредника, поэтому код не может быть просто случайным
// набором букв: его некому было бы превратить обратно в адрес хоста. Вместо
// этого адрес ЗАШИТ в сам код — четыре байта IPv4 и смещение порта
// упакованы в 40 бит и записаны base32. Получается восемь знаков, которые
// диктуются голосом, а расшифровываются на клиенте без всякой сети.
//
// Алфавит — Crockford base32 без I, L, O и U: их путают с 1, 0 и друг с
// другом, а код чаще всего передают вслух. При разборе 1/I/L и 0/O
// приводятся к нужному символу, так что «ошибиться» ими нельзя.
// ---------------------------------------------------------------------------

import { DEFAULT_PORT } from './protocol';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Похожие знаки приводятся к каноническим — код часто диктуют вслух. */
const CONFUSED: Record<string, string> = { I: '1', L: '1', O: '0', U: 'V' };

function isIPv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * Код партии для адреса хоста. Возвращает null, если адрес не IPv4 —
 * тогда меню показывает адрес как есть, без кода.
 *
 * Порт хранится смещением от стандартного: почти всегда это ноль, и код
 * получается коротким для любой обычной партии.
 */
export function encodePartyCode(host: string, port: number = DEFAULT_PORT): string | null {
  if (!isIPv4(host)) return null;
  const offset = port - DEFAULT_PORT;
  if (!Number.isInteger(offset) || offset < 0 || offset > 255) return null;
  const bytes = [...host.split('.').map(Number), offset];

  // 5 байт → 40 бит → ровно 8 знаков по 5 бит.
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  // Знаки идут от старших бит к младшим — как читается число.
  let out = '';
  for (let i = 7; i >= 0; i--) {
    out += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Привести введённое к каноническому виду: верхний регистр, без мусора. */
export function normalizeCode(raw: string): string {
  return [...raw.toUpperCase()]
    .map((c) => CONFUSED[c] ?? c)
    .filter((c) => ALPHABET.includes(c))
    .join('');
}

/** Разобрать код обратно в адрес. null — код неполный или испорчен. */
export function decodePartyCode(raw: string): { host: string; port: number } | null {
  const code = normalizeCode(raw);
  if (code.length !== 8) return null;
  let bits = 0n;
  for (const c of code) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) return null;
    bits = (bits << 5n) | BigInt(v);
  }
  const bytes: number[] = [];
  for (let i = 4; i >= 0; i--) bytes.push(Number((bits >> BigInt(i * 8)) & 255n));
  const host = bytes.slice(0, 4).join('.');
  if (!isIPv4(host)) return null;
  return { host, port: DEFAULT_PORT + bytes[4]! };
}

/**
 * Пользователь мог ввести и код, и обычный адрес. Разбираем и то и другое:
 * заставлять выбирать формат — лишний вопрос на пустом месте.
 */
export function resolveJoinTarget(input: string): { host: string; port: number } | null {
  const raw = input.trim();
  if (!raw) return null;
  const byCode = decodePartyCode(raw);
  if (byCode) return byCode;
  const m = /^([^\s:]+)(?::(\d{1,5}))?$/.exec(raw);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1]!, port };
}

/** Показываемый код: первый пригодный адрес хоста или null. */
export function partyCodeFor(addresses: string[], port: number = DEFAULT_PORT): string | null {
  for (const a of addresses) {
    const code = encodePartyCode(a, port);
    if (code) return code;
  }
  return null;
}
