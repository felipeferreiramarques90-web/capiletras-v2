import { compositionForHands } from './helpers/composition.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_TYPES, DECK_SIZE, maxInitialCards } from '../game/config.js';
import {
  createDeck, createRoom, joinRoom, startGame, updateSettings, playCard, drawCard,
  skipTurn, canSkipTurn, roomView, isCardPlayable, disconnectPlayer,
} from '../game/game.js';

const random = () => 0.25;
function fixture({ hands = [['life-0', 'letra-B', 'letra-E'], ['double-0', 'letra-C', 'letra-D']], word = '', blockedLetter = null } = {}) {
  let room = createRoom({ code: 'ABC234', playerId: 'p1', sessionId: 's1', name: 'Ana', now: 1000 });
  room = updateSettings(room, 'p1', { playerCount: hands.length, initialCards: 3 });
  for (let i = 1; i < hands.length; i++) room = joinRoom(room, { playerId: `p${i + 1}`, sessionId: `s${i + 1}`, name: `Pessoa ${i + 1}` });
  room = startGame(room, 'p1', random);
  room.settings.deckComposition = compositionForHands(hands);
  const cards = createDeck(room.settings.deckComposition);
  const used = new Set(hands.flat());
  room.players.forEach((player, i) => { player.hand = hands[i].map((id) => cards.find((card) => card.id === id)); });
  Object.assign(room.game, { word, blockedLetter, deck: cards.filter((card) => !used.has(card.id)) });
  return room;
}
const playLife = (room, letter = 'A') => playCard(room, 'p1', 'life-0', letter);

test('Vida é opcional: zero no padrão de 76 cartas e disponível por composição personalizada', () => {
  assert.equal(CARD_TYPES.life.quantity, 0);
  assert.equal(DECK_SIZE, 76);
  assert.equal(createDeck().length, DECK_SIZE);
  assert.equal(new Set(createDeck().map((card) => card.id)).size, DECK_SIZE);
  assert.equal(createDeck().filter((card) => card.type === 'life').length, 0);
  const customized = createDeck(compositionForHands([['life-0', 'life-1']]));
  assert.equal(customized.filter((card) => card.type === 'life').length, 2);
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8].map((players) => maxInitialCards(players)), [37, 25, 18, 15, 12, 10, 9]);
});

test('Vida adiciona uma vogal, inclusive com visor vazio, e publica o aviso', () => {
  for (const word of ['', 'CAS']) {
    const original = fixture({ word });
    const room = playLife(original, 'a');
    assert.equal(room.game.word, word + 'A');
    assert.equal(room.game.turnPlayerId, 'p2');
    assert.equal(room.players[0].hand.length, 2);
    assert.equal(room.game.protectedPlayerId, 'p1');
    assert.match(room.notice, /Ana jogou Vida ❤️/);
    assert.equal(original.game.protectedPlayerId, null);
  }
});

test('Vida permanece jogável com qualquer Bloqueio, desabilita sua letra e o consome', () => {
  for (const blockedLetter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const room = fixture({ blockedLetter });
    const card = room.players[0].hand[0];
    assert.equal(isCardPlayable(card, room.game), true);
    assert.ok(roomView(room, 'p1').game.playableCardIds.includes(card.id));
    assert.ok(!roomView(room, 'p1').game.allowedLettersByCard[card.id].includes(blockedLetter));
    const before = structuredClone(room);
    assert.throws(() => playLife(room, blockedLetter), /permitida/);
    assert.deepEqual(room, before);
    const choices = roomView(room, 'p1').game.allowedLettersByCard[card.id];
    const expected = [...'AEIOU'].filter((letter) => letter !== blockedLetter).join('');
    assert.equal(choices, expected);
    assert.ok(choices.length >= 4);
    const next = playLife(room, choices[0]);
    assert.equal(next.game.blockedLetter, null);
    assert.equal(next.game.protectedPlayerId, 'p1');
  }
});

test('cada vogal é aceita na Vida, inclusive em minúsculas', () => {
  for (const letter of 'AEIOUaeiou') {
    const room = playLife(fixture({ word: 'CAS' }), letter);
    assert.equal(room.game.word, 'CAS' + letter.toUpperCase());
    assert.equal(room.game.protectedPlayerId, 'p1');
  }
});

test('servidor rejeita qualquer consoante na Vida sem alterar o estado', () => {
  for (const letter of 'BCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz') {
    const room = fixture();
    const before = structuredClone(room);
    assert.throws(() => playLife(room, letter), /permitida/);
    assert.deepEqual(room, before);
  }
});

test('vogal bloqueada deixa exatamente quatro opções no modal da Vida', () => {
  for (const blockedLetter of 'AEIOU') {
    const room = fixture({ blockedLetter });
    const choices = roomView(room, 'p1').game.allowedLettersByCard['life-0'];
    assert.equal(choices, [...'AEIOU'].filter((letter) => letter !== blockedLetter).join(''));
    assert.equal(choices.length, 4);
    const next = playLife(room, choices[0]);
    assert.equal(next.game.blockedLetter, null);
  }
});

test('consoante bloqueada não afeta as cinco vogais e a Vida ainda consome o bloqueio', () => {
  for (const blockedLetter of 'BCDFGHJKLMNPQRSTVWXYZ') {
    const room = fixture({ blockedLetter });
    assert.equal(roomView(room, 'p1').game.allowedLettersByCard['life-0'], 'AEIOU');
    const next = playLife(room, 'E');
    assert.equal(next.game.blockedLetter, null);
    assert.equal(next.game.word, 'E');
  }
});

test('jogada inválida do próximo não encerra a proteção', () => {
  const room = playLife(fixture({ hands: [['life-0', 'letra-B'], ['life-1', 'letra-C']] }));
  const before = structuredClone(room);
  assert.throws(() => playCard(room, 'p2', 'life-1', 'AB'), /permitida/);
  assert.deepEqual(room, before);
  assert.equal(room.game.protectedPlayerId, 'p1');
});

test('outra Vida encerra a marca anterior e protege apenas seu novo autor', () => {
  let room = playLife(fixture({ hands: [['life-0', 'letra-B'], ['life-1', 'letra-C']] }));
  room = playCard(room, 'p2', 'life-1', 'O');
  assert.equal(room.game.protectedPlayerId, 'p2');
  assert.equal(roomView(room, 'p2').game.canSkipTurn, false);
  room = playCard(room, 'p1', 'letra-B');
  assert.equal(room.game.protectedPlayerId, null);
});

test('Vida seguida de 2x encerra a proteção antes do turno forçado', () => {
  let room = playLife(fixture());
  room = playCard(room, 'p2', 'double-0');
  assert.equal(room.game.protectedPlayerId, null);
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.deepEqual(room.game.extraTurns, ['p2']);
  assert.equal(canSkipTurn(room, 'p2'), false);
  room = playCard(room, 'p1', 'letra-B');
  assert.equal(canSkipTurn(room, 'p1'), false);
});

test('Vida não interfere em Não consigo jogar do jogador da vez', () => {
  // Estado explícito da condição de exceção: só o autor da Vida é protegido.
  const room = fixture({ hands: [['letra-B'], ['letra-A']], word: 'CAS', blockedLetter: 'A' });
  Object.assign(room.game, { lastPlayerId: 'p1', protectedPlayerId: 'p1', turnPlayerId: 'p2', drawsThisTurn: 1 });
  assert.equal(canSkipTurn(room, 'p1'), false);
  assert.equal(canSkipTurn(room, 'p2'), true);
  const next = skipTurn(room, 'p2', random);
  assert.equal(next.players[1].hand.length, 5);
  assert.equal(next.game.word, '');
  assert.equal(next.game.blockedLetter, null);
  assert.equal(next.game.turnPlayerId, 'p1');
  assert.equal(next.game.protectedPlayerId, null);
});

test('ao voltar a vez do autor, proteção termina mesmo sem uma carta intermediária', () => {
  const room = fixture({ hands: [['swap-0'], ['swap-1']] });
  Object.assign(room.game, { lastPlayerId: 'p1', protectedPlayerId: 'p1', turnPlayerId: 'p2', deck: [], discard: [] });
  const next = skipTurn(room, 'p2', random);
  assert.equal(next.game.turnPlayerId, 'p1');
  assert.equal(next.game.protectedPlayerId, null);
  assert.equal(roomView(next, 'p1').game.noPlayableCards, true);
  assert.equal(canSkipTurn(next, 'p1'), true);
  assert.doesNotThrow(() => skipTurn(next, 'p1', random));
});

test('quando a vez volta normalmente, Não consigo jogar está disponível sem carta jogável', () => {
  let room = playLife(fixture({ hands: [['life-0', 'letra-A'], ['letra-B', 'letra-C'], ['block-0', 'letra-D']] }));
  room = playCard(room, 'p2', 'letra-B');
  room = playCard(room, 'p3', 'block-0', 'X', 'A');
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.equal(room.game.protectedPlayerId, null);
  assert.equal(canSkipTurn(room, 'p1'), false, 'novo turno exige nova compra');
});

test('Vida como última carta vence normalmente', () => {
  const room = playLife(fixture({ hands: [['life-0'], ['letra-B', 'letra-C']] }));
  assert.equal(room.phase, 'finished');
  assert.equal(room.game.winnerId, 'p1');
  assert.equal(room.players[0].hand.length, 0);
  assert.equal(canSkipTurn(room, 'p1'), false);
  assert.throws(() => skipTurn(room, 'p1', random), /andamento/);
});

test('a proteção é JSON serializável, sobrevive à reconexão e não expõe mãos', () => {
  let room = playLife(fixture());
  room = disconnectPlayer(room, 'p1', 2000);
  room = joinRoom(JSON.parse(JSON.stringify(room)), { playerId: 'outro-id', sessionId: 's1', name: 'Ana' });
  assert.equal(room.game.protectedPlayerId, 'p1');
  const view = roomView(room, 'p1');
  assert.equal(view.game.protectedPlayerId, 'p1');
  assert.equal(view.game.canSkipTurn, false);
  assert.ok(view.players.every((p) => !p.hand && !p.sessionId));
  assert.deepEqual(JSON.parse(JSON.stringify(room)), room);
});
