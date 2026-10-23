import { readFileSync } from 'node:fs';
import { createDictionary } from './dictionary.js';

let dictionary;
export function loadDictionary(path = new URL('./data/pt-BR.txt', import.meta.url)) {
  return createDictionary(readFileSync(path, 'utf8').split(/\r?\n/));
}
export function defaultDictionary() { return dictionary ??= loadDictionary(); }
