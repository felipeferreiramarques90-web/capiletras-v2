import { indexHouseList } from './house-list-index.js';
import { loadSupplement } from './load-supplement.js';
import { readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createDictionary, normalizeWord } from './dictionary.js';
import { BOT_RULES } from './config.js';
import { DICTIONARY } from './dictionary-config.js';
import { rejectionReason, parseHouseList, emptyCounts } from './dictionary-policy.js';
let dictionary, commonDictionary, report, houseCache;
export function houseLists() {
  // Compartilhamento interno somente para leitura: completo, comum e relatórios
  // usam o mesmo bloqueio, sem reconstruir milhões de entradas a cada consulta.
  const signature = [DICTIONARY.blocked, DICTIONARY.accepted].map(path => {
    const stat = statSync(path, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
  }).join('|');
  if (!houseCache || houseCache.signature !== signature) {
    const readList = path => {
      const text = readFileSync(path, 'utf8');
      return text.length >= DICTIONARY.houseListIndexThreshold ? indexHouseList(text) : parseHouseList(text);
    };
    houseCache = { signature, lists: {
      blocked: readList(DICTIONARY.blocked),
      accepted: readList(DICTIONARY.accepted),
    } };
  }
  return houseCache.lists;
}

// Decodifica uma linha por vez: evita duplicar todo o corpus UTF-8 em uma string.
function* lines(bytes) {
  let start = 0, end;
  while ((end = bytes.indexOf(10, start)) >= 0) { yield bytes.toString('utf8', start, end); start = end + 1; }
  if (start < bytes.length) yield bytes.toString('utf8', start);
}
export function loadDictionary(path=DICTIONARY.generated, lists=houseLists(), counts=emptyCounts(), { supplement = path === DICTIONARY.generated } = {}) {
  const raw=readFileSync(path),bytes=String(path).endsWith('.gz')?gunzipSync(raw):raw;
  function* eligible(){
    for(const original of lines(bytes)) {
      const reason=rejectionReason(original);if(reason){counts[reason]++;continue;}
      const word=normalizeWord(original);if(lists.blocked.has(word)){counts.blocked++;continue;}yield word;
    }
    if(supplement)for(const word of loadSupplement().words)if(!lists.blocked.has(word))yield word;
    for(const word of lists.accepted)if(!lists.blocked.has(word))yield word;
  }
  return createDictionary(eligible());
}
export function defaultDictionary() {
  if(!dictionary){const counts=emptyCounts();dictionary=loadDictionary(DICTIONARY.generated,houseLists(),counts);report={full:counts};}
  return dictionary;
}
// Pesos continuam só como filtro de frequência. A grafia original é validada
// antes da normalização, e a interseção impede ampliar o léxico julgador.
export function commonWords(text,full,minFrequency=BOT_RULES.commonMinFrequency,lists=houseLists(),counts=emptyCounts()) {
  const words=new Set();
  for(const line of text.split(/\r?\n/)) {
    const match=/^(\S+)\s+(\d+)$/.exec(line.trim());if(!match||Number(match[2])<minFrequency)continue;
    const reason=rejectionReason(match[1]);if(reason){counts[reason]++;continue;}
    const word=normalizeWord(match[1]);if(lists.blocked.has(word)){counts.blocked++;continue;}
    if(full.isWord(word))words.add(word);
  }
  return [...words];
}
export function loadCommonDictionary(full=defaultDictionary(),path=DICTIONARY.frequency,minFrequency=BOT_RULES.commonMinFrequency,counts=emptyCounts()) {
  return createDictionary(commonWords(readFileSync(path,'utf8'),full,minFrequency,houseLists(),counts));
}
export function defaultCommonDictionary(){if(!commonDictionary){const counts=emptyCounts();commonDictionary=loadCommonDictionary(defaultDictionary(),DICTIONARY.frequency,BOT_RULES.commonMinFrequency,counts);report.common=counts;}return commonDictionary;}
export function dictionaryReport(){const full=defaultDictionary(),common=defaultCommonDictionary();const build=JSON.parse(readFileSync(DICTIONARY.manifest,'utf8'));
 const discarded={...report.full};for(const [key,value]of Object.entries(build.sourceRejected))discarded[key]+=value;
 if(build.expansionRejected)for(const [key,value]of Object.entries(build.expansionRejected))discarded[key]+=value;
 const supplement=loadSupplement();
 return {full:full.size,common:common.size,discarded,commonDiscarded:report.common,generatedAt:build.generatedAt,supplement:{words:supplement.words.length,generatedAt:supplement.manifest.generatedAt,referenceSha256:supplement.manifest.referenceSha256}};}
