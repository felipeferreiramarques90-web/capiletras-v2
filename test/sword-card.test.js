import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_TYPES, DEFAULT_DECK_COMPOSITION, DECK_SIZE, RULES, maxInitialCards } from '../game/config.js';
import { createRoom, updateSettings, updateDeckComposition, restoreDefaultComposition, createDeck, joinRoom, startGame,
  playCard, drawCard, skipTurn, canPlaySword, roomView, isCardPlayable } from '../game/game.js';
import { startChallenge, loseChallenge, confirmChallenge, voteChallenge } from '../game/challenge.js';
import { resolvePendingVictory } from '../game/victory.js';
import { compositionForHands } from './helpers/composition.js';

const rng = () => .375, now = 100000;
function fixture(hands = [['wild-0', 'letra-A', 'double-0'], ['sword-0', 'sword-1', 'letra-B'], ['sword-2', 'letra-C', 'letra-D']], game = {}) {
  let room = createRoom({ code: 'ABC234', playerId: 'p1', sessionId: 's1', name: 'Ana', now });
  room = updateSettings(room, 'p1', { playerCount: hands.length, initialCards: 3 });
  room = updateDeckComposition(room, 'p1', compositionForHands(hands));
  for (let i = 1; i < hands.length; i++) room = joinRoom(room, { playerId: `p${i+1}`, sessionId: `s${i+1}`, name: ['Ana','Bia','Caio','Dani'][i] });
  room = startGame(room, 'p1', rng);
  const cards = createDeck(room.settings.deckComposition), used = new Set(hands.flat());
  room.players.forEach((p,i) => { p.hand = hands[i].map((id) => cards.find((card) => card.id === id)); });
  Object.assign(room.game, { deck: cards.filter((card) => !used.has(card.id)), word: 'CA', lastPlayerId: null, lastLetterPlayerId: 'p1', ...game });
  return room;
}
const cast = (room, id = 'p2', card = 'sword-0', letter = 'S', version = room.game.version) => playCard(room, id, card, letter, undefined, '', version, now);
function unchanged(room, operation, pattern) { const before = structuredClone(room); assert.throws(operation, pattern); assert.deepEqual(room,before); }

test('espada: quatro no padrão de 76, máximo inicial recalculado, zero e restauração', () => {
  assert.equal(CARD_TYPES.sword.quantity, 4);
  assert.equal(DECK_SIZE, 76);
  assert.equal(createDeck().filter((c) => c.type === 'sword').length, 4);
  assert.deepEqual([2,3,4,5,6,7,8].map((n) => maxInitialCards(n)), [37,25,18,15,12,10,9]);
  let lobby = createRoom({ code:'ABC234', playerId:'p1', sessionId:'s1', name:'Ana', now });
  lobby = updateDeckComposition(lobby,'p1',{...DEFAULT_DECK_COMPOSITION,sword:0});
  assert.equal(roomView(lobby,'p1').deckSize,72);
  assert.ok(createDeck(lobby.settings.deckComposition).every((c) => c.type !== 'sword'));
  lobby = restoreDefaultComposition(lobby,'p1');
  assert.equal(lobby.settings.deckComposition.sword,4);
  assert.equal(roomView(lobby,'p1').deckSize,76);
  for (const value of [-1,31,1.5,'4']) unchanged(lobby,() => updateDeckComposition(lobby,'p1',{...DEFAULT_DECK_COMPOSITION,sword:value}));
  assert.deepEqual(JSON.parse(JSON.stringify(lobby)),lobby);
});

test('espada fora da vez aplica letra, muda autor e preserva vez, compra, turno e retornos', () => {
  const original = fixture(undefined,{ drawsThisTurn:1, extraTurns:['p3'] });
  assert.equal(canPlaySword(original,'p2'),true);
  assert.ok(roomView(original,'p2').game.playableCardIds.includes('sword-0'));
  const room = cast(original);
  assert.equal(room.game.word,'CAS');
  assert.equal(room.game.turnPlayerId, original.game.turnPlayerId);
  assert.equal(room.game.turnNumber, original.game.turnNumber);
  assert.equal(room.game.drawsThisTurn,1);
  assert.deepEqual(room.game.extraTurns,['p3']);
  assert.equal(room.game.lastPlayerId,'p2'); assert.equal(room.game.lastLetterPlayerId,'p2');
  assert.equal(room.game.playNumber,1);
  assert.equal(room.game.letterPlayNumber,1);
  assert.equal(room.players[1].hand.length,2);
  assert.match(room.notice,/Bia jogou na vez de Ana ⚔️/);
  assert.equal(startChallenge(room,'p3',now).game.challenge.challengedId,'p2');
});

test('carta fica indisponível na própria vez, inclusive forçada por 2x; sozinha não impede Não consigo jogar', () => {
  let room = fixture([['sword-0'],['double-0','letra-B'],['sword-1','letra-C']],{ lastPlayerId:'p1', turnPlayerId:'p2' });
  room = playCard(room,'p2','double-0');
  assert.equal(room.game.turnPlayerId,'p1');
  assert.equal(canPlaySword(room,'p1'),false);
  assert.equal(isCardPlayable(room.players[0].hand[0],room.game,'p1'),false);
  unchanged(room,() => cast(room,'p1'),/não pode/);
  assert.equal(roomView(room,'p1').game.canSkipTurn,false);
  room = drawCard(room,'p1',rng);
  // Testa a habilitação com a compra já realizada e somente a espada na mão.
  room.players[0].hand = room.players[0].hand.filter((c) => c.type === 'sword');
  assert.equal(roomView(room,'p1').game.canSkipTurn,true);
  assert.doesNotThrow(() => skipTurn(room,'p1',rng));
});

for (const [card,letter,blocked] of [['letra-B'],['wild-1','S'],['vowel-0','A'],['consonant-0','S'],['first-0','A'],['last-0','S'],['swap-0','S'],['block-0','S','X'],['life-0','A'],['multi-0','SA'],['pass-0'],['double-1']]) {
  test(`última jogada ${card} impede espada do mesmo jogador`, () => {
    let room = fixture([['letra-A','letra-D'],[card,'sword-0','letra-E'],['sword-2','letra-C']],{ turnPlayerId:'p2',lastPlayerId:'p1' });
    room = playCard(room,'p2',card,letter,blocked);
    assert.equal(room.game.lastPlayerId,'p2'); assert.equal(canPlaySword(room,'p2'),false);
    unchanged(room,() => cast(room),/não pode/);
  });
}

test('não usa duas espadas seguidas; libera depois que outro jogador joga, sem passar a vez', () => {
  let room = cast(fixture());
  unchanged(room,() => cast(room,'p2','sword-1'),/não pode/);
  room = cast(room,'p3','sword-2','A');
  assert.equal(canPlaySword(room,'p2'),true);
  room = cast(room,'p2','sword-1','S');
  assert.equal(room.game.word,'CASAS'); assert.equal(room.game.turnPlayerId,'p1');
});

test('qualquer débito, desafio, vitória pendente ou fim bloqueia a espada sem mutação', () => {
  const debt = fixture(undefined,{ letterDebt:{count:2,playerId:'p3'} });
  const challenge = startChallenge(fixture(),'p3',now);
  const pending = playCard(fixture([['letra-A'],['sword-0','letra-B'],['letra-C','letra-D']]),'p1','letra-A',undefined,undefined,'',0,now);
  const finished = resolvePendingVictory(pending,now+RULES.victoryWindowMs);
  for (const room of [debt,challenge,pending,finished]) {
    assert.equal(canPlaySword(room,'p2'),false);
    assert.ok(!roomView(room,'p2').game.playableCardIds.includes('sword-0'));
    unchanged(room,() => cast(room));
  }
});

test('bloqueio proíbe sua letra e é consumido; entradas fora de A a Z ou cartas alheias são rejeitadas', () => {
  const room = fixture(undefined,{ blockedLetter:'S' });
  const choices = roomView(room,'p2').game.allowedLettersByCard['sword-0'];
  assert.equal(choices.length,25); assert.ok(!choices.includes('S'));
  assert.equal(canPlaySword(room,'p2'),true);
  for (const value of ['S','s','','AB','Á','ı','1',' ','*',null,undefined]) unchanged(room,() => cast(room,'p2','sword-0',value));
  unchanged(room,() => cast(room,'p2','sword-2','A'),/mão/);
  const next = cast(room,'p2','sword-0','a');
  assert.equal(next.game.word,'CAA'); assert.equal(next.game.blockedLetter,null);
});

test('interromper uma escolha antiga não baixa a carta do dono da vez e preserva a compra', () => {
  const original = fixture(undefined,{ drawsThisTurn:1 });
  const room = cast(original);
  unchanged(room,() => playCard(room,'p1','wild-0','A',undefined,'',original.game.version,now),/mesa mudou/);
  assert.deepEqual(room.players[0].hand,original.players[0].hand);
  assert.equal(room.game.drawsThisTurn,1);
  const next = playCard(room,'p1','wild-0','A',undefined,'',room.game.version,now);
  assert.equal(next.game.word,'CASA');
});

test('espada no meio do 2x mantém alvo e retorno; 2x depois da espada chama seu autor', () => {
  let room = fixture(undefined,{ turnPlayerId:'p3',lastPlayerId:'p1' });
  room.players[2].hand.push(room.game.deck.splice(room.game.deck.findIndex((c) => c.id === 'double-1'),1)[0]);
  room = playCard(room,'p3','double-1');
  assert.equal(room.game.turnPlayerId,'p1'); assert.deepEqual(room.game.extraTurns,['p3']);
  room = cast(room);
  assert.equal(room.game.turnPlayerId,'p1'); assert.deepEqual(room.game.extraTurns,['p3']);
  room = playCard(room,'p1','letra-A');
  assert.equal(room.game.turnPlayerId,'p3');
  // Outra partida: não há jogada entre espada e 2x.
  room = cast(fixture());
  room = playCard(room,'p1','double-0');
  assert.equal(room.game.turnPlayerId,'p2'); assert.deepEqual(room.game.extraTurns,['p1']);
  room = playCard(room,'p2','letra-B');
  assert.equal(room.game.turnPlayerId,'p1');
});

test('2x após outra carta chama o autor dessa carta; espada encerra proteção da Vida', () => {
  let room = fixture([['life-0','double-0','letra-A'],['sword-0','letra-B'],['letra-C','letra-D']]);
  room = playCard(room,'p1','life-0','A');
  assert.equal(room.game.protectedPlayerId,'p1');
  // Bia é a da vez; Caio recebe uma espada para interromper.
  room.players[2].hand.push(room.game.deck.splice(room.game.deck.findIndex((c) => c.id === 'sword-1'),1)[0]);
  room = cast(room,'p3','sword-1','S');
  assert.equal(room.game.protectedPlayerId,null);
  assert.equal(startChallenge(room,'p1',now).game.challenge.challengedId,'p3');
  room = playCard(room,'p2','letra-B'); // última de Bia? a espada continua na mão.
  room = playCard(room,'p3','letra-C');
  room = playCard(room,'p1','double-0');
  assert.equal(room.game.turnPlayerId,'p3');
});

test('última espada abre janela de dúvida; aceitação vence e recusa/PERDI preservam a vez já em curso', () => {
  const base = fixture([['letra-A','wild-0'],['sword-0'],['letra-C','letra-D']],{ drawsThisTurn:1,extraTurns:['p3'] });
  const pending = cast(base);
  assert.equal(pending.phase,'playing'); assert.equal(pending.game.pendingVictory.playerId,'p2');
  assert.equal(pending.game.pendingVictory.deadline,now+RULES.victoryWindowMs);
  assert.equal(resolvePendingVictory(pending,now+RULES.victoryWindowMs).game.winnerId,'p2');
  const challenge = startChallenge(pending,'p3',now);
  const lost = loseChallenge(challenge,'p2',challenge.game.challenge.id,now,rng);
  assert.equal(lost.players[1].hand.length,4); assert.equal(lost.game.pendingVictory,null);
  assert.equal(lost.game.turnPlayerId,'p1'); assert.equal(lost.game.drawsThisTurn,1);
  assert.deepEqual(lost.game.extraTurns,['p3']); assert.equal(lost.game.word,'');
  for (const vote of ['sim','nao']) {
    let room = confirmChallenge(challenge,'p2',challenge.game.challenge.id,'A',now,rng);
    room = voteChallenge(room,'p1',room.game.challenge.id,vote,now,rng);
    if (room.game.challenge) room = voteChallenge(room,'p3',room.game.challenge.id,vote,now,rng);
    assert.equal(room.phase, vote === 'sim' ? 'finished' : 'playing');
    assert.equal(room.game.turnPlayerId,'p1');
    if (vote === 'sim') assert.equal(room.game.winnerId,'p2');
    else assert.equal(room.players[1].hand.length,4);
  }
});

test('corrida entre duas espadas e entre espada e carta normal aceita apenas a primeira versão válida', () => {
  const original = fixture(), version = original.game.version;
  const first = cast(original);
  unchanged(first,() => cast(first,'p3','sword-2','A',version),/mesa mudou/);
  unchanged(first,() => playCard(first,'p1','letra-A',undefined,undefined,'',version,now),/mesa mudou/);
  const normal = playCard(original,'p1','letra-A',undefined,undefined,'',version,now);
  unchanged(normal,() => cast(normal,'p3','sword-2','A',version),/mesa mudou/);
});

test('reset do desafio e Não consigo jogar limpam último jogador e liberam espada fora da vez', () => {
  let room = cast(fixture());
  room = startChallenge(room,'p3',now);
  room = loseChallenge(room,'p2',room.game.challenge.id,now,rng);
  assert.equal(room.game.lastPlayerId,null); assert.equal(canPlaySword(room,'p2'),true);
  room = fixture([['sword-0'],['letra-B'],['letra-C']],{ lastPlayerId:'p1',drawsThisTurn:1 });
  room = skipTurn(room,'p1',rng);
  assert.equal(room.game.lastPlayerId,null); assert.equal(room.game.turnPlayerId,'p2');
  assert.equal(canPlaySword(room,'p1'),true);
  assert.deepEqual(JSON.parse(JSON.stringify(room)),room);
});


test('primeira espada pode colocar a primeira letra; composições salvas antes dela continuam válidas', () => {
  const room = fixture(undefined,{word:'',lastPlayerId:null,lastLetterPlayerId:null});
  assert.equal(cast(room).game.word,'S');
  let old = createRoom({code:'ABC234',playerId:'p1',sessionId:'s1',name:'Ana',now});
  delete old.settings.deckComposition.sword;
  assert.equal(roomView(old,'p1').deckSize,72);
  assert.equal(roomView(old,'p1').settings.deckComposition.sword,0);
  old = joinRoom(old,{playerId:'p2',sessionId:'s2',name:'Bia'});
  const playing = startGame(old,'p1',rng);
  assert.ok([...playing.game.deck,...playing.players.flatMap((p) => p.hand)].every((card) => card.type !== 'sword'));
  assert.equal(restoreDefaultComposition({...old,phase:'lobby'},'p1').settings.deckComposition.sword,4);
});
