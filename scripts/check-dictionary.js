import {defaultDictionary,defaultCommonDictionary,houseLists,dictionaryReport} from '../bots/load-dictionary.js';
import {normalizeWord} from '../bots/dictionary.js';
const full=defaultDictionary(),common=defaultCommonDictionary(),{blocked,accepted}=houseLists();
console.table(process.argv.slice(2).map(raw=>{const word=normalizeWord(raw)||raw;return {palavra:word,completo:full.isWord(word),comum:common.isWord(word),bloqueio:blocked.has(word),excecoes:accepted.has(word)};}));
console.log(JSON.stringify(dictionaryReport(),null,2));
