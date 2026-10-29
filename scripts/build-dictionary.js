import {readFileSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {DICTIONARY} from '../bots/dictionary-config.js';
import {rejectionReason,emptyCounts} from '../bots/dictionary-policy.js';
import {expandHunspell} from './hunspell-expand.js';
const dic=readFileSync(DICTIONARY.source,'utf8'),aff=readFileSync(DICTIONARY.affixes,'utf8');
const {words,counts,roots}=expandHunspell(dic,aff);
const expansionRejected=emptyCounts(),eligible=[];
for(const word of words){const reason=rejectionReason(word);if(reason)expansionRejected[reason]++;else eligible.push(word);}
const content=eligible.sort().join('\n')+'\n';
writeFileSync(DICTIONARY.generated,gzipSync(content,{level:9}));
const report={source:DICTIONARY.sourceVersion,snapshot:DICTIONARY.snapshot,generatedAt:new Date().toISOString(),roots,forms:eligible.length,expandedForms:words.size,sourceRejected:counts,expansionRejected,
 dicSha256:createHash('sha256').update(dic).digest('hex'),affSha256:createHash('sha256').update(aff).digest('hex')};
writeFileSync(DICTIONARY.manifest,JSON.stringify(report,null,2)+'\n');console.log(report);
