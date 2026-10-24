import test from 'node:test';
import assert from 'node:assert/strict';
import { createDictionary } from '../bots/dictionary.js';
import { BOT_RULES, CHANCE_BOT_ESPADA } from '../bots/config.js';
import { botTask, decideBotAction } from '../bots/brain.js';
import { applyBotAction } from '../bots/actions.js';
import { addBot } from '../bots/players.js';
import { createRoom, startGame, createDeck, roomView, playCard, drawCard } from '../game/game.js';
import { DEFAULT_DECK_COMPOSITION } from '../game/config.js';
import { simulateMatch } from './helpers/simulation.js';

const dictionary = createDictionary(['CASA','CASAS','CANA','CANAS']), now = 10000;
function fixture({ word = 'CA', blockedLetter = null } = {}) {
  let room = createRoom({ code:'ABC234',playerId:'h',sessionId:'s',name:'Ana',now });
  room = addBot(addBot(room,'h','b1'),'h','b2'); room = startGame(room,'h',() => .375);
  const hands = [['letra-S','letra-Z'],['sword-0','letra-A'],['sword-1','letra-C']], cards = createDeck();
  const used = new Set(hands.flat());
  room.players.forEach((p,i) => { p.hand = hands[i].map((id) => cards.find((c) => c.id === id)); });
  Object.assign(room.game,{word,blockedLetter,deck:cards.filter((c) => !used.has(c.id)),turnPlayerId:'h',lastPlayerId:'h',lastLetterPlayerId:null,playNumber:5,letterPlayNumber:3});
  return room;
}
const decide = (room, rng = () => .1, id = 'b1') => decideBotAction(roomView(room,id),dictionary,rng);
const apply = (room, action, id = 'b1') => applyBotAction(room,id,action,{version:room.game.version,now,rng:() => .375});

test('chance configurada de espada: abaixo joga, no limite ou acima registra só a decisão', () => {
  assert.equal(CHANCE_BOT_ESPADA,.2); assert.equal(BOT_RULES.swordChance,CHANCE_BOT_ESPADA);
  for (const [roll,type] of [[0,'sword'],[.199,'sword'],[.2,'sword-decision'],[.99,'sword-decision']]) {
    const room = fixture(), action = decide(room,() => roll);
    assert.equal(action.type,type);
    const next = apply(room,action);
    assert.equal(next.game.botSwordDecisions.b1,5);
    assert.equal(next.game.word,type === 'sword' ? 'CAN' : 'CA');
    assert.equal(next.game.turnPlayerId,'h');
  }
});

test('bot só usa espada com prefixo válido e letra permitida pelo Bloqueio', () => {
  const blocked = fixture({blockedLetter:'S'}), action = decide(blocked);
  assert.equal(action.type,'sword'); assert.equal(action.letter,'N');
  const next = apply(blocked,action);
  assert.equal(next.game.word,'CAN'); assert.equal(next.game.blockedLetter,null);
  const invalid = fixture({word:'ZZZ'}), rejected = decide(invalid,() => 0);
  assert.equal(rejected.type,'sword-decision');
  assert.equal(apply(invalid,rejected).game.word,'ZZZ');
});

test('sorteio uma vez por bot/jogada, não repete após compra; bots independentes e nova carta permite novo sorteio', () => {
  let room = fixture(), rolls = 0;
  room = apply(room,decide(room,() => { rolls++; return .99; }));
  for (let i = 0; i < 10; i++) assert.equal(decide(room,() => { rolls++; return 0; }),null);
  room = drawCard(room,'h',() => .375);
  assert.equal(decide(room,() => { rolls++; return 0; }),null);
  assert.equal(rolls,1);
  assert.equal(botTask(roomView(room,'b2'),dictionary).kind,'sword');
  // B2 decide independentemente e joga; agora há outra jogada de carta na mesa.
  room = apply(room,decide(room,() => .1,'b2'),'b2');
  assert.equal(room.game.playNumber,6); assert.equal(room.game.botSwordDecisions.b1,5);
  const action = decide(room,() => { rolls++; return 0; });
  assert.equal(action.type,'sword'); assert.equal(action.letter,'A');
  room = apply(room,action);
  assert.ok(dictionary.isWord(room.game.word)); assert.equal(rolls,2);
  assert.deepEqual(JSON.parse(JSON.stringify(room)),room);
  assert.equal(JSON.stringify(room).includes('dictionary'),false);
});

test('2x também cria nova oportunidade de sorteio, sem consumir Bloqueio nem alterar sua pilha', () => {
  let room = fixture();
  room.players[0].hand.push({id:'double-extra',type:'double'});
  room.game.lastPlayerId = 'b2';
  room = apply(room,decide(room,() => .99));
  room = playCard(room,'h','double-extra');
  assert.equal(room.game.playNumber,6); assert.equal(room.game.turnPlayerId,'b2');
  const action = decide(room); assert.equal(action.type,'sword');
  room = apply(room,action);
  assert.equal(room.game.turnPlayerId,'b2'); assert.deepEqual(room.game.extraTurns,['h']);
});

test('ação do bot com versão antiga é descartada após uma espada; replaneja com visor atualizado', () => {
  const room = fixture(), version = room.game.version, action = decide(room);
  const next = playCard(room,'b2','sword-1','N',undefined,'',version,now);
  const before = structuredClone(next);
  assert.throws(() => applyBotAction(next,'b1',action,{version,now,rng:() => .375}),/antiga/);
  assert.deepEqual(next,before);
  assert.equal(decide(next).letter,'A');
});

test('cérebro usa só mão própria; espada não é oferecida na vez nem com débito', () => {
  const room = fixture(), view = roomView(room,'b1');
  view.players.forEach((p) => Object.defineProperty(p,'hand',{get(){throw Error('Mão adversária acessada');}}));
  assert.equal(decideBotAction(view,dictionary,() => 0).type,'sword');
  room.game.turnPlayerId = 'b1';
  assert.notEqual(botTask(roomView(room,'b1'),dictionary)?.kind,'sword');
  room.game.turnPlayerId = 'h'; room.game.letterDebt = {count:1,playerId:'h'};
  assert.equal(botTask(roomView(room,'b1'),dictionary),null);
});

for (const seed of [3,15,29,44,99]) test(`partida completa com bots e espadas termina sem travar (semente ${seed})`, () => {
  const room = simulateMatch(DEFAULT_DECK_COMPOSITION,seed);
  assert.equal(room.phase,'finished');
  assert.equal(room.game.deck.length + room.game.discard.length + room.players.reduce((n,p) => n + p.hand.length,0),76);
});
