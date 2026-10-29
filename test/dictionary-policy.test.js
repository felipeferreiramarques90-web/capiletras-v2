import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectionReason,parseHouseList,filterWords} from '../bots/dictionary-policy.js';
import {createDictionary} from '../bots/dictionary.js';
import {defaultDictionary,defaultCommonDictionary,commonWords,dictionaryReport} from '../bots/load-dictionary.js';
import {expandHunspell} from '../scripts/hunspell-expand.js';
import {simulateMatch} from './helpers/simulation.js';
import {DEFAULT_DECK_COMPOSITION} from '../game/config.js';

test('filtros na grafia original, normalização e rejeição da palavra inteira',()=>{
 for(const [word,reason] of [['Brasil','initialUppercase'],['Maria','initialUppercase'],['CPF','acronym'],['ONU','acronym'],['guarda-chuva','invalidCharacters'],["d'agua",'invalidCharacters'],['s.m.s.','invalidCharacters'],['bom dia','invalidCharacters'],['eu','tooShort']])assert.equal(rejectionReason(word),reason,word);
 const {words}=filterWords(['ação','ônibus','casa','CORRENDO','guarda-chuva','beija-flor']);
 assert.deepEqual([...words],['ACAO','ONIBUS','CASA']);assert.equal(words.has('GUARDACHUVA'),false);
});
test('listas ignoram comentários/vazios; bloqueio prevalece sobre exceções e fonte',()=>{
 const blocked=parseHouseList('# casa\nBRASIL # país\n\nYAKUZA\n'),accepted=parseHouseList('# formato\nBRASIL\ngíria\n');
 const {words}=filterWords(['brasil','yakuza','casa'],{blocked,accepted});
 assert.deepEqual([...words],['CASA','GIRIA']);
});
test('expansor aplica plurais, conjugação, prefixos cruzados e continuações Unicode',()=>{
 const aff='SET UTF-8\nFLAG UTF-8\nPFX Á Y 1\nPFX Á 0 re .\nSFX B Y 1\nSFX B 0 s .\nSFX C Y 1\nSFX C r ndo r\nSFX D Y 1\nSFX D 0 a/B .';
 const {words}=expandHunspell('5\ncasa/BÁ\ncorrer/C\nBrasil/B\nONU\nbola/D',aff);
 for(const word of ['casa','casas','recasas','correndo'])assert.ok(words.has(word),word);
 assert.ok(words.has('bolaas'));assert.equal(words.has('Brasils'),false);
});
test('VERO real contém plurais e conjugações; listas da casa e subconjunto comum',()=>{
 const full=defaultDictionary(),common=defaultCommonDictionary();
 for(const word of ['CASA','CASAS','BRASILEIRO','BRASILEIROS','CORRENDO','CANTARAM','JOGAVAMOS','LASER','PIZZA','SHOPPING'])assert.ok(full.isWord(word),word);
 for(const word of ['BRASIL','YAKUZA','MARIA','CPF','ONU','GUARDACHUVA','BEIJAFLOR'])assert.equal(full.isWord(word),false,word);
 for(const word of common.allContinuations(''))assert.ok(full.isWord(word),word);
 const counts=dictionaryReport();assert.equal(counts.full,full.size);assert.ok(counts.discarded.initialUppercase>0);assert.ok(counts.discarded.acronym>0);
});
test('comum filtra maiúsculas, hífen, apóstrofo e bloqueio antes da normalização',()=>{
 const full=createDictionary(['CASA','BRASIL','CPF','ACAO']);
 assert.deepEqual(commonWords('Casa 9000\nCPF 9000\nbrasil 9000\ncasa 9000\nação 9000\nguarda-chuva 9000',full),['CASA','ACAO']);
});
test('simulação longa com novo completo termina e não serializa os léxicos',()=>{
 const full=defaultDictionary(),common=defaultCommonDictionary();
 for(const seed of [51,91,111]){const room=simulateMatch(DEFAULT_DECK_COMPOSITION,seed,{full,common});assert.equal(room.phase,'finished');assert.ok(!JSON.stringify(room).includes('dictionary'));}
});
