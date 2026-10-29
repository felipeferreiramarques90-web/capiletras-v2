import { BOT_RULES } from './config.js';
import { CHALLENGE_RULES } from '../game/config.js';
import { DICTIONARY } from './dictionary-config.js';

export function normalizeWord(value) {
  const word = value.trim().normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  return /^[A-Z]+$/.test(word) && word.length >= BOT_RULES.minWordLength ? word : null;
}

// Trie compacto: vetores tipados evitam um objeto/Map para cada letra do corpus.
// Só existe no processo; nunca é passado ao storage ou à visão de um jogador.
export function createDictionary(entries) {
  let capacity = DICTIONARY.trieInitialCapacity, nodes = 1, wordCount = 0;
  let labels = new Uint8Array(capacity), first = new Uint32Array(capacity), sibling = new Uint32Array(capacity),
    terminal = new Uint8Array(capacity), counts = new Uint32Array(capacity);
  function grow() {
    capacity = Math.ceil(capacity * DICTIONARY.trieGrowthFactor);
    const copy = array => { const next = new array.constructor(capacity); next.set(array); return next; };
    labels = copy(labels); first = copy(first); sibling = copy(sibling); terminal = copy(terminal); counts = copy(counts);
  }
  for (const entry of entries) {
    const word = normalizeWord(entry);
    if (!word) continue;
    let node = 0;
    const path = [0];
    for (const letter of word) {
      const code = letter.charCodeAt(0);
      let next = -1;
      for (let i = first[node]; i; i = sibling[i]) if (labels[i] === code) { next = i; break; }
      if (next < 0) {
        if (nodes === capacity) grow();
        next = nodes++; labels[next] = code; sibling[next] = first[node]; first[node] = next;
      }
      node = next; path.push(node);
    }
    if (!terminal[node]) { terminal[node] = 1; wordCount++; for (const i of path) counts[i]++; }
  }
  const data = { labels, first, sibling, terminal, counts };
  const locate = (prefix) => {
    if (typeof prefix !== 'string' || /[^A-Z]/.test(prefix)) return -1;
    let node = 0;
    for (const letter of prefix) {
      let found = -1;
      for (let i = data.first[node]; i; i = data.sibling[i]) if (data.labels[i] === letter.charCodeAt(0)) { found = i; break; }
      if (found < 0) return -1;
      node = found;
    }
    return node;
  };
  const children = (node) => {
    const result = [];
    for (let i = data.first[node]; i; i = data.sibling[i]) result.push(i);
    return result.sort((a, b) => data.counts[b] - data.counts[a] || data.labels[a] - data.labels[b]);
  };
  function search(prefix, { minLetters = 0, maxLetters = CHALLENGE_RULES.maxLetters, limit = BOT_RULES.maxContinuations,
    excludedFirst = null, prefixes = false } = {}) {
    const root = locate(prefix), result = [];
    if (root < 0 || minLetters < 0 || maxLetters < minLetters || limit < 1) return result;
    const queue = [[root, '']];
    for (let i = 0; i < queue.length && i < BOT_RULES.maxSearchNodes && result.length < limit; i++) {
      const [node, suffix] = queue[i];
      if (suffix.length >= minLetters && (prefixes || data.terminal[node])) result.push(suffix);
      if (suffix.length >= maxLetters) continue;
      for (const next of children(node)) {
        const letter = String.fromCharCode(data.labels[next]);
        if (!suffix && letter === excludedFirst) continue;
        if (queue.length < BOT_RULES.maxSearchNodes) queue.push([next, suffix + letter]);
      }
    }
    return result;
  }
  // A escolha aleatória precisa do conjunto inteiro: cortar por limite ou por
  // ordem da trie favoreceria palavras curtas, alfabéticas ou inseridas primeiro.
  function all(prefix, minLetters, maxLetters, excludedFirst, prefixes = false) {
    const root = locate(prefix), result = [];
    if (root < 0 || minLetters < 0 || maxLetters < minLetters) return result;
    const stack = [[root, '']];
    while (stack.length) {
      const [node, suffix] = stack.pop();
      if (suffix.length >= minLetters && (prefixes || data.terminal[node])) result.push(suffix);
      if (suffix.length >= maxLetters) continue;
      for (let next = data.first[node]; next; next = data.sibling[next]) {
        const letter = String.fromCharCode(data.labels[next]);
        if (!suffix && letter === excludedFirst) continue;
        stack.push([next, suffix + letter]);
      }
    }
    return result;
  }
  return Object.freeze({ size: wordCount,
    hasPrefix: (prefix) => { const node = locate(prefix); return node >= 0 && data.counts[node] > 0; },
    isWord: (word) => { const node = locate(word); return node >= 0 && Boolean(data.terminal[node]); },
    continuations: (prefix, options = {}) => search(prefix, { ...options,
      maxLetters: Math.min(options.maxLetters ?? CHALLENGE_RULES.maxLetters, CHALLENGE_RULES.maxLetters) }),
    extensions: (prefix, length, options = {}) => search(prefix, { ...options, minLetters: length, maxLetters: length, prefixes: true }),
    allContinuations: (prefix, { minLetters = 0, maxLetters = CHALLENGE_RULES.maxLetters, excludedFirst = null } = {}) =>
      all(prefix, minLetters, Math.min(maxLetters, CHALLENGE_RULES.maxLetters), excludedFirst),
    allExtensions: (prefix, length, { excludedFirst = null } = {}) => all(prefix, length, length, excludedFirst, true),
    nextLetters: (prefix) => { const node = locate(prefix); return node < 0 ? [] : children(node).map((i) => String.fromCharCode(data.labels[i])); },
  });
}
