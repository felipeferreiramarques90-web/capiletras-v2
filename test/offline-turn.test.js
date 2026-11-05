import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFLINE_RULES, DEFAULT_DECK_COMPOSITION } from '../game/config.js';
import { createRoom, joinRoom, updateSettings, updateDeckComposition, startGame, createDeck, disconnectPlayer, playCard, drawCard, roomView, isCardPlayable } from '../game/game.js';
import { randomOfflinePlay } from '../game/offline.js';
import { settleRoom } from '../game/settle.js';
import { startChallenge, loseChallenge } from '../game/challenge.js';
import { beginPendingVictory } from '../game/victory.js';
import { addBot } from '../bots/players.js';
import { compositionForHands } from './helpers/composition.js';
const rng=()=>.375;
function fixture(hands=[['wild-0','letra-A'],['double-0','letra-B'],['letra-C','letra-D']],limit=1) {
  let room=createRoom({code:'ABC234',playerId:'p1',sessionId:'s1',name:'Ana',now:0});
  room=updateSettings(room,'p1',{playerCount:hands.length,initialCards:3,maxDrawsPerTurn:limit});
  room=updateDeckComposition(room,'p1',compositionForHands(hands));
  for(let i=1;i<hands.length;i++)room=joinRoom(room,{playerId:`p${i+1}`,sessionId:`s${i+1}`,name:`Pessoa ${i+1}`});
  room=startGame(room,'p1',rng);
  const cards=createDeck(room.settings.deckComposition),used=new Set(hands.flat());
  room.players.forEach((p,i)=>p.hand=hands[i].map(id=>cards.find(c=>c.id===id)));
  Object.assign(room.game,{deck:cards.filter(c=>!used.has(c.id)),word:'CA',lastPlayerId:'p3',lastLetterPlayerId:'p3'});
  return room;
}
const disconnect=(room,id='p1',now=0)=>settleRoom(disconnectPlayer(room,id,now),now,rng);
const reconnect=(room,id='p1',now=0)=>settleRoom(joinRoom(room,{playerId:'new',sessionId:`s${id.slice(1)}`,name:'ignored'}),now,rng);
const tick=(room,now,random=rng)=>settleRoom(JSON.parse(JSON.stringify(room)),now,random);

test('constantes 21s/5s; nenhum pulo, sem efeito fora da vez e bots sem sequência',()=>{
  assert.equal(OFFLINE_RULES.reconnectMs,21000);assert.equal(OFFLINE_RULES.stepMs,5000);
  const base=fixture(),out=disconnect(base,'p2');assert.equal(out.game.offlineTurn,null);
  const room=disconnect(base);assert.equal(room.game.turnPlayerId,'p1');assert.equal(room.game.offlineTurn.deadline,21000);
  assert.equal(roomView(room,'p2').game.paused,false);
  assert.throws(()=>drawCard(room,'p1',rng),/Reconecte/);
  let bots=createRoom({code:'ABC234',playerId:'h',sessionId:'s',name:'Ana',now:0});bots=addBot(bots,'h','bot');bots=startGame(bots,'h',rng);bots.game.turnPlayerId='bot';
  assert.equal(tick(bots,100000).game.offlineTurn,null);
});
for(const limit of [1,2,3,4])test(`21s + ${limit} compras espaçadas em 5s, então uma jogada`,()=>{
  let room=disconnect(fixture(undefined,limit));const size=room.players[0].hand.length;
  assert.equal(tick(room,20999).game.drawsThisTurn,0);
  for(let i=1;i<=limit;i++) {
    const now=21000+(i-1)*5000;room=tick(room,now);
    assert.equal(room.game.drawsThisTurn,i);assert.equal(room.players[0].hand.length,size+i);
    assert.equal(room.game.turnPlayerId,'p1');assert.equal(room.game.offlineTurn.deadline,now+5000);
    assert.match(room.notice,/comprou uma carta automaticamente/);
  }
  room=tick(room,21000+limit*5000);assert.equal(room.game.turnPlayerId,'p2');assert.equal(room.players[0].hand.length,size+limit-1);
  assert.match(room.notice,/jogada automática/);assert.equal(room.game.offlineTurn,null);
  assert.deepEqual(JSON.parse(JSON.stringify(room)),room);
});
for(const bought of [0,1,2,3,4])test(`reconexão após ${bought} compras cancela e preserva a mão/limite`,()=>{
  let room=disconnect(fixture(undefined,4));for(let i=0;i<bought;i++)room=tick(room,21000+i*5000);
  const before=structuredClone(room.players[0].hand),now=bought?21001+(bought-1)*5000:1000;
  room=reconnect(room,'p1',now);assert.equal(room.game.offlineTurn,null);assert.deepEqual(room.players[0].hand,before);
  assert.equal(roomView(room,'p1').game.drawsRemaining,4-bought);
  room=disconnect(room,'p1',now+1000);assert.equal(room.game.offlineTurn.deadline,now+22000);
  room=tick(room,now+22000);
  if(bought<4)assert.equal(room.game.drawsThisTurn,bought+1);else assert.equal(room.game.turnPlayerId,'p2');
});

test('restauração vencida resolve uma etapa e aguarda 5s reais antes da próxima',()=>{
  let room=disconnect(fixture(undefined,4));room=tick(room,90000);
  assert.equal(room.game.drawsThisTurn,1);assert.equal(room.game.offlineTurn.deadline,95000);
  assert.equal(tick(room,94999).game.drawsThisTurn,1);
});
for(const [id,blocked] of [['wild-0','A'],['vowel-0','A'],['consonant-0','B'],['first-0','A'],['last-0','N'],['swap-0','A'],['block-0','A'],['life-0','A'],['multi-0','A'],['letra-Z','A'],['pass-0','A'],['double-0','A']]) {
  test(`ação aleatória de ${id} respeita restrições, Bloqueio e débito atomicamente`,()=>{
    for(const debt of [0,2])for(const roll of [0,.999999]) {
      let room=fixture([[id,'sword-0'],['letra-B','letra-C'],['letra-D','letra-E']]);
      Object.assign(room.game,{blockedLetter:blocked,letterDebt:{count:debt,playerId:debt?'p1':null}});
      const action=randomOfflinePlay(room,()=>roll);
      assert.equal(action.cardId,id,'espada não entra na lista da própria vez');
      if(debt && !['pass-0','double-0'].includes(id)){assert.equal(action.accumulatedLetters.length,2);assert.notEqual(action.accumulatedLetters[0],blocked);}
      assert.doesNotThrow(()=>playCard(room,'p1',action.cardId,action.letter,action.blockedLetter,action.accumulatedLetters));
      if(id==='multi-0')assert.equal(action.letter.length,roll===0?2:16);
      if(id==='block-0')assert.match(action.blockedLetter,/^[A-Z]$/);
    }
  });
}
test('sorteio uniforme escolhe qualquer carta da lista, sem ordem/dicionário',()=>{
  const room=fixture([['letra-Z','letra-A','letra-X'],['letra-B','letra-C'],['letra-D','letra-E']]);
  assert.deepEqual([0,.34,.67].map(r=>randomOfflinePlay(room,()=>r).cardId),['letra-Z','letra-A','letra-X']);
});
test('Troca vazia, 2x inicial e carta única restrita não são sorteados; segurança passa sem compra preservando visor',()=>{
  for(const type of ['life','sword','double','pass']){
    let room=fixture([[`${type}-0`],['letra-B','letra-C'],['letra-D','letra-E']]);room.game.deck=[];room.game.discard=[];
    assert.equal(randomOfflinePlay(room,rng),null);
    room=disconnect(room);room=tick(room,21000);room=tick(room,26000);
    assert.equal(room.game.turnPlayerId,'p2');assert.equal(room.game.word,'CA');assert.equal(room.game.lastPlayerId,null);
  }
  let room=fixture([['swap-0','double-0'],['letra-B','letra-C'],['letra-D','letra-E']]);Object.assign(room.game,{word:'',lastPlayerId:null});assert.equal(randomOfflinePlay(room,rng),null);
});
test('sem jogável após compra: Não consigo jogar compra 4, zera mesa e passa a vez',()=>{
  let room=fixture([['sword-0'],['letra-B','letra-C'],['letra-D','letra-E']]);
  room.game.deck=[{id:'reserve',type:'letter',letter:'K'},{id:'draw',type:'sword'}];room.game.discard=[];
  room=disconnect(room);room=tick(room,21000);room=tick(room,26000);
  assert.equal(room.game.word,'');assert.equal(room.game.turnPlayerId,'p2');assert.equal(room.game.letterDebt.count,0);
  assert.equal(room.players[0].hand.length,3);
});
test('última carta aleatória usa vitória pendente e não perde a carta',()=>{
  let room=fixture([['letra-Z'],['letra-B','letra-C'],['letra-D','letra-E']]);room.game.deck=[];room.game.discard=[];
  room=disconnect(room);room=tick(room,21000);room=tick(room,26000);
  assert.equal(room.game.pendingVictory.playerId,'p1');assert.equal(room.game.word,'CAZ');assert.equal(room.players[0].hand.length,0);
});
test('2x forçado e cadeia de retornos conservam vagas desconectadas e reiniciam compra/21s',()=>{
  let room=fixture([['double-0','letra-A'],['double-1','letra-B'],['letra-C','letra-D']]);
  room=disconnect(room,'p3');room=playCard(room,'p1','double-0');room=tick(room,100);
  assert.equal(room.game.turnPlayerId,'p3');assert.equal(room.game.offlineTurn.deadline,21100);
  room=tick(room,21100);room=tick(room,26100,()=>0);
  assert.equal(room.game.turnPlayerId,'p1');assert.equal(room.game.drawsThisTurn,0);
  room=disconnect(room,'p1',27000);assert.equal(room.game.offlineTurn.deadline,48000);
});
test('desafio suspende exatamente o restante e retoma após PERDI com todos os efeitos',()=>{
  let room=disconnect(fixture());room=startChallenge(room,'p2',5000);room=tick(room,5000);
  assert.equal(room.game.offlineTurn.deadline,null);assert.equal(room.game.offlineTurn.remainingMs,16000);
  room=tick(room,12000);assert.equal(room.game.offlineTurn.remainingMs,16000);
  room=loseChallenge(room,'p3',room.game.challenge.id,12000,rng);room=tick(room,12000);
  assert.equal(room.game.offlineTurn.deadline,28000);assert.equal(tick(room,27999).game.drawsThisTurn,0);
});
test('vitória pendente suspende e retoma; Y desconectado conserva PERDI imediato do desafio',()=>{
  let room=disconnect(fixture());room=beginPendingVictory(room,'p3',4000);room=tick(room,4000);
  assert.equal(room.game.offlineTurn.remainingMs,17000);
  // Exercita retomada de uma janela cancelada, antes de testar Y desconectado.
  room.game.pendingVictory=null;room=tick(room,9000);assert.equal(room.game.offlineTurn.deadline,26000);
  room.game.lastLetterPlayerId='p1';room=startChallenge(room,'p2',10000);room=tick(room,10000);
  assert.equal(room.game.challenge,null);assert.equal(room.game.challengeResult.reason,'desconexao');
});

test('Troca com visor vazio paga débito antes da substituição; limites de compra zeram no 2x e no retorno',()=>{
  let room=fixture([['swap-0','sword-0'],['letra-B','letra-C'],['letra-D','letra-E']]);
  Object.assign(room.game,{word:'',blockedLetter:'A',letterDebt:{count:2,playerId:'p1'}});
  const action=randomOfflinePlay(room,()=>0);
  assert.equal(action.accumulatedLetters,'BA');assert.equal(action.letter,'B');
  const played=playCard(room,'p1',action.cardId,action.letter,undefined,action.accumulatedLetters);
  assert.equal(played.game.word,'BB');assert.equal(played.game.blockedLetter,null);
  room=fixture(undefined,4);room.game.lastPlayerId='p2';
  for(let i=0;i<4;i++)room=drawCard(room,'p1',rng);
  // Move uma carta 2x da mão de Bia para Ana, conservando todas as cartas.
  const card=room.players[1].hand.shift();room.players[0].hand.push(card);
  room=playCard(room,'p1',card.id);
  assert.equal(room.game.turnPlayerId,'p2');assert.equal(room.game.drawsThisTurn,0);
  for(let i=0;i<4;i++)room=drawCard(room,'p2',rng);
  room=playCard(room,'p2','letra-B');
  assert.equal(room.game.turnPlayerId,'p1');assert.equal(room.game.drawsThisTurn,0);
  assert.equal(roomView(room,'p1').game.drawsRemaining,4);
});
