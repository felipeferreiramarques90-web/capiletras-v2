import { DICTIONARY } from '../bots/dictionary-config.js';
import { rejectionReason, emptyCounts } from '../bots/dictionary-policy.js';
// Expansão das construções usadas pelo VERO: flags Unicode, PFX/SFX, cruzamento
// Y/Y e classes de continuação. Falha explicitamente se o formato mudar.
export function parseAffixes(text) {
  const groups = new Map(); let forbidden;
  for (const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/), [type,flag,a,b,condition] = parts;
    if (type === 'FLAG' && flag !== 'UTF-8') throw Error('Só flags UTF-8 são suportadas neste snapshot.');
    if (type === 'FORBIDDENWORD') forbidden=flag;
    if (!['PFX','SFX'].includes(type)) continue;
    const key=type+flag;
    if (['Y','N'].includes(a) && /^\d+$/.test(b)) { groups.set(key,{type,cross:a==='Y',rules:[]}); continue; }
    const group=groups.get(key); if(!group) throw Error(`Grupo de afixo ausente: ${key}`);
    const [addition, continuation='']=b.split('/');
    group.rules.push({ strip:a==='0'?'':a, addition:addition==='0'?'':addition, continuation,
      condition:new RegExp(type==='PFX'?`^(?:${condition})`:`(?:${condition})$`,'u') });
  }
  return { groups, forbidden };
}
function apply(word,group) {
  const output=[];
  for(const rule of group.rules) {
    if(!rule.condition.test(word)) continue;
    if(group.type==='PFX' && word.startsWith(rule.strip)) output.push({word:rule.addition+word.slice(rule.strip.length),flags:rule.continuation});
    if(group.type==='SFX' && word.endsWith(rule.strip)) output.push({word:word.slice(0,word.length-rule.strip.length)+rule.addition,flags:rule.continuation});
  }
  return output;
}
export function expandHunspell(dic,aff) {
  const {groups,forbidden}=parseAffixes(aff), words=new Set(), counts=emptyCounts();
  let roots=0;
  const lines=dic.replace(/^\uFEFF/,'').split(/\r?\n/).slice(1);
  for(const line of lines) {
    if(!line.trim())continue;
    const [entry]=line.trim().split(/\s+/), [stem,flags='']=entry.split('/'); roots++;
    const reason=rejectionReason(stem);
    if(reason) {counts[reason]++;continue;}
    if(forbidden && flags.includes(forbidden)) {counts.forbidden++;continue;}
    words.add(stem);
    const prefixes=[...flags].map(f=>groups.get('PFX'+f)).filter(Boolean);
    const suffixes=[...flags].map(f=>groups.get('SFX'+f)).filter(Boolean);
    const add=(form,depth=1)=>{
      if(forbidden && form.flags.includes(forbidden)) return;
      words.add(form.word);
      if(depth>=DICTIONARY.maxAffixDepth)return;
      for(const flag of form.flags)for(const type of ['PFX','SFX']) {
        const group=groups.get(type+flag);if(group)for(const next of apply(form.word,group))add(next,depth+1);
      }
    };
    for(const prefix of prefixes)for(const form of apply(stem,prefix))add(form);
    for(const suffix of suffixes)for(const form of apply(stem,suffix)) {
      add(form);
      if(suffix.cross) for(const prefix of prefixes)if(prefix.cross)for(const combined of apply(form.word,prefix))add(combined);
    }
  }
  return {words,counts,roots};
}
