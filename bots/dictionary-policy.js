import { normalizeWord } from './dictionary.js';
import { DICTIONARY } from './dictionary-config.js';
export const emptyCounts = () => ({ initialUppercase: 0, invalidCharacters: 0, acronym: 0, tooShort: 0, blocked: 0, forbidden: 0 });
// A classificação acontece na grafia original. Siglas são um subconjunto de
// maiúsculas iniciais; classificá-las primeiro evita contar a mesma entrada duas vezes.
export function rejectionReason(raw) {
  const word = raw.trim().normalize('NFC');
  if (/^\p{Lu}+$/u.test(word)) return 'acronym';
  if (/^\p{Lu}/u.test(word)) return 'initialUppercase';
  if (!/^\p{L}+$/u.test(word)) return 'invalidCharacters';
  const normalized = normalizeWord(word);
  if (!normalized || normalized.length < DICTIONARY.minLength) return 'tooShort';
  return null;
}
export function parseHouseList(text) {
  // Uma lista de milhões de palavras não deve criar vários arrays de todas as
  // linhas ao mesmo tempo. Só o Set final e uma linha por vez ficam vivos.
  const words = new Set();
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(start, end);
    const comment = line.indexOf('#');
    const value = (comment < 0 ? line : line.slice(0, comment)).trim();
    if (value) {
      const word = normalizeWord(value);
      if (word) words.add(word);
    }
    start = end + 1;
  }
  return words;
}

export function filterWords(entries, { blocked = new Set(), accepted = new Set() } = {}) {
  const words = new Set(), counts = emptyCounts();
  for (const raw of entries) {
    const reason = rejectionReason(raw);
    if (reason) { counts[reason]++; continue; }
    const word = normalizeWord(raw);
    if (blocked.has(word)) { counts.blocked++; continue; }
    words.add(word);
  }
  for (const word of accepted) if (!blocked.has(word)) words.add(word);
  return { words, counts };
}
