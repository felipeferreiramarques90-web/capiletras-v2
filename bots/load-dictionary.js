import { readFileSync } from 'node:fs';
import { createDictionary, normalizeWord } from './dictionary.js';
import { BOT_RULES } from './config.js';

let dictionary;
let commonDictionary;
export function loadDictionary(path = new URL('./data/pt-BR.txt', import.meta.url)) {
  return createDictionary(readFileSync(path, 'utf8').split(/\r?\n/));
}
export function defaultDictionary() { return dictionary ??= loadDictionary(); }

// As frequências só decidem inclusão; não entram na trie nem ponderam escolhas.
// A interseção mantém o léxico completo como única autoridade para julgar palavras.
export function commonWords(text, full, minFrequency = BOT_RULES.commonMinFrequency) {
  const words = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\d+)$/.exec(line.trim());
    if (!match || Number(match[2]) < minFrequency) continue;
    const word = normalizeWord(match[1]);
    if (word && full.isWord(word)) words.add(word);
  }
  return [...words];
}
export function loadCommonDictionary(full = defaultDictionary(),
  path = new URL('./data/pt-BR-frequency.txt', import.meta.url), minFrequency = BOT_RULES.commonMinFrequency) {
  return createDictionary(commonWords(readFileSync(path, 'utf8'), full, minFrequency));
}
export function defaultCommonDictionary() { return commonDictionary ??= loadCommonDictionary(); }
