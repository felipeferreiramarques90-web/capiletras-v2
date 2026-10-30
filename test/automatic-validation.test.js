import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,updateSettings,restoreDefaultComposition,startGame,returnToLobby,playCard,disconnectPlayer,roomView} from '../game/game.js';
import {startChallenge,confirmChallenge,loseChallenge,resolveChallenge,voteChallenge} from '../game/challenge.js';
import {CHALLENGE_RULES,RULES} from '../game/config.js';
import {defaultDictionary} from '../bots/load-dictionary.js';
import {addBot} from '../bots/players.js';
import {decideBotAction} from '../bots/brain.js';
import {applyBotAction} from '../bots/actions.js';
import {clientView} from '../network/client-view.js';
const now=100000,rng=()=>.375;
const dictionary=defaultDictionary(),validateWord=word=>dictionary.isWord(word);
function lobby(){let r=createRoom({code:'ABC234',playerId:'p1',sessionId:'s1',name:'Ana',now});r=updateSettings(r,'p1',{playerCount:3});r=joinRoom(r,{playerId:'p2',sessionId:'s2',name:'Bia'});return addBot(r,'p1','p3');}
function fixture(word='CA',automaticValidation=true){let r=updateSettings(lobby(),'p1',{automaticValidation});r=startGame(r,'p1',rng);Object.assign(r.game,{word,turnPlayerId:'p2',lastPlayerId:'p1',lastLetterPlayerId:'p1',blockedLetter:'K',drawsThisTurn:1});return r;}
const begin=(r=fixture())=>startChallenge(r,'p2',now);
const confirm=(r,letters='',validator=validateWord)=>confirmChallenge(r,'p1',r.game.challenge.id,letters,now+100,rng,validator);
function reset(r,before,penalized){assert.equal(r.game.challenge,null);assert.equal(r.game.word,'');assert.equal(r.game.blockedLetter,null);assert.equal(r.game.protectedPlayerId,null);assert.deepEqual(r.game.letterDebt,{count:0,playerId:null});assert.equal(r.game.lastPlayerId,null);assert.equal(r.game.lastLetterPlayerId,null);assert.equal(r.game.turnPlayerId,before.game.turnPlayerId);assert.equal(r.game.drawsThisTurn,1);assert.equal(r.players.find(p=>p.id===penalized).hand.length,before.players.find(p=>p.id===penalized).hand.length+4);}

test('opção padrão ligada, edição parcial booleana só do anfitrião antes do início e reset',()=>{
 let r=lobby();assert.equal(r.settings.automaticValidation,RULES.defaultAutomaticValidation);assert.equal(r.settings.automaticValidation,true);
 for(const value of ['false',0,1,null,undefined,{},[]]){const before=structuredClone(r);assert.throws(()=>updateSettings(r,'p1',{automaticValidation:value}),/ligada/);assert.deepEqual(r,before);}
 assert.throws(()=>updateSettings(r,'p2',{automaticValidation:false}),/anfitrião/);
 r=updateSettings(r,'p1',{automaticValidation:false});assert.equal(roomView(r,'p2').settings.automaticValidation,false);
 assert.equal(restoreDefaultComposition(r,'p1').settings.automaticValidation,true);
 r=startGame(r,'p1',rng);assert.throws(()=>updateSettings(r,'p1',{automaticValidation:true}),/começou/);
 r.phase='finished';r.game.winnerId='p1';r=returnToLobby(r,'p1');assert.equal(r.settings.automaticValidation,false);
 r=startGame(r,'p1',rng);r.phase='finished';r=startGame(r,'p1',rng);assert.equal(r.settings.automaticValidation,false);
 assert.deepEqual(JSON.parse(JSON.stringify(r)),r);
});
for(const [word,suffix,outcome] of [['CA','SA','aceita'],['CASA','','aceita'],['CA','','recusada'],['C','','recusada'],['CANT','','recusada'],['ZZZ','','recusada'],['YAKUZA','','recusada'],['BRASIL','','recusada']])test(`validação exata ${word}+${suffix}: ${outcome}, sem votos nem léxico no estado`,()=>{
 const before=begin(fixture(word)),r=confirm(before,suffix),penalized=outcome==='aceita'?'p2':'p1';reset(r,before,penalized);
 assert.equal(r.game.challengeResult.reason,outcome);assert.equal(r.game.challengeResult.word,word+suffix);assert.equal(r.game.challengeResult.tally,null);assert.deepEqual(r.game.challengeResult.votes,{});
 assert.equal(r.notice,`${word+suffix}: palavra ${outcome}`);assert.equal(clientView(r,'p3').notice,r.notice);assert.deepEqual(clientView(r,'p2').game.challengeResult,{outcome,word:word+suffix});
 assert.ok(!/dictionary|isWord|trie|labels/.test(JSON.stringify(r)));
});
test('dicionário indisponível, erro e retorno inválido caem na mesma votação',()=>{
 for(const validator of [null,()=>{throw Error('falhou');},()=>null]){
  const r=confirm(begin(),'SA',validator);assert.equal(r.game.challenge.phase,'votando');assert.equal(r.notice,CHALLENGE_RULES.validationFallbackNotice);
  assert.equal(clientView(r,'p3').notice,CHALLENGE_RULES.validationFallbackNotice);assert.equal(r.settings.automaticValidation,true);
  let voted=voteChallenge(r,'p2',r.game.challenge.id,'sim',now+200,rng);voted=voteChallenge(voted,'p3',r.game.challenge.id,'sim',now+201,rng);assert.equal(voted.game.challenge,null);
 }
});
test('desligada usa votos e nunca consulta o dicionário; bots aceitam Y humano',()=>{
 let r=begin(fixture('CA',false));r=confirm(r,'SA',()=>{throw Error('Não consultar');});assert.equal(r.game.challenge.phase,'votando');
 const action=decideBotAction(roomView(r,'p3'),dictionary,rng);assert.equal(action.vote,'sim');r=applyBotAction(r,'p3',action,{version:r.game.version,now:now+200,rng,validateWord});assert.equal(r.game.challenge.phase,'votando');
 r=voteChallenge(r,'p2',r.game.challenge.id,'sim',now+201,rng);assert.equal(r.game.challengeResult.reason,'aceita');
});
test('bot Y completa e confirma pela mesma validação, sem fase de voto',()=>{
 let r=fixture('CA');r.game.lastLetterPlayerId='p3';r=startChallenge(r,'p1',now);
 let action=decideBotAction(roomView(r,'p3'),dictionary,rng);assert.equal(action.type,'preview');
 r=applyBotAction(r,'p3',action,{version:r.game.version,now:now+100,rng,validateWord});action=decideBotAction(roomView(r,'p3'),dictionary,rng);assert.equal(action.type,'confirm');
 r=applyBotAction(r,'p3',action,{version:r.game.version,now:now+200,rng,validateWord});assert.equal(r.game.challenge,null);assert.equal(r.game.challengeResult.reason,'aceita');
});
for(const accepted of [true,false])test(`vitória pendente ${accepted?'confirmada':'cancelada'} pela validação automática`,()=>{
 let r=fixture(accepted?'CAS':'ZZ');r.game.turnPlayerId='p1';r.players[0].hand=[{id:'ultima',type:'letter',letter:'A'}];r=playCard(r,'p1','ultima',undefined,undefined,'',r.game.version,now);
 assert.ok(r.game.pendingVictory);const before=structuredClone(r);r=startChallenge(r,'p2',now+10);r=confirm(r);
 assert.equal(r.game.pendingVictory,null);assert.equal(r.game.challenge,null);
 if(accepted){assert.equal(r.phase,'finished');assert.equal(r.game.winnerId,'p1');assert.equal(r.game.word,'CASA');assert.equal(r.players[1].hand.length,before.players[1].hand.length+4);}
 else{assert.equal(r.phase,'playing');assert.equal(r.players[0].hand.length,4);assert.equal(r.game.word,'');assert.equal(r.game.blockedLetter,null);assert.equal(r.game.turnPlayerId,'p2');}
});
test('prazo de 30s, PERDI manual e desconexão de Y preservam os efeitos',()=>{
 const before=begin();for(const action of [r=>resolveChallenge(r,now+CHALLENGE_RULES.completionMs,rng),r=>loseChallenge(r,'p1',r.game.challenge.id,now+100,rng),r=>resolveChallenge(disconnectPlayer(r,'p1',now+100),now+101,rng)]){const r=action(before);reset(r,before,'p1');}
});
