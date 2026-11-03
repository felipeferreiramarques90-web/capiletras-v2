import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, updateSettings, updateDeckComposition, startGame, createDeck,
  playCard, roomView, canPlaySword, skipTurn } from '../game/game.js';
import { startChallenge, loseChallenge, confirmChallenge } from '../game/challenge.js';
import { compositionForHands } from './helpers/composition.js';

const rng = () => .375, now = 100000;
function fixture(hands = [['wild-0', 'pass-0', 'double-0'], ['sword-0', 'letra-B'], ['sword-1', 'letra-C'], ['letra-D', 'letra-E']]) {
  let room = createRoom({ code:'ABC234', playerId:'p1', sessionId:'s1', name:'Ana', now });
  room = updateSettings(room,'p1',{ playerCount:hands.length, initialCards:3 });
  room = updateDeckComposition(room,'p1',compositionForHands(hands));
  for (let i=1;i<hands.length;i++) room=joinRoom(room,{playerId:`p${i+1}`,sessionId:`s${i+1}`,name:['Ana','Bia','Caio','Dani'][i]});
  room = startGame(room,'p1',rng);
  const cards=createDeck(room.settings.deckComposition), used=new Set(hands.flat());
  room.players.forEach((p,i)=>{p.hand=hands[i].map(id=>cards.find(c=>c.id===id));});
  Object.assign(room.game,{deck:cards.filter(c=>!used.has(c.id)),word:'CA',letterDebt:{count:2,playerId:'p1'},blockedLetter:'K',lastLetterPlayerId:'p4',lastPlayerId:'p4',drawsThisTurn:1});
  return room;
}
const sword=(room,id='p2',card='sword-0',letter='S')=>playCard(room,id,card,letter,undefined,'',room.game.version,now);
const unchanged=(room,operation,pattern)=>{const before=structuredClone(room);assert.throws(operation,pattern);assert.deepEqual(room,before);};

test('espada com débito preserva dono, quantidade, turno, compra e mão do devedor; consome bloqueio',()=>{
  const original=fixture();
  assert.equal(canPlaySword(original,'p2'),true);
  assert.ok(!roomView(original,'p2').game.allowedLettersByCard['sword-0'].includes('K'));
  unchanged(original,()=>sword(original,'p2','sword-0','K'),/bloqueada/);
  unchanged(original,()=>playCard(original,'p2','sword-0','S',undefined,'AB'),/Não há letras/);
  const next=sword(original);
  assert.equal(next.game.word,'CAS');assert.equal(next.game.blockedLetter,null);
  assert.deepEqual(next.game.letterDebt,original.game.letterDebt);
  assert.deepEqual(next.players[0].hand,original.players[0].hand);
  assert.equal(next.game.turnPlayerId,'p1');assert.equal(next.game.drawsThisTurn,1);
  assert.equal(next.game.lastLetterWasSword,true);
  unchanged(next,()=>playCard(next,'p1','wild-0','A',undefined,'KA',original.game.version),/mesa mudou/);
  const paid=playCard(next,'p1','wild-0','A',undefined,'KA');
  assert.equal(paid.game.word,'CASKAA','pagamento entra depois da espada; K já não está bloqueado');
  assert.deepEqual(paid.game.letterDebt,{count:0,playerId:null});
  assert.equal(paid.game.lastLetterWasSword,false);
  assert.equal(startChallenge(paid,'p2',now).game.challenge.challengedId,'p1');
});

test('dúvida com débito só abre após espada, contra seu autor; duas espadas atualizam Y',()=>{
  let room=fixture();
  unchanged(room,()=>startChallenge(room,'p2',now),/ainda deve 2 letras/);
  assert.equal(roomView(room,'p3').game.canChallengeWithDebt,false);
  room=sword(room);
  assert.equal(roomView(room,'p3').game.canChallengeWithDebt,true);
  assert.equal(startChallenge(room,'p3',now).game.challenge.challengedId,'p2');
  unchanged(room,()=>startChallenge(room,'p2',now),/própria palavra/);
  room=sword(room,'p3','sword-1','A');
  assert.equal(room.game.word,'CASA');assert.equal(room.game.lastLetterWasSword,true);
  assert.deepEqual(room.game.letterDebt,{count:2,playerId:'p1'});
  assert.equal(startChallenge(room,'p2',now).game.challenge.challengedId,'p3');
  assert.deepEqual(JSON.parse(JSON.stringify(room)),room);
});

for (const type of ['pass','double']) test(`${type} após espada encerra exceção e preserva a trava por débito`,()=>{
  let room=sword(fixture());
  room=playCard(room,'p1',`${type}-0`);
  assert.equal(room.game.lastLetterWasSword,false);
  assert.equal(room.game.lastLetterPlayerId,'p2');
  assert.ok(room.game.letterDebt.count>0);
  assert.equal(roomView(room,'p4').game.canChallengeWithDebt,false);
  unchanged(room,()=>startChallenge(room,'p4',now),/ainda deve/);
  if(type==='double') assert.equal(room.game.turnPlayerId,'p2');
});

for(const [card,letter,blocked] of [['letra-A'],['wild-0','A'],['vowel-0','A'],['consonant-0','S'],['first-0','A'],['last-0','S'],['swap-0','A'],['block-0','A','X'],['life-0','A'],['multi-0','SA']]) {
  test(`${card} com pagamento encerra marca da espada e atualiza autor do visor`,()=>{
    let room=fixture([[card,'letra-Z'],['sword-0','letra-B'],['letra-C','letra-D']]);
    room=sword(room);
    room=playCard(room,'p1',card,letter,blocked,'KK');
    assert.equal(room.game.lastLetterWasSword,false);
    assert.equal(room.game.lastLetterPlayerId,'p1');
    assert.equal(room.game.letterDebt.count,0);
  });
}

for(const outcome of ['manual','aceita','recusada']) test(`reset após desafio ${outcome} limpa marca, débito e autor`,()=>{
  let room=sword(fixture());
  room=startChallenge(room,'p3',now);
  const id=room.game.challenge.id;
  room=outcome==='manual' ? loseChallenge(room,'p2',id,now,rng)
    : confirmChallenge(room,'p2',id,'A',now,rng,()=>outcome==='aceita');
  assert.equal(room.game.lastLetterWasSword,false);
  assert.equal(room.game.letterDebt.count,0);assert.equal(room.game.word,'');
  assert.equal(room.game.lastPlayerId,null);assert.equal(room.game.lastLetterPlayerId,null);
  unchanged(room,()=>startChallenge(room,'p3',now),/vazia/);
});

test('Não consigo jogar limpa exceção até sem cartas para comprar, preservando o visor pela regra existente',()=>{
  let room=sword(fixture([['sword-2'],['sword-0','letra-B'],['letra-C','letra-D']]));
  room.game.deck=[];room.game.discard=[];
  room=skipTurn(room,'p1',rng);
  assert.equal(room.game.lastLetterWasSword,false);
  assert.equal(room.game.lastPlayerId,null);assert.equal(room.game.letterDebt.count,0);
  assert.equal(room.game.word,'CAS');
});

test('estado antigo sem a marca continua proibindo dúvidas com débito',()=>{
  const room=fixture();delete room.game.lastLetterWasSword;
  assert.equal(roomView(room,'p2').game.lastLetterWasSword,false);
  unchanged(room,()=>startChallenge(room,'p2',now),/ainda deve/);
});
