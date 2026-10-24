import test from 'node:test';
import { resolvePendingVictory } from '../game/victory.js';
import assert from 'node:assert/strict';
import { CARD_TYPES, DECK_SIZE, maxInitialCards } from '../game/config.js';
import {
  createDeck, createRoom, joinRoom, updateSettings, startGame, playCard, drawCard,
  skipTurn, roomView, isCardPlayable, canSkipTurn,
} from '../game/game.js';

const random = () => 0.25;
function fixture({ hand = ['multi-0', 'letra-B', 'letra-E'], blockedLetter = null, word = 'CAS', last = true } = {}) {
  let room = createRoom({ code: 'ABC234', playerId: 'p1', sessionId: 's1', name: 'Ana', now: 1000 });
  room = joinRoom(room, { playerId: 'p2', sessionId: 's2', name: 'Bia' });
  room = startGame(room, 'p1', random);
  const cards = createDeck();
  const hands = [hand, ['double-0', 'letra-C', 'letra-D']];
  const used = new Set(hands.flat());
  room.players.forEach((p, i) => { p.hand = hands[i].map((id) => cards.find((card) => card.id === id)); });
  Object.assign(room.game, { deck: cards.filter((card) => !used.has(card.id)), word, blockedLetter, lastPlayerId: last ? 'p2' : null });
  return room;
}
const playMulti = (room, letters) => playCard(room, 'p1', 'multi-0', letters);

test('composição soma 72, com quatro 2+* e os demais tipos configurados', () => {
  const expected = { letter: 26, wild: 12, vowel: 1, consonant: 1, first: 1, last: 1, swap: 6, block: 6, double: 6, multi: 4, life: 0, pass: 8 };
  assert.deepEqual(Object.fromEntries(Object.entries(CARD_TYPES).map(([type, rule]) => [type, rule.quantity])), expected);
  assert.equal(Object.values(expected).reduce((sum, count) => sum + count, 0), 72);
  assert.equal(DECK_SIZE, 72);
  const deck = createDeck();
  assert.equal(deck.length, 72);
  assert.equal(new Set(deck.map((card) => card.id)).size, 72);
  assert.equal(deck.filter((card) => card.type === 'multi').length, 4);
  assert.equal(CARD_TYPES.multi.minLetters, 2);
  assert.equal(CARD_TYPES.multi.maxLetters, 16);
});

test('máximo inicial com 72 cartas é recalculado para todas as quantidades de jogadores', () => {
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8].map((players) => maxInitialCards(players)), [35, 23, 17, 14, 11, 10, 8]);
  let room = createRoom({ code: 'ABC234', playerId: 'p1', sessionId: 's1', name: 'Ana', now: 1000 });
  room = updateSettings(room, 'p1', { playerCount: 2, initialCards: 35 });
  room = joinRoom(room, { playerId: 'p2', sessionId: 's2', name: 'Bia' });
  room = startGame(room, 'p1', random);
  assert.equal(room.players[0].hand.length, 35);
  assert.equal(room.players[1].hand.length, 35);
  assert.equal(room.game.deck.length, 2);
  assert.equal(roomView(room, 'p1').settings.maxInitialCards, 35);
});

test('2+* aceita os limites mínimo e máximo, preserva ordem e normaliza para maiúsculas', () => {
  for (const input of ['ab', 'abcdefghijklmnop', 'mIxTuRa']) {
    const original = fixture();
    const before = structuredClone(original);
    const room = playMulti(original, input);
    assert.equal(room.game.word, 'CAS' + input.toUpperCase());
    assert.equal(room.players[0].hand.length, 2, 'baixa só uma carta');
    assert.equal(room.game.turnPlayerId, 'p2');
    assert.equal(room.game.lastPlayerId, 'p1');
    assert.match(room.notice, /2\+\*/);
    assert.deepEqual(original, before);
  }
});

test('2+* rejeita menos de duas ou mais de dezesseis letras sem alterar o estado', () => {
  for (const input of ['', 'a', 'A'.repeat(17)]) {
    const room = fixture();
    const before = structuredClone(room);
    assert.throws(() => playMulti(room, input));
    assert.deepEqual(room, before);
  }
});

test('servidor rejeita espaços, números, acentos, símbolos e expansões Unicode', () => {
  for (const input of [' AB', 'AB ', 'a b', 'A1', 'A*', 'A_B', 'ÁB', 'abç', 'A\u0301B', 'AB\n', 'AB\r', 'AB\t', 'AB\u00a0', 'A\0B', 'ß', 'ﬀ', 'ＡＢ', 'A😀B', undefined, null, 12, ['A', 'B'], {}]) {
    const room = fixture();
    const before = structuredClone(room);
    assert.throws(() => playMulti(room, input), /somente letras/);
    assert.deepEqual(room, before);
  }
});

test('Bloqueio impede apenas a primeira letra, inclusive se ela chegou em minúsculas', () => {
  for (const input of ['ab', 'AAB']) {
    const room = fixture({ blockedLetter: 'A' });
    const before = structuredClone(room);
    assert.throws(() => playMulti(room, input), /primeira letra não pode ser A/);
    assert.deepEqual(room, before);
  }
});

test('letra bloqueada é permitida da segunda posição em diante e a 2+* consome o Bloqueio', () => {
  for (const input of ['ba', 'bAaA', 'bcda']) {
    const room = playMulti(fixture({ blockedLetter: 'A' }), input);
    assert.equal(room.game.word, 'CAS' + input.toUpperCase());
    assert.equal(room.game.blockedLetter, null);
  }
});

test('2+* é jogável com visor vazio, sem jogada anterior e sob qualquer letra bloqueada', () => {
  for (const blockedLetter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const room = fixture({ hand: ['multi-0'], word: '', last: false, blockedLetter });
    const view = roomView(room, 'p1');
    assert.equal(isCardPlayable(room.players[0].hand[0], room.game), true);
    assert.equal(view.game.noPlayableCards, false);
    assert.equal(view.game.canSkipTurn, false);
    assert.ok(view.game.playableCardIds.includes('multi-0'));
  }
});

test('2+* como última carta vence normalmente e impede Não consigo jogar posterior', () => {
  const room = resolvePendingVictory(playMulti(fixture({ hand: ['multi-0'] }), 'AR'), 10_000);
  assert.equal(room.phase, 'finished');
  assert.equal(room.game.winnerId, 'p1');
  assert.equal(room.players[0].hand.length, 0);
  assert.equal(room.game.word, 'CASAR');
  assert.equal(canSkipTurn(room, 'p1'), false);
  assert.throws(() => skipTurn(room, 'p1', random), /andamento/);
});

test('2x após 2+* força seu autor a jogar de novo e preserva todas as letras adicionadas', () => {
  let room = playMulti(fixture(), 'AR');
  room = playCard(room, 'p2', 'double-0');
  assert.equal(room.game.word, 'CASAR');
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.deepEqual(room.game.extraTurns, ['p2']);
  room = playCard(room, 'p1', 'letra-B');
  assert.equal(room.game.turnPlayerId, 'p2');
});
