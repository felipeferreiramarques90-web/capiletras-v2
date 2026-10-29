import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createDictionary, normalizeWord } from './dictionary.js';
import { BOT_RULES } from './config.js';
import { DICTIONARY } from './dictionary-config.js';
import { rejectionReason, parseHouseList, emptyCounts } from './dictionary-policy.js';
let dictionary, commonDictionary, report;
export function houseLists() {
  return { blocked: parseHouseList(readFileSync(DICTIONARY.blocked,'utf8')), accepted: parseHouseList(readFileSync(DICTIONARY.accepted,'utf8')) };
}
function* lines(text) { let start=0,end;while((end=text.indexOf('\n',start))>=0){yield text.slice(start,end);start=end+1;}if(start<text.length)yield text.slice(start); }
export function loadDictionary(path=DICTIONARY.generated, lists=houseLists(), counts=emptyCounts()) {
  const raw=readFileSync(path),text=(String(path).endsWith('.gz')?gunzipSync(raw):raw).toString('utf8');
  function* eligible(){
    for(const original of lines(text)) {
      const reason=rejectionReason(original);if(reason){counts[reason]++;continue;}
      const word=normalizeWord(original);if(lists.blocked.has(word)){counts.blocked++;continue;}yield word;
    }
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
 return {full:full.size,common:common.size,discarded,commonDiscarded:report.common,generatedAt:build.generatedAt};}
