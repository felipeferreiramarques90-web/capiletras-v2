import test from 'node:test';
import assert from 'node:assert/strict';
import { indexHouseList } from '../bots/house-list-index.js';
import { parseHouseList } from '../bots/dictionary-policy.js';

test('índice compacto equivale ao Set com linhas fora de ordem, duplicatas, comentários e acentos',()=>{
  const text='# cabeçalho\r\nZZZ\r\n CASA # anotação\r\nDRIBLAVEL\nCASA\nDRIBLÁVEL\nônibus\nINVÁLIDO-TESTE\nAB\nAÇÃO\nACAO\nLLALLAGUALITA\nLLALLAGUALITAS';
  const expected=parseHouseList(text),actual=indexHouseList(text);
  assert.equal(actual.size,expected.size);
  assert.deepEqual([...actual].sort(),[...expected].sort());
  for(const word of expected)assert.equal(actual.has(word),true,word);
  for(const word of ['CAS','CASAS','casa','AÇÃO','A','LLALLAGUALIT','LLALLAGUALITASS','CASA\0','CASA\0ZZZ',null,1])assert.equal(actual.has(word),expected.has(word),String(word));
  assert.deepEqual([...actual.keys()],[...actual.values()]);
  assert.deepEqual([...actual.entries()],[...actual].map(word=>[word,word]));
});

test('índice não confunde prefixos nem aceita palavras inexistentes em milhares de consultas',()=>{
  let seed=12345;const rng=()=>((seed=(1664525*seed+1013904223)>>>0)/2**32);
  const word=()=>Array.from({length:3+Math.floor(rng()*12)},()=>String.fromCharCode(65+Math.floor(rng()*26))).join('');
  const words=Array.from({length:5000},word),text=words.join('\n'),expected=new Set(words),actual=indexHouseList(text);
  assert.equal(actual.size,expected.size);
  for(const item of words)assert.equal(actual.has(item),true,item);
  for(let i=0;i<5000;i++){const item=word();assert.equal(actual.has(item),expected.has(item),item);}
});

test('índice vazio, somente comentários e normalização de entradas não ASCII',()=>{
  assert.equal(indexHouseList('# somente comentário\n\n').size,0);
  const index=indexHouseList('ação\nárvore\nONIBUS\nônibus');
  assert.deepEqual([...index].sort(),['ACAO','ARVORE','ONIBUS']);assert.equal(index.size,3);
  const seen=[];index.forEach((value,key,self)=>{assert.equal(value,key);assert.equal(self,index);seen.push(value);});
  assert.deepEqual(seen,[...index]);
});
