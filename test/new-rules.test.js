import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, DEFAULT_DECK_COMPOSITION, CARD_TYPES, deckSize } from '../game/config.js';
import { createRoom, joinRoom, updateSettings, updateDeckComposition, restoreDefaultComposition, createDeck, startGame, playCard, drawCard,
  skipTurn, roomView, canPlaySword, disconnectPlayer, isCardPlayable } from '../game/game.js';
import { addBot, removeBot } from '../bots/players.js';
import { startChallenge } from '../game/challenge.js';
import { decideBotAction, chooseTurnAction } from '../bots/brain.js';
import { createDictionary } from '../bots/dictionary.js';
import { BOT_RULES } from '../bots/config.js';
import { botDelayMs } from '../network/bots.js';
import { compositionForHands } from './helpers/composition.js';
import { simulateMatch } from './helpers/simulation.js';

const rng = () => .375, now = 100000;
const lobby = () => createRoom({code:'ABC234',playerId:'p1',sessionId:'s1',name:'Ana',now});
function fixture(hands, state = {}) {
  let room = updateSettings(lobby(),'p1',{playerCount:hands.length,initialCards:3});
  room = updateDeckComposition(room,'p1',compositionForHands(hands));
  for (let i=1;i<hands.length;i++) room=joinRoom(room,{playerId:`p${i+1}`,sessionId:`s${i+1}`,name:['Ana','Bia','Caio','Dani'][i]});
  room=startGame(room,'p1',rng);
  const cards=createDeck(room.game.deckComposition),used=new Set(hands.flat());
  room.players.forEach((p,i)=>{p.hand=hands[i].map(id=>cards.find(c=>c.id===id));});
  Object.assign(room.game,{deck:cards.filter(c=>!used.has(c.id)),word:'CA',lastPlayerId:'p3',lastLetterPlayerId:'p3',...state});
  return room;
}
function unchanged(room, operation, pattern) {const before=structuredClone(room);assert.throws(operation,pattern);assert.deepEqual(room,before);}
const play=(room,id,card,letter,blocked,version=room.game.version)=>playCard(room,id,card,letter,blocked,'',version,now);
const swordHands=[['double-0','letra-A'],['sword-0','letra-B'],['sword-1','letra-C'],['sword-2','letra-D']];

test('duas e três espadas com a versão antiga valem em ordem; última é Y e alvo do 2x',()=>{
  let room=fixture(swordHands,{lastPlayerId:null,drawsThisTurn:1});const version=room.game.version;
  room=play(room,'p2','sword-0','S',undefined,version);
  room=play(room,'p3','sword-1','A',undefined,version);
  assert.equal(room.game.word,'CASA');assert.equal(room.game.lastLetterPlayerId,'p3');
  assert.equal(startChallenge(room,'p1',now).game.challenge.challengedId,'p3');
  room=play(room,'p4','sword-2','S',undefined,version);
  assert.equal(room.game.word,'CASAS');assert.equal(room.game.lastLetterPlayerId,'p4');
  assert.equal(room.game.turnPlayerId,'p1');assert.equal(room.game.drawsThisTurn,1);
  unchanged(room,()=>play(room,'p4','sword-2','O',undefined,version));
  room=play(room,'p1','double-0');
  assert.equal(room.game.turnPlayerId,'p4');assert.deepEqual(room.game.extraTurns,['p1']);
});

test('duplo pedido do mesmo autor é negado; letra revalidada usa o bloqueio atual sem mutação',()=>{
  let room=fixture([['block-0','letra-A'],['sword-0','sword-1','letra-B'],['letra-C','letra-D']],{lastPlayerId:null});
  const version=room.game.version;
  room=play(room,'p2','sword-0','S');
  unchanged(room,()=>play(room,'p2','sword-1','A',undefined,version),/não pode/);
  // Ana joga Bloqueio enquanto Bia está escolhendo sua próxima espada.
  room=play(room,'p1','block-0','A','X');
  room=play(room,'p2','letra-B'); // Caio assume a vez; Bia é a última e ainda não pode usar espada.
  room=play(room,'p3','letra-C'); // Ana assume; o bloqueio já foi consumido.
  room=play(room,'p1','letra-A'); // última letra abre janela, então nenhuma espada entra.
  unchanged(room,()=>play(room,'p2','sword-1','A',undefined,version),/vitória pendente/);
  const blocked=fixture([['block-0','letra-A'],['letra-B','letra-C'],['sword-0','letra-D']],{lastPlayerId:null});
  const changed=play(blocked,'p1','block-0','A','X');
  unchanged(changed,()=>play(changed,'p3','sword-0','X',undefined,blocked.game.version),/bloqueada/);
  const valid=play(changed,'p3','sword-0','Y',undefined,blocked.game.version);
  assert.equal(valid.game.word,'CAAY');assert.equal(valid.game.blockedLetter,null);
});

test('dois participantes reais: espada é 0 efetiva, valor 4 preservado, limite recalcula em entrada e saída',()=>{
  let room=updateSettings(lobby(),'p1',{playerCount:8,initialCards:9});
  room=joinRoom(room,{playerId:'p2',sessionId:'s2',name:'Bia'});
  assert.equal(roomView(room,'p1').deckSize,72);assert.equal(room.settings.deckComposition.sword,4);
  assert.equal(roomView(room,'p1').swordUnavailable,true);assert.equal(room.settings.initialCards,8);
  assert.match(roomView(room,'p1').settingsAdjustment.message,/ajustadas para 8/);
  room=joinRoom(room,{playerId:'p3',sessionId:'s3',name:'Caio'});
  assert.equal(roomView(room,'p1').deckSize,76);assert.equal(roomView(room,'p1').swordUnavailable,false);
  room=updateSettings(room,'p1',{playerCount:8,initialCards:9});
  room=disconnectPlayer(room,'p3',now,true);
  assert.equal(room.settings.initialCards,8);assert.equal(roomView(room,'p1').deckSize,72);
  room=updateDeckComposition(room,'p1',{...DEFAULT_DECK_COMPOSITION,sword:0});
  room=restoreDefaultComposition(room,'p1');
  assert.equal(room.settings.deckComposition.sword,4);assert.equal(roomView(room,'p1').deckSize,72);
});

test('partidas de dois sem espadas, inclusive com bot; saída depois do início preserva o baralho congelado',()=>{
  let human=joinRoom(lobby(),{playerId:'p2',sessionId:'s2',name:'Bia'});
  let bots=addBot(lobby(),'p1','b1');
  for (const initial of [human,bots]) for (const sword of [0,4,30]) {
    let room=updateDeckComposition(initial,'p1',{...DEFAULT_DECK_COMPOSITION,sword});
    room=startGame(room,'p1',rng);
    const all=[...room.game.deck,...room.players.flatMap(p=>p.hand)];
    assert.equal(all.length,72);assert.ok(all.every(c=>c.type!=='sword'));
    assert.equal(room.settings.deckComposition.sword,sword);assert.equal(room.game.deckComposition.sword,0);
  }
  let three=addBot(addBot(lobby(),'p1','b1'),'p1','b2');
  three=startGame(three,'p1',rng);
  const originalMaximum=roomView(three,'b1').settings.maxInitialCards;
  three=disconnectPlayer(three,'p1',now,true);
  assert.equal(roomView(three,'b1').deckSize,76);assert.equal(three.game.deckComposition.sword,4);
  assert.equal(roomView(three,'b1').settings.maxInitialCards,originalMaximum);assert.equal(roomView(three,'b1').startIssue,null);
  assert.deepEqual(JSON.parse(JSON.stringify(three)),three);
  bots=addBot(bots,'p1','b2');assert.equal(roomView(bots,'p1').deckSize,76);
  bots=removeBot(bots,'p1','b2');assert.equal(roomView(bots,'p1').deckSize,72);
});

for (const [type,choice] of [['life','A'],['pass',undefined],['double',undefined]]) test(`${type} única é rejeitada; compra injogável libera a carta e impede Não consigo jogar`,()=>{
  const id=`${type}-0`;
  let room=fixture([[id],['letra-B','letra-C'],['letra-D','letra-E']],{word:'',lastPlayerId:'p3'});
  assert.equal(roomView(room,'p1').game.playableCardIds.includes(id),false);
  unchanged(room,()=>play(room,'p1',id,choice),/Compre uma carta/);
  room.game.deck=room.game.deck.filter(c=>c.id!=='swap-0');room.game.deck.push({id:'swap-0',type:'swap'});
  room=drawCard(room,'p1',rng);
  assert.equal(room.players[0].hand.length,2);
  assert.ok(roomView(room,'p1').game.playableCardIds.includes(id));
  assert.equal(roomView(room,'p1').game.playableCardIds.includes('swap-0'),false);
  assert.equal(roomView(room,'p1').game.canSkipTurn,false);
  unchanged(room,()=>drawCard(room,'p1',rng),/já comprou/);
  room=play(room,'p1',id,choice);
  assert.equal(room.phase,'playing');assert.equal(room.game.winnerId,null);assert.equal(room.game.pendingVictory,null);
});

for (const type of ['life','pass','double','sword']) test(`${type} única sem compra nem descarte habilita a exceção de segurança e preserva visor`,()=>{
  const room=fixture([[`${type}-0`],['letra-B','letra-C'],['letra-D','letra-E']]);
  room.game.deck=[];room.game.discard=[];
  assert.equal(roomView(room,'p1').game.canSkipTurn,true);
  const next=skipTurn(room,'p1',rng);
  assert.equal(next.game.word,'CA');assert.equal(next.game.turnPlayerId,'p2');assert.equal(next.game.winnerId,null);
});

for (const type of ['life','pass','double','sword']) test(`turno forçado com só ${type} exige compra nova e aplica a mesma função de jogabilidade`,()=>{
  let room=fixture([[`${type}-0`],['double-1','letra-B'],['letra-C','letra-D']],{turnPlayerId:'p2',lastPlayerId:'p1',drawsThisTurn:1});
  room=play(room,'p2','double-1');
  assert.equal(room.game.turnPlayerId,'p1');assert.equal(room.game.drawsThisTurn,0);
  assert.equal(roomView(room,'p1').game.playableCardIds.length,0);assert.equal(roomView(room,'p1').game.canSkipTurn,false);
  room=drawCard(room,'p1',rng);
  const card=room.players[0].hand.find(c=>c.type===type);
  assert.equal(isCardPlayable(card,room.game,'p1',2),type!=='sword');
});

test('espada única só volta a ser utilizável fora da própria vez com duas ou mais cartas',()=>{
  let room=fixture([['letra-A','letra-B'],['sword-0'],['letra-C','letra-D']],{lastPlayerId:null});
  assert.equal(canPlaySword(room,'p2'),false);
  unchanged(room,()=>play(room,'p2','sword-0','A'),/Compre uma carta/);
  room=play(room,'p1','letra-A');room=drawCard(room,'p2',rng);
  assert.equal(canPlaySword(room,'p2'),false);
  // Mantém duas cartas para o caso de partida restaurada em uma vez seguinte.
  room.game.turnPlayerId='p3';room.game.lastPlayerId='p1';
  assert.equal(canPlaySword(room,'p2'),true);
});

test('duas cartas restritas: uma joga, a restante fica desabilitada em vez de vencer',()=>{
  let room=fixture([['pass-0','life-0'],['letra-B','letra-E'],['letra-C','letra-D']]);
  room=play(room,'p1','pass-0');
  assert.equal(room.players[0].hand.length,1);assert.equal(room.phase,'playing');
  assert.equal(roomView(room,'p1').game.playableCardIds.includes('life-0'),false);
});

test('bots compram se tiverem somente uma carta restrita, independentemente do prefixo',()=>{
  const dictionary=createDictionary(['CASA','CASAS']);
  for (const type of ['life','pass','double','sword']) {
    const room=fixture([[`${type}-0`],['letra-B','letra-C'],['letra-D','letra-E']],{word:'CASA'});
    const view=roomView(room,'p1');
    assert.equal(chooseTurnAction(view,dictionary).type,'draw');
    assert.equal(decideBotAction(view,dictionary,rng).type,'draw');
  }
});

test('atrasos determinísticos: jogo 5–13s, dúvida final 1–8s, respostas 0,5–1,5s e margem de prazo',()=>{
  for (const [roll,expected] of [[0,5000],[.999999,13000]]) {
    for (const kind of ['turn','doubt','sword','complete']) assert.equal(botDelayMs({kind},{},()=>roll),expected);
  }
  const game={pendingVictory:{deadline:now+10000},challenge:{completionDeadline:now+30000,voteDeadline:now+15000}};
  for (const [roll,expected] of [[0,1000],[.999999,8000]]) assert.equal(botDelayMs({kind:'doubt'},game,()=>roll,BOT_RULES,now),expected);
  for (const kind of ['vote','accept']) {
    assert.equal(botDelayMs({kind},game,()=>0,BOT_RULES,now),500);
    assert.equal(botDelayMs({kind},game,()=>.999999,BOT_RULES,now),1500);
  }
  assert.equal(botDelayMs({kind:'complete'},game,()=>.999999,BOT_RULES,now+29000),1000-BOT_RULES.deadlineMarginMs);
});

for (const seed of [8,77,308]) test(`simulação com as novas regras termina sem vitória imediata indevida (semente ${seed})`,()=>{
  const room=simulateMatch(DEFAULT_DECK_COMPOSITION,seed);
  assert.equal(room.phase,'finished');assert.equal(room.game.deckComposition.sword,4);
  assert.equal(room.game.deck.length+room.game.discard.length+room.players.reduce((n,p)=>n+p.hand.length,0),76);
});
