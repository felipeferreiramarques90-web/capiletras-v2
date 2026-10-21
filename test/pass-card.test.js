import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_TYPES, DECK_SIZE, maxInitialCards } from '../game/config.js';
import {
  createDeck, createRoom, joinRoom, updateSettings, startGame, playCard, drawCard,
  loseRound, roomView, isCardPlayable, debtForPlayer, disconnectPlayer,
} from '../game/game.js';

const random = () => 0.25;
function fixture({ hands = [['pass-0', 'letra-B', 'letra-E'], ['pass-1', 'letra-C', 'letra-F'], ['pass-2', 'letra-D', 'letra-G']],
  word = '', blockedLetter = null, turn = 'p1', last = null, debt = 0 } = {}) {
  let room = createRoom({ code: 'ABC234', playerId: 'p1', sessionId: 's1', name: 'Ana', now: 1000 });
  room = updateSettings(room, 'p1', { playerCount: hands.length, initialCards: 3 });
  for (let i = 1; i < hands.length; i++) room = joinRoom(room, { playerId: `p${i + 1}`, sessionId: `s${i + 1}`, name: ['Ana', 'Bia', 'Caio'][i] });
  room = startGame(room, 'p1', random);
  const cards = createDeck(), used = new Set(hands.flat());
  room.players.forEach((p, i) => { p.hand = hands[i].map((id) => cards.find((card) => card.id === id)); });
  Object.assign(room.game, { deck: cards.filter((card) => !used.has(card.id)), word, blockedLetter,
    turnPlayerId: turn, lastPlayerId: last, canLose: last !== null,
    letterDebt: { count: debt, playerId: debt ? turn : null } });
  return room;
}
const play = (room, cardId, letter, blockedLetter, payment) => playCard(room, room.game.turnPlayerId, cardId, letter, blockedLetter, payment);

test('Passar letra soma 12 às 72 anteriores, sem alterar outros tipos, e recalcula limites', () => {
  const counts = { letter: 26, wild: 12, vowel: 1, consonant: 1, first: 1, last: 1, swap: 8, block: 6, double: 6, multi: 5, life: 5, pass: 12 };
  assert.deepEqual(Object.fromEntries(Object.entries(CARD_TYPES).map(([type, rule]) => [type, rule.quantity])), counts);
  assert.equal(DECK_SIZE, 84);
  assert.equal(createDeck().length, 84);
  assert.equal(new Set(createDeck().map((card) => card.id)).size, 84);
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8].map(maxInitialCards), [41, 27, 20, 16, 13, 11, 10]);
});

test('Passar letra é válida como primeira jogada, passa a vez e não consome Bloqueio', () => {
  const original = fixture({ blockedLetter: 'K' });
  const room = play(original, 'pass-0');
  assert.equal(isCardPlayable(original.players[0].hand[0], original.game), true);
  assert.equal(room.game.word, '');
  assert.equal(room.game.blockedLetter, 'K');
  assert.equal(room.game.turnPlayerId, 'p2');
  assert.deepEqual(room.game.letterDebt, { count: 1, playerId: 'p2' });
  assert.equal(roomView(room, 'p1').game.canLose, true);
  assert.match(room.notice, /Passar letra.*Bia deve 1 letra/);
  assert.equal(original.players[0].hand.length, 3);
});

test('cascata de três Passar letra acumula sem pagar e acompanha o próximo jogador', () => {
  let room = fixture({ word: 'CAS' });
  for (let i = 0; i < 3; i++) {
    room = play(room, `pass-${i}`);
    assert.equal(room.game.word, 'CAS');
    assert.deepEqual(room.game.letterDebt, { count: i + 1, playerId: `p${(i + 1) % 3 + 1}` });
  }
  assert.equal(debtForPlayer(room.game, 'p1'), 3);
  assert.equal(debtForPlayer(room.game, 'p2'), 0);
});

for (const [cardId, letter, newBlock, expected] of [
  ['letra-K', undefined, undefined, 'XZYK'], ['wild-0', 'B', undefined, 'XZYB'],
  ['vowel-0', 'E', undefined, 'XZYE'], ['consonant-0', 'Z', undefined, 'XZYZ'],
  ['first-0', 'M', undefined, 'XZYM'], ['last-0', 'Z', undefined, 'XZYZ'],
  ['swap-0', 'B', undefined, 'XZB'], ['block-0', 'M', 'K', 'XZYM'],
  ['life-0', 'A', undefined, 'XZYA'], ['multi-0', 'AB', undefined, 'XZYAB'],
]) {
  test(`pagamento com ${cardId}: acumuladas antes da carta, sem aplicar suas restrições ao pagamento`, () => {
    const room = fixture({ hands: [[cardId, 'letra-C'], ['letra-D', 'letra-E']], word: 'X', debt: 2 });
    const next = play(room, cardId, letter, newBlock, 'zY');
    assert.equal(next.game.word, expected);
    assert.deepEqual(next.game.letterDebt, { count: 0, playerId: null });
    assert.equal(next.game.blockedLetter, newBlock ?? null);
    assert.equal(next.players[0].hand.length, 1);
    assert.match(next.notice, /pagou 2 letras acumuladas/);
  });
}

test('pagamento exige exatamente N letras ASCII e rejeita entradas sem alterar estado', () => {
  for (const input of [undefined, null, '', 'A', 'ABC', 'A1', 'A ', 'ÁB', 'ßA', 'A\n', ['A', 'B'], {}]) {
    const room = fixture({ hands: [['wild-0', 'letra-C'], ['letra-D']], debt: 2 });
    const before = structuredClone(room);
    assert.throws(() => play(room, 'wild-0', 'E', undefined, input));
    assert.deepEqual(room, before);
  }
});

test('só a primeira acumulada respeita Bloqueio; carta fixa da letra bloqueada fica jogável', () => {
  const room = fixture({ hands: [['letra-K', 'letra-C'], ['letra-D']], word: 'X', blockedLetter: 'K', debt: 3 });
  assert.ok(roomView(room, 'p1').game.playableCardIds.includes('letra-K'));
  const before = structuredClone(room);
  assert.throws(() => play(room, 'letra-K', undefined, undefined, 'kAA'), /primeira letra acumulada/);
  assert.deepEqual(room, before);
  const next = play(room, 'letra-K', undefined, undefined, 'aKK');
  assert.equal(next.game.word, 'XAKKK');
  assert.equal(next.game.blockedLetter, null);
  assert.equal(next.game.letterDebt.count, 0);
});

test('Troca com débito é jogável no visor vazio e substitui a última acumulada por outra letra', () => {
  const room = fixture({ hands: [['swap-0', 'letra-C'], ['letra-D']], debt: 1 });
  assert.ok(roomView(room, 'p1').game.playableCardIds.includes('swap-0'));
  const before = structuredClone(room);
  assert.throws(() => play(room, 'swap-0', 'A', undefined, 'A'), /permitida/);
  assert.deepEqual(room, before);
  assert.equal(play(room, 'swap-0', 'B', undefined, 'A').game.word, 'B');
  const noDebt = fixture({ hands: [['swap-0'], ['letra-D']] });
  assert.equal(isCardPlayable(noDebt.players[0].hand[0], noDebt.game), false);
});

test('pagamento consome Bloqueio antes de Vida, 2+* e novo Bloqueio', () => {
  for (const [id, letter, newBlock, expected] of [['life-0', 'A', undefined, 'BA'], ['multi-0', 'AAA', undefined, 'BAAA'], ['block-0', 'A', 'Z', 'BA']]) {
    const room = fixture({ hands: [[id, 'letra-C'], ['letra-D']], debt: 1, blockedLetter: 'A' });
    const next = play(room, id, letter, newBlock, 'B');
    assert.equal(next.game.word, expected);
    assert.equal(next.game.blockedLetter, newBlock ?? null);
  }
});

test('uma carta inválida não confirma o pagamento: validação atômica', () => {
  for (const [id, letter, blocked] of [['life-0', 'B'], ['vowel-0', 'Z'], ['multi-0', 'A'], ['block-0', 'E', '1']]) {
    const room = fixture({ hands: [[id, 'letra-C'], ['letra-D']], debt: 2, blockedLetter: 'A' });
    const before = structuredClone(room);
    assert.throws(() => play(room, id, letter, blocked, 'BZ'));
    assert.deepEqual(room, before);
  }
});

test('Passar letra e 2x não aceitam pagamento e mantêm o Bloqueio', () => {
  for (const id of ['pass-0', 'double-0']) {
    const room = fixture({ hands: [[id, 'letra-C'], ['letra-D', 'letra-E']], debt: 2, last: 'p2', blockedLetter: 'A' });
    const before = structuredClone(room);
    assert.throws(() => play(room, id, undefined, undefined, 'BZ'), /não paga/);
    assert.deepEqual(room, before);
    const next = play(room, id);
    assert.equal(next.game.word, '');
    assert.equal(next.game.blockedLetter, 'A');
    assert.equal(next.game.letterDebt.count, id === 'pass-0' ? 3 : 2);
  }
});

test('2x transfere o débito ao anterior, que paga no turno forçado e devolve a vez', () => {
  let room = fixture({ hands: [['letra-B', 'letra-E'], ['double-0', 'letra-C', 'letra-D'], ['letra-F']], debt: 2, turn: 'p2', last: 'p1' });
  room = drawCard(room, 'p2', random);
  room = play(room, 'double-0');
  assert.deepEqual(room.game.letterDebt, { count: 2, playerId: 'p1' });
  assert.equal(debtForPlayer(room.game, 'p2'), 0);
  room = play(room, 'letra-B', undefined, undefined, 'XY');
  assert.equal(room.game.word, 'XYB');
  assert.equal(room.game.turnPlayerId, 'p2');
  assert.equal(room.game.drawsThisTurn, 0);
  assert.equal(room.game.letterDebt.count, 0);
});

test('débito acompanha cadeia de 2x sem duplicar nem pagar até uma carta com letra', () => {
  let room = fixture({ hands: [['double-1', 'letra-B', 'letra-E'], ['double-0', 'letra-C', 'letra-D'], ['letra-F']], debt: 2, turn: 'p2', last: 'p1' });
  room = play(room, 'double-0');
  assert.deepEqual(room.game.letterDebt, { count: 2, playerId: 'p1' });
  room = play(room, 'double-1');
  assert.deepEqual(room.game.letterDebt, { count: 2, playerId: 'p2' });
  room = play(room, 'letra-C', undefined, undefined, 'XY');
  assert.equal(room.game.word, 'XYC');
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.equal(room.game.letterDebt.count, 0);
});

test('jogador forçado usa Passar letra e retorna débito acrescido ao autor do 2x', () => {
  let room = fixture({ hands: [['pass-0', 'letra-B'], ['double-0', 'letra-C', 'letra-D'], ['letra-F']], debt: 2, turn: 'p2', last: 'p1', blockedLetter: 'A' });
  room = play(room, 'double-0');
  room = play(room, 'pass-0');
  assert.equal(room.game.turnPlayerId, 'p2');
  assert.deepEqual(room.game.letterDebt, { count: 3, playerId: 'p2' });
  assert.equal(room.game.blockedLetter, 'A');
  room = play(room, 'letra-C', undefined, undefined, 'BZZ');
  assert.equal(room.game.word, 'BZZC');
  assert.equal(room.game.turnPlayerId, 'p3');
});

test('PERDI do último a jogar Passar letra zera débito, palavra e Bloqueio sem mudar a vez', () => {
  const passed = play(fixture({ word: 'CAS', blockedLetter: 'K' }), 'pass-0');
  const room = loseRound(passed, 'p1', random);
  assert.deepEqual(room.game.letterDebt, { count: 0, playerId: null });
  assert.equal(room.game.word, '');
  assert.equal(room.game.blockedLetter, null);
  assert.equal(room.game.turnPlayerId, 'p2');
  assert.match(room.notice, /débito.*zerado/);
});

test('vitória com Passar letra e com pagamento da última carta', () => {
  const passWin = play(fixture({ hands: [['pass-0'], ['letra-C']] }), 'pass-0');
  assert.equal(passWin.phase, 'finished');
  assert.equal(passWin.game.winnerId, 'p1');
  const payWin = play(fixture({ hands: [['letra-K'], ['letra-C']], debt: 2 }), 'letra-K', undefined, undefined, 'XY');
  assert.equal(payWin.phase, 'finished');
  assert.equal(payWin.game.word, 'XYK');
  assert.equal(payWin.game.letterDebt.count, 0);
});

test('débito JSON acompanha desconexão e só expõe informações públicas', () => {
  let room = play(fixture(), 'pass-0');
  room = disconnectPlayer(room, 'p2', 2000);
  assert.deepEqual(room.game.letterDebt, { count: 1, playerId: 'p3' });
  const view = roomView(room, 'p1');
  assert.deepEqual(view.game.letterDebt, room.game.letterDebt);
  assert.ok(view.players.every((p) => !p.hand && !p.sessionId));
  assert.deepEqual(JSON.parse(JSON.stringify(room)), room);
});
