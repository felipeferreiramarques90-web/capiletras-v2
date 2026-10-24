export const AVATAR_UI = { tooltipMs: 2400 };
export function initials(name) {
  const parts = String(name || '').normalize('NFC').match(/\p{L}+/gu) || [];
  const letters = parts.length > 1 ? [...parts[0]][0] + [...parts.at(-1)][0] : ([...(parts[0] || '')][0] || '?');
  return [...letters.toLocaleUpperCase('pt-BR')].slice(0, 2).join('');
}
export function avatarColor(id) {
  let hash = 0;
  for (const char of String(id)) hash = (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return `hsl(${hash % 360} ${55 + (hash >>> 9) % 20}% ${22 + (hash >>> 20) % 6}%)`;
}
