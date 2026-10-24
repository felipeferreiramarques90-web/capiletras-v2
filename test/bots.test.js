import { compositionForHands } from './helpers/composition.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDictionary, normalizeWord } from '../bots/dictionary.js';
import { loadDictionary } from '../bots/load-dictionary.js';
import { BOT_RULES } from '../bots/config.js';
import { addBot, removeBot } from '../bots/players.js';
import { botTask, decideBotAction, chooseTurnAction } from '../bots/brain.js';
import { applyBotAction } from '../bots/actions.js';
import { createRoom, joinRoom, startGame, createDeck, roomView, playCard, drawCard, skipTurn,
  disconnectPlayer, shouldDeleteRoom, updateSettings } from '../game/game.js';
import { startChallenge, confirmChallenge, voteChallenge, loseChallenge, resolveChallenge } from '../game/challenge.js';
import { acceptVictory, resolvePendingVictory } from '../game/victory.js';
import { DECK_SIZE, CARD_TYPES, RULES, deckSize } from '../game/config.js';

const dictionary = createDictionary(['casa', 'casas', 'casca', 'canto', 'cantamos', 'cantaram', 'bola', 'bolas', 'bacana', 'abacate', 'capivara', 'futebol', 'zebra']);
const now = 100_000;
const rng = () => 0.99;
const lobby = () => createRoom({ code: 'ABC234', playerId: 'h', sessionId: 'human-session', name: 'Ana', now });
function fixture(ids = ['wild-0', 'letra-Z'], { word = 'CA', blockedLetter = null, owed = 0, ...game } = {}) {
  let room = addBot(addBot(lobby(), 'h', 'b1'), 'h', 'b2');
  room = startGame(room, 'h', () => 0.375);
  room.settings.deckComposition = compositionForHands([ids]);
  const cards = createDeck(room.settings.deckComposition), used = new Set(ids);
  const spare = cards.filter((c) => !used.has(c.id));
  room.players[1].hand = ids.map((id) => cards.find((c) => c.id === id));
  room.players[0].hand = spare.splice(0, 3);
  room.players[2].hand = spare.splice(0, 3);
  Object.assign(room.game, { deck: spare, discard: [], word, blockedLetter, lastPlayerId: 'h', lastLetterPlayerId: 'h',
    letterPlayNumber: 1, turnPlayerId: 'b1', letterDebt: { count: owed, playerId: owed ? 'b1' : null }, ...game });
  return room;
}
const view = (room, id = 'b1') => roomView(room, id);
const decide = (room, id = 'b1', random = rng) => decideBotAction(view(room, id), dictionary, random);
const apply = (room, action, id = 'b1') => applyBotAction(room, id, action, { version: room.game.version, now, rng });
const rejectedWithoutChange = (room, fn, pattern) => { const before = structuredClone(room); assert.throws(fn, pattern); assert.deepEqual(room, before); };

test('dicionário normaliza acentos/cedilha, remove entradas inválidas e inclui conjugações livres', () => {
  assert.equal(normalizeWord('  ação  '), 'ACAO');
  const d = createDictionary(['ação', 'AÇÃO', 'a', 'eu', 'guarda-chuva', 'casa2', 'jogávamos']);
  assert.equal(d.size, 2);
  assert.equal(d.hasPrefix('AC'), true);
  assert.equal(d.isWord('ACAO'), true);
  assert.equal(d.isWord('AC'), false);
  assert.equal(d.hasPrefix('!'), false);
  const full = loadDictionary();
  assert.ok(full.size > 300_000);
  for (const word of ['CAPIVARA', 'ACAO', 'JOGAMOS', 'JOGAVAMOS', 'CANTARAM']) assert.equal(full.isWord(word), true, word);
});

test('continuações incluem zero e respeitam o limite de 16 letras e os filtros', () => {
  const d = createDictionary(['CASA', 'CASAMENTO', `CA${'A'.repeat(16)}`, `CA${'B'.repeat(17)}`]);
  assert.ok(d.continuations('CASA').includes(''));
  assert.ok(d.continuations('CA').every((s) => s.length <= 16));
  assert.ok(d.continuations('CA').includes('A'.repeat(16)));
  assert.ok(!d.continuations('CA').includes('B'.repeat(17)));
  assert.ok(d.continuations('CA', {maxLetters: 99}).every((s) => s.length <= 16));
  assert.deepEqual(d.continuations('ZZ'), []);
  assert.deepEqual(d.extensions('CA', 1, { excludedFirst: 'S' }).sort(), ['A', 'B']);
});

test('lobby: só anfitrião humano gerencia bots, limite 8, nomes únicos e remoção', () => {
  let room = lobby();
  room = addBot(room, 'h', 'b1');
  rejectedWithoutChange(room, () => addBot(room, 'b1', 'bad'), /anfitrião/);
  for (let i = 2; i <= 7; i++) room = addBot(room, 'h', `b${i}`);
  assert.equal(room.players.length, 8);
  assert.equal(new Set(room.players.map((p) => p.name)).size, 8);
  assert.equal(room.settings.maxInitialCards, undefined);
  assert.ok(room.settings.initialCards <= Math.floor((deckSize(room.settings.deckComposition) - RULES.reservedDrawCards) / 8));
  rejectedWithoutChange(room, () => addBot(room, 'h', 'b8'), /8 jogadores/);
  rejectedWithoutChange(room, () => removeBot(room, 'h', 'h'), /não encontrado/);
  room = removeBot(room, 'h', 'b2');
  assert.equal(room.players.length, 7);
  assert.equal(room.hostId, 'h');
  const playing = startGame(room, 'h', rng);
  rejectedWithoutChange(playing, () => addBot(playing, 'h', 'b8'), /lobby/);
  assert.equal(DECK_SIZE, 76);
  assert.equal(createDeck().length, 76);
});

test('bot nunca vira anfitrião ou desconectado; salas sem humanos são removíveis', () => {
  let room = addBot(lobby(), 'h', 'b1');
  room = updateSettings(room, 'h', { playerCount: 3, initialCards: 3 });
  room = joinRoom(room, { playerId: 'h2', sessionId: 'human2', name: 'Bia' });
  room = disconnectPlayer(room, 'h', now, true);
  assert.equal(room.hostId, 'h2');
  assert.equal(room.players.find((p) => p.isBot).connected, true);
  rejectedWithoutChange(room, () => disconnectPlayer(room, 'b1', now), /Bots/);
  assert.equal(shouldDeleteRoom(disconnectPlayer(room, 'h2', now, true), now), true);
  const reserved = disconnectPlayer(addBot(lobby(), 'h', 'b1'), 'h', now);
  assert.equal(shouldDeleteRoom(reserved, now), false, 'queda de conexão reserva a vaga humana');
  const onlyBots = addBot(lobby(), 'h', 'b1'); onlyBots.players.shift(); onlyBots.hostId = 'b1';
  rejectedWithoutChange(onlyBots, () => startGame(onlyBots, 'b1', rng), /humano|anfitrião/);
});

for (const [cardId, word] of [['letra-S','CA'], ['wild-0','CA'], ['vowel-0','CAS'], ['consonant-0','CA'], ['first-0','BA'], ['last-0','CA'], ['life-0','CAS'], ['swap-0','CAX'], ['block-0','CA'], ['multi-0','CA']]) {
  test(`cérebro escolhe ${cardId} por prefixo, validado pela lógica humana`, () => {
    const room = fixture([cardId, 'letra-Z'], { word });
    const action = chooseTurnAction(view(room), dictionary);
    assert.equal(action.type, 'play'); assert.equal(action.cardId, cardId);
    const next = apply(room, action);
    assert.equal(dictionary.hasPrefix(next.game.word), true, next.game.word);
    assert.equal(next.players[1].hand.length, 1);
    if (cardId === 'life-0') assert.ok('AEIOU'.includes(action.letter));
    if (cardId === 'block-0') assert.equal(action.blockedLetter, dictionary.nextLetters(next.game.word)[0]);
  });
}

for (const cardId of ['pass-0', 'double-0']) {
  test(`${cardId} defensivo após a compra quando nenhuma letra preserva prefixo`, () => {
    const room = fixture([cardId, 'letra-Z'], { word: 'ZZZ' });
    assert.equal(chooseTurnAction(view(room), dictionary).type, 'draw');
    room.game.drawsThisTurn = 1;
    const action = chooseTurnAction(view(room),dictionary); assert.equal(action.cardId, cardId);
    assert.doesNotThrow(() => apply(room, action));
    const valid = fixture([cardId,'letra-Z'],{word:'CASA'});
    assert.equal(chooseTurnAction(view(valid),dictionary).cardId,cardId,'defesa mantém um prefixo válido sem comprar');
  });
}

test('bloqueio respeitado na carta, no 2+* e só na primeira acumulada', () => {
  for (const cardId of ['wild-0','block-0','multi-0']) {
    const room = fixture([cardId,'letra-Z'], { blockedLetter: 'S' });
    const action = decide(room); assert.notEqual(action.letter[0], 'S');
    assert.equal(dictionary.hasPrefix(apply(room, action).game.word), true);
  }
  const room = fixture(['letra-A','letra-Z'], { word: 'B', owed: 2, blockedLetter: 'A' });
  const action = decide(room);
  assert.equal(action.accumulatedLetters, 'OL'); assert.equal(action.letter, 'A');
  const next = apply(room, action); assert.equal(next.game.word, 'BOLA'); assert.equal(next.game.blockedLetter, null);
  const secondBlocked = fixture(['letra-S','letra-Z'], { word: 'B', owed: 3, blockedLetter: 'L' });
  const paid = decide(secondBlocked);
  assert.equal(paid.accumulatedLetters, 'OLA'); assert.equal(apply(secondBlocked, paid).game.word, 'BOLAS');
});

test('Troca com débito e visor vazio escolhe pagamento livre e substituição diferentes', () => {
  const room = fixture(['swap-0','letra-Z'], { word: '', owed: 1, blockedLetter: 'A' });
  const action = decide(room);
  assert.equal(action.type, 'play'); assert.equal(action.accumulatedLetters.length, 1);
  assert.notEqual(action.accumulatedLetters, action.letter);
  assert.notEqual(action.accumulatedLetters, 'A');
  assert.equal(dictionary.hasPrefix(apply(room, action).game.word), true);
});

for (const [cardId, owed, blocked] of [['wild-0',2,'A'],['vowel-0',2,'A'],['consonant-0',3,'S'],['first-0',2,'A'],['last-0',3,'S'],['life-0',2,'A'],['block-0',2,'A'],['multi-0',1,'L']]) {
  test(`${cardId} paga ${owed} letras e respeita o Bloqueio apenas no início do pagamento`, () => {
    const room=fixture([cardId,'letra-Z'],{word:'B',owed,blockedLetter:blocked});
    const action=chooseTurnAction(view(room),dictionary);
    assert.equal(action.type,'play');assert.equal(action.cardId,cardId);
    assert.equal(action.accumulatedLetters.length,owed);assert.notEqual(action.accumulatedLetters[0],blocked);
    assert.equal(dictionary.hasPrefix(apply(room,action).game.word),true);
  });
}

test('evita ficar recomprando e jogando a mesma Vida em blefes sem saída',()=>{
  const room=fixture(['letra-Z','life-0'],{word:'ZZZ',drawsThisTurn:1});
  const action=chooseTurnAction(view(room),dictionary);
  assert.equal(action.cardId,'letra-Z');
  assert.doesNotThrow(()=>apply(room,action));
});

test('última carta prefere palavra completa; segurança compra ou usa Não consigo jogar legalmente', () => {
  const room = fixture(['wild-0'], { word: 'CAS' });
  assert.equal(apply(room, decide(room)).game.word, 'CASA');
  const blocked = fixture(['swap-0','double-0'], { word: '', lastPlayerId: null });
  assert.equal(decide(blocked).type, 'draw');
  blocked.game.drawsThisTurn = 1;
  assert.equal(decide(blocked).type, 'skip');
  blocked.game.drawsThisTurn = 0; blocked.game.deck = []; blocked.game.discard = [];
  assert.equal(decide(blocked).type, 'skip');
  const safe = fixture(['letra-Z','pass-0'], { word: 'CASA', drawsThisTurn: 1 });
  assert.equal(chooseTurnAction(view(safe), dictionary, { safety: true }).cardId, 'pass-0');
});

test('dúvida: abaixo/acima da chance, um sorteio por bot/jogada, bots independentes', () => {
  const room = fixture(undefined, { word: 'ZZZ', turnPlayerId: 'h' });
  assert.equal(decide(room, 'b1', () => BOT_RULES.challengeChance - .001).type, 'challenge');
  let calls = 0;
  const no = decide(room, 'b1', () => { calls++; return BOT_RULES.challengeChance; });
  const marked = apply(room, no);
  assert.equal(decide(marked, 'b1', () => { calls++; return 0; }), null);
  assert.equal(calls, 1);
  assert.equal(decide(marked, 'b2', () => 0).type, 'challenge');
  marked.game.word = 'ZZZA'; marked.game.letterPlayNumber++;
  assert.equal(decide(marked, 'b1', () => 0).type, 'challenge');
  const valid = fixture(undefined, { word: 'CA', turnPlayerId: 'h' });
  assert.equal(decide(valid, 'b1', () => { throw Error('Não deve sortear'); }), null);
  for (const changes of [{letterDebt:{count:1,playerId:'h'}},{protectedPlayerId:'h'},{lastLetterPlayerId:'b1'},{word:''}]) {
    assert.equal(decide(Object.assign(structuredClone(room), { game: {...room.game,...changes} }), 'b1', () => {throw Error('Dúvida indisponível');}),null);
  }
});

test('vitória pendente: chance maior, suspeita sem sorteio favorável espera; prefixo válido aceita', () => {
  const room = fixture(undefined, { word:'ZZZ', turnPlayerId:'h' });
  room.game.pendingVictory = {id:7,playerId:'h',deadline:now+10_000,voterIds:['b1','b2'],acceptedIds:[]};
  assert.equal(decide(room, 'b1', () => .5).type, 'challenge');
  const marked = apply(room, decide(room, 'b1', () => .8));
  assert.equal(decide(marked), null);
  const valid = structuredClone(room); valid.game.word='CASA';
  assert.equal(decide(valid).type, 'accept');
});

test('jogada real com letra renova o sorteio; compra, Passar letra e 2x não renovam', () => {
  const initial=fixture(undefined,{word:'ZZZ',turnPlayerId:'h'});
  const marked=apply(initial,decide(initial));
  const next=playCard(marked,'h','letra-A');
  assert.equal(next.game.letterPlayNumber,2);
  assert.equal(decide(next,'b1',()=>0).type,'challenge');
  for(const cardId of ['pass-0','double-0']) {
    let room=fixture([cardId,'letra-Z'],{word:'ZZZ'});
    room=apply(room,decide(room));
    const bought=drawCard(room,'b1',rng);
    assert.equal(bought.game.letterPlayNumber,1);
    assert.equal(bought.game.botDecisions.b1,1);
    const played=playCard(bought,'b1',cardId);
    assert.equal(played.game.letterPlayNumber,1);
    assert.equal(decide(played,'b1',()=>{throw Error('Não repetir sorteio');}),null);
  }
});

test('bot desafiado completa, mostra prévia e confirma; palavra completa usa zero letras; blefe usa PERDI', () => {
  for (const word of ['CA','CASA','ZZZ']) {
    let room=fixture(undefined,{word,lastLetterPlayerId:'b1',turnPlayerId:'h'});
    room=startChallenge(room,'h',now);
    let action=decide(room);
    if(word==='ZZZ') {assert.equal(action.type,'lose'); assert.equal(apply(room,action).game.challenge,null);continue;}
    if(word==='CA'){assert.equal(action.type,'preview');room=apply(room,action);action=decide(room);}
    assert.equal(action.type,'confirm');
    room=apply(room,action);
    assert.equal(room.game.challenge.phase,'votando');
    assert.equal(dictionary.isWord(room.game.word),true);
  }
});

test('bots sempre aceitam Y humano (até o desafiante); contra bot votam conforme dicionário', () => {
  for(const y of ['h','b2'])for(const word of ['CASA','ZZZ']) {
    let room=fixture(undefined,{word,lastLetterPlayerId:y,turnPlayerId:'h'});
    room=startChallenge(room,'b1',now);
    room=confirmChallenge(room,y,room.game.challenge.id,'',now+100,rng);
    const d=y==='h'?{...dictionary,isWord(){throw Error('Não consultar dicionário para humano');}}:dictionary;
    const action=decideBotAction(view(room),d,rng);
    assert.equal(action.vote,y==='h'||word==='CASA'?'sim':'nao');
    assert.doesNotThrow(()=>apply(room,action));
  }
});

test('turno pausado não impede as respostas válidas de um desafio ou vitória pendente', () => {
  let room=fixture(undefined,{word:'CASA',turnPlayerId:'h'});
  room=startChallenge(room,'b1',now);
  room=confirmChallenge(room,'h',room.game.challenge.id,'',now+100,rng);
  const voting=view(room);voting.game.paused=true;
  assert.equal(decideBotAction(voting,dictionary,rng).type,'vote');
  const pending=fixture(undefined,{word:'CASA',turnPlayerId:'h'});
  pending.game.pendingVictory={id:7,playerId:'h',deadline:now+10_000,voterIds:['b1','b2'],acceptedIds:[]};
  const accepting=view(pending);accepting.game.paused=true;
  assert.equal(decideBotAction(accepting,dictionary,rng).type,'accept');
});

test('ação antiga ou inválida não muda o estado; cérebro recebe só mão própria e JSON não tem dicionário', () => {
  const room=fixture(); const before=structuredClone(room); const action=decide(room);
  assert.throws(()=>applyBotAction(room,'b1',action,{version:room.game.version-1,now,rng}),/antiga/);
  assert.throws(()=>apply(room,{type:'play',cardId:'inexistente'}),/mão/);
  assert.deepEqual(room,before);
  const privateView=view(room);
  privateView.players.forEach(p=>{Object.defineProperty(p,'hand',{get(){throw Error('Mão adversária acessada');}});});
  assert.equal(decideBotAction(privateView,dictionary,rng).type,'play');
  assert.deepEqual(JSON.parse(JSON.stringify(room)),room);
  assert.equal(JSON.stringify(room).includes('dictionary'),false);
  assert.ok(roomView(room,'h').players.every(p=>!Object.hasOwn(p,'hand')));
});

function executeHuman(room, action, clock, random) {
  switch(action.type){
    case 'play':return playCard(room,'h',action.cardId,action.letter,action.blockedLetter,action.accumulatedLetters,room.game.version,clock);
    case 'draw':return drawCard(room,'h',random);
    case 'skip':return skipTurn(room,'h',random);
  }
  throw Error(`Ação humana inesperada: ${action.type}`);
}

test('simulação: um humano e três bots terminam muitas partidas sem travar, conservando o total configurado', () => {
  let seed=123456;
  const random=()=>((seed=(1664525*seed+1013904223)>>>0)/2**32);
  let totalTurns=0;
  for(let match=0;match<16;match++) {
    let room=lobby();for(let i=1;i<=3;i++)room=addBot(room,'h',`b${i}`);
    room=updateSettings(room,'h',{playerCount:4,initialCards:3});
    room=startGame(room,'h',random);
    let clock=now;
    for(let step=0;step<6000&&room.phase==='playing';step++) {
      clock+=1000;
      room=resolvePendingVictory(resolveChallenge(room,clock,random),clock);
      if(room.phase!=='playing')break;
      const ch=room.game.challenge;
      if(ch?.challengedId==='h'&&ch.phase==='completando') {
        const [letters]=dictionary.continuations(ch.baseWord,{limit:1});
        room=letters===undefined?loseChallenge(room,'h',ch.id,clock,random):confirmChallenge(room,'h',ch.id,letters,clock,random);
      } else if(ch?.phase==='votando'&&ch.voterIds.includes('h')&&!Object.hasOwn(ch.votes,'h')) {
        room=voteChallenge(room,'h',ch.id,'sim',clock,random);
      } else if(!ch&&room.game.pendingVictory?.voterIds.includes('h')&&!room.game.pendingVictory.acceptedIds.includes('h')) {
        room=acceptVictory(room,'h',room.game.pendingVictory.id,clock);
      } else if(!ch&&!room.game.pendingVictory&&room.game.turnPlayerId==='h') {
        const action=chooseTurnAction(roomView(room,'h'),dictionary);
        assert.ok(action); room=executeHuman(room,action,clock,random);
      }
      for(const id of ['b1','b2','b3']) {
        if(room.phase!=='playing')break;
        const action=decideBotAction(roomView(room,id),dictionary,random);
        if(action)room=applyBotAction(room,id,action,{version:room.game.version,now:clock,rng:random});
      }
      assert.equal(room.players.reduce((n,p)=>n+p.hand.length,0)+room.game.deck.length+room.game.discard.length,deckSize(room.settings.deckComposition));
    }
    assert.equal(room.phase,'finished',`partida ${match}: ${JSON.stringify({turn:room.game.turnNumber,word:room.game.word,ch:room.game.challenge,pending:room.game.pendingVictory,hands:room.players.map(p=>[p.id,p.hand.length])})}`);
    totalTurns+=room.game.turnNumber;
  }
  assert.ok(totalTurns>100);
});
