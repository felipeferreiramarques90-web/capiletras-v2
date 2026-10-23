import test from 'node:test';
import assert from 'node:assert/strict';
import { clientView } from '../network/client-view.js';
import { createRoom, updateSettings, joinRoom, startGame, drawCard } from '../game/game.js';
import { startChallenge, confirmChallenge, voteChallenge } from '../game/challenge.js';

const now = 100_000;
const rng = () => .375;
function votingRoom() {
  let room = createRoom({code:'ABC234', playerId:'p1', sessionId:'s1', name:'Ana', now});
  room = updateSettings(room,'p1',{playerCount:4,initialCards:3});
  for (let i=2;i<=4;i++) room=joinRoom(room,{playerId:`p${i}`,sessionId:`s${i}`,name:['Ana','Bia','Caio','Dora'][i-1]});
  room=startGame(room,'p1',rng);
  Object.assign(room.game,{word:'CASA',lastLetterPlayerId:'p1',lastPlayerId:'p1',turnPlayerId:'p2'});
  room=startChallenge(room,'p2',now);
  return confirmChallenge(room,'p1',room.game.challenge.id,'',now+100,rng);
}
const vote = (room,id,value) => voteChallenge(room,id,room.game.challenge.id,value,now+200,rng);
const privateFields = ['votes','tally','voterIds','voterCount','respondedCount','respondedIds','acceptedIds','acceptedCount','early','pending','yes','no'];
function assertPrivateFieldsAbsent(value) {
  if (!value || typeof value!=='object') return;
  for (const [key,child] of Object.entries(value)) {
    assert.ok(!privateFields.includes(key),`Campo privado enviado: ${key}`);
    assertPrivateFieldsAbsent(child);
  }
}

test('filtro não envia progresso ou votos alheios; preserva somente o próprio voto',()=>{
  const room=vote(votingRoom(),'p2','sim'), before=structuredClone(room);
  for (const id of ['p1','p2','p3','p4']) {
    const view=clientView(room,id);
    assertPrivateFieldsAbsent(view.game.challenge);
    assert.equal(view.game.challenge.ownVote,id==='p2'?'sim':null);
    assert.equal(view.game.challenge.hasVoted,id==='p2');
    assert.equal(view.notice,'Aceitar palavra?');
  }
  assert.deepEqual(room,before,'o filtro não muda regras nem estado interno');
  assert.deepEqual(room.game.challenge.votes,{p2:'sim'});
});

test('reconexão recupera o próprio voto sem liberar um segundo voto nem expor os demais',()=>{
  let room=vote(votingRoom(),'p2','sim');
  room=vote(room,'p3','nao');
  const resumed=joinRoom(room,{playerId:'ignored',sessionId:'s2',name:'Bia'});
  const view=clientView(resumed,'p2');
  assert.equal(view.game.challenge.ownVote,'sim');
  assert.equal(view.game.challenge.canVote,false);
  assertPrivateFieldsAbsent(view.game.challenge);
  assert.equal(clientView(resumed,'p4').game.challenge.ownVote,null);
});

for (const value of ['sim','nao']) test(`resultado ${value}: cliente recebe apenas aceita/recusada, inclusive em avisos`,()=>{
  let room=vote(votingRoom(),'p2',value);
  room=vote(room,'p3',value);
  const expected=value==='sim'?'aceita':'recusada';
  const before=structuredClone(room);
  for (const p of room.players) {
    const view=clientView(room,p.id);
    assert.deepEqual(view.game.challengeResult,{outcome:expected});
    assert.equal(view.notice,`Palavra ${expected}`);
    assertPrivateFieldsAbsent(view.game.challengeResult);
    assert.doesNotMatch(view.notice,/\d|Sim|Não|antecipad/);
  }
  assert.deepEqual(room,before);
  assert.ok(room.game.challengeResult.tally,'totais internos permanecem para as regras');
  const next=drawCard(room,'p2',rng);
  assert.equal(clientView(next,'p2').notice,next.notice,'avisos posteriores continuam aparecendo');
});

test('janela de vitória também omite totais e listas de aceites no transporte',()=>{
  const room=votingRoom();
  room.game.challenge=null;
  room.game.pendingVictory={id:99,playerId:'p1',deadline:now+10_000,voterIds:['p2','p3','p4'],acceptedIds:['p2']};
  const before=structuredClone(room);
  const view=clientView(room,'p2');
  assertPrivateFieldsAbsent(view.game.pendingVictory);
  assert.equal(view.game.pendingVictory.canAccept,false);
  assert.equal(clientView(room,'p3').game.pendingVictory.canAccept,true);
  assert.deepEqual(room,before);
});
