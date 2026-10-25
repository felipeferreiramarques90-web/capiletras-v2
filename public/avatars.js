export const AVATAR_UI = { tooltipMs: 2400 };
export function initials(name) {
  const parts = String(name || '').normalize('NFC').match(/\p{L}+/gu) || [];
  const letters = parts.length > 1 ? [...parts[0]][0] + [...parts.at(-1)][0] : ([...(parts[0] || '')][0] || '?');
  return [...letters.toLocaleUpperCase('pt-BR')].slice(0, 2).join('');
}
export function avatarColor(id) {
  let hash = 0;
  for (const char of String(id)) hash = (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0;
  return `var(--avatar-pastel-${hash % 8})`;
}

// Aloca as oito cores sem colisões na sala e preserva quem já recebeu uma cor.
// Este mapa pertence só à apresentação, nunca ao estado da partida.
export function createAvatarPalette(seed = {}) {
  const assigned = new Map(Object.entries(seed));
  const colorFor = (id) => {
    if (!assigned.has(id)) {
      const used = new Set(assigned.values());
      const preferred = avatarColor(id);
      const options = [preferred, ...Array.from({ length: 8 }, (_, i) => `var(--avatar-pastel-${i})`)];
      assigned.set(id, options.find((color) => !used.has(color)) || preferred);
    }
    return assigned.get(id);
  };
  colorFor.sync = (ids) => {
    const active = new Set(ids);
    for (const id of assigned.keys()) if (!active.has(id)) assigned.delete(id);
    ids.forEach(colorFor);
  };
  colorFor.snapshot = () => Object.fromEntries(assigned);
  return colorFor;
}
export function botNumber(name) { return /^Bot\s+(\d+)$/i.exec(String(name))?.[1] || ''; }
