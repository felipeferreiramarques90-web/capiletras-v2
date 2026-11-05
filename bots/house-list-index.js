import { normalizeWord } from './dictionary.js';

const letterAt = (text, index) => {
  const code = text.charCodeAt(index);
  return code >= 65 && code <= 90 ? code : 0;
};
function compareOffsets(text, left, right) {
  for (;;) {
    const a = letterAt(text, left++), b = letterAt(text, right++);
    if (a !== b) return a - b;
    if (!a) return 0;
  }
}

// Índice somente leitura compatível com as consultas/iterações de Set. Retém o
// texto e offsets de 32 bits, em vez de milhões de strings e nós de hash. Cada
// consulta compara a palavra inteira: não usa hashes com falsos positivos.
export function indexHouseList(text) {
  const offsets = [], extra = new Set();
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start), end = newline < 0 ? text.length : newline;
    const line = text.slice(start, end), comment = line.indexOf('#');
    const value = (comment < 0 ? line : line.slice(0, comment)).trim();
    if (/^[A-Z]{3,}$/.test(value)) offsets.push(start + line.indexOf(value));
    else if (value) { const word = normalizeWord(value); if (word) extra.add(word); }
    start = end + 1;
  }
  offsets.sort((a, b) => compareOffsets(text, a, b));
  let count = 0;
  for (const offset of offsets) if (!count || compareOffsets(text, offsets[count - 1], offset)) offsets[count++] = offset;
  offsets.length = count;
  const index = Uint32Array.from(offsets);
  function contains(word) {
    let low = 0, high = index.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      let position = index[middle], i = 0, difference;
      for (;;) {
        const a = letterAt(text, position++), b = i < word.length ? word.charCodeAt(i++) : 0;
        if (a !== b) { difference = a - b; break; }
        if (!a) return true;
      }
      if (difference < 0) low = middle + 1;
      else high = middle - 1;
    }
    return false;
  }
  for (const word of extra) if (contains(word)) extra.delete(word);
  function* values() {
    for (const offset of index) {
      let end = offset;
      while (letterAt(text, end)) end++;
      yield text.slice(offset, end);
    }
    yield* extra;
  }
  const result = { size: index.length + extra.size,
    has: word => typeof word === 'string' && /^[A-Z]{3,}$/.test(word) && (extra.has(word) || contains(word)),
    values, keys: values, [Symbol.iterator]: values,
    *entries() { for (const word of values()) yield [word, word]; },
    forEach(callback, thisArg) { for (const word of values()) callback.call(thisArg, word, word, result); },
  };
  return Object.freeze(result);
}
