import test from 'node:test';
import { resolvePendingVictory } from '../game/victory.js';
import assert from 'node:assert/strict';
import {
  createDeck, createRoom, joinRoom, updateSettings, startGame, playCard, drawCard,
  skipTurn, canSkipTurn, isCardPlayable, playableLetters, roomView, disconnectPlayer,
} from '../game/game.js';

const random = () => 0.3;
const card = (key) => {
  const [type, index = '0'] = key.split(':');
  return type.length === 1 ? { id: `letra-${type}`, type: 'letter', letter: type }
    : createDeck().find((c) => c.id === `${type}-${index}`);
};

// Monta cenários explícitos sem depender da ordem do embaralhamento.
function scenario({ hands = [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']], word = '', last = null, turn = 0,
  blocked = null, supply = ['J', 'K', 'L', 'M', 'N', 'O'], discard = [] } = {}) {
  let room = createRoom({ code: 'ABC234', playerId: 'p1', sessionId: 's1', name: 'Ana', now: 1000 });
  room = updateSettings(room, 'p1', { playerCount: hands.length, initialCards: 3 });
  for (let i = 1; i < hands.length; i++) room = joinRoom(room, { playerId: `p${i + 1}`, sessionId: `s${i + 1}`, name: ['Ana', 'Bia', 'Caio'][i] });
  room = startGame(room, 'p1', random);
  room.players.forEach((p, i) => { p.hand = hands[i].map(card); });
  Object.assign(room.game, { word, lastPlayerId: last, turnPlayerId: `p${turn + 1}`, blockedLetter: blocked,
    deck: supply.map(card), discard: discard.map(card) });
  return room;
}
const play = (room, key, letter, blocked) => playCard(room, room.game.turnPlayerId, card(key).id, letter, blocked);

test('Troca fica desabilitada com visor vazio e o servidor rejeita a carta', () => {
  const room = scenario({ hands: [['swap', 'A'], ['B']] });
  assert.equal(isCardPlayable(card('swap'), room.game), false);
  assert.ok(!roomView(room, 'p1').game.playableCardIds.includes(card('swap').id));
  assert.throws(() => play(room, 'swap', 'B'), /não pode/);
});

test('Troca substitui somente a última letra, nunca permite a mesma nem a bloqueada', () => {
  const room = scenario({ hands: [['swap', 'A'], ['B']], word: 'CASA', last: 'p2', blocked: 'O' });
  assert.ok(!playableLetters(card('swap'), room.game).includes('A'));
  assert.ok(!playableLetters(card('swap'), room.game).includes('O'));
  assert.throws(() => play(room, 'swap', 'A'), /permitida/);
  assert.throws(() => play(room, 'swap', 'O'), /permitida/);
  const next = play(room, 'swap', 'E');
  assert.equal(next.game.word, 'CASE');
  assert.equal(next.game.turnPlayerId, 'p2');
  assert.equal(next.game.blockedLetter, null);
  assert.equal(next.game.lastPlayerId, 'p1');
  assert.match(next.notice, /Troca/);
  assert.equal(room.game.word, 'CASA', 'entrada permanece intacta');
});

test('Troca funciona com palavra de uma única letra', () => {
  const next = play(scenario({ hands: [['swap', 'C'], ['D']], word: 'A' }), 'swap', 'Z');
  assert.equal(next.game.word, 'Z');
});

test('Bloqueio adiciona a letra, exige dois seletores válidos e publica a letra bloqueada', () => {
  const room = scenario({ hands: [['block', 'B'], ['A', 'C']] });
  for (const value of [undefined, '', 'AB', 'Á', {}, 3]) assert.throws(() => play(room, 'block', 'X', value), /bloquear/);
  const next = play(room, 'block', 'X', 'A');
  assert.equal(next.game.word, 'X');
  assert.equal(next.game.blockedLetter, 'A');
  assert.equal(roomView(next, 'p1').game.blockedLetter, 'A');
  assert.equal(roomView(next, 'p2').game.blockedLetter, 'A');
  assert.match(next.notice, /Bloqueio/);
});

test('Bloqueio desabilita cartas fixas e letras em todos os seletores', () => {
  const room = scenario({ hands: [['A', 'wild', 'vowel', 'first', 'swap', 'block'], ['B']], word: 'X', blocked: 'A' });
  const view = roomView(room, 'p1');
  assert.ok(!view.game.playableCardIds.includes(card('A').id));
  assert.throws(() => play(room, 'A'), /não pode/);
  for (const key of ['wild', 'vowel', 'first', 'swap', 'block']) {
    assert.ok(!view.game.allowedLettersByCard[card(key).id].includes('A'));
    assert.throws(() => play(room, key, 'A', 'Z'), /permitida/);
  }
});

test('Bloqueio permanece durante compra e desaparece após uma jogada com letra', () => {
  let room = scenario({ blocked: 'A', last: 'p2' });
  room = drawCard(room, 'p1', random);
  assert.equal(room.game.blockedLetter, 'A');
  room = play(room, 'B');
  assert.equal(room.game.blockedLetter, null);
  assert.equal(room.game.turnPlayerId, 'p2');
});

test('um Bloqueio pode substituir outro; a letra a bloquear não é limitada pelo bloqueio anterior', () => {
  const room = scenario({ hands: [['block', 'C'], ['A', 'B']], blocked: 'A' });
  assert.throws(() => play(room, 'block', 'A', 'B'), /permitida/);
  assert.ok(!roomView(room, 'p1').game.allowedLettersByCard[card('block').id].includes('A'));
  assert.equal(room.game.blockedLetter, 'A', 'jogada inválida não consome a restrição');
  assert.equal(play(room, 'block', 'B', 'A').game.blockedLetter, 'A');
  assert.equal(play(room, 'block', 'B', 'B').game.blockedLetter, 'B');
});

test('2x preserva o bloqueio sem adicionar letra', () => {
  const next = play(scenario({ hands: [['double', 'A'], ['B']], last: 'p2', word: 'CASA', blocked: 'A' }), 'double');
  assert.equal(next.game.blockedLetter, 'A');
  assert.equal(next.game.word, 'CASA');
  assert.equal(next.game.turnPlayerId, 'p2');
  assert.equal(roomView(next, 'p1').game.blockedLetter, 'A');
  assert.equal(roomView(next, 'p2').game.blockedLetter, 'A');
});

test('criador do Bloqueio também está sujeito à restrição ao ser forçado por 2x', () => {
  let room = scenario({ hands: [['block', 'A', 'wild', 'swap', 'B'], ['double', 'C', 'D']] });
  room = play(room, 'block', 'X', 'A');
  room = play(room, 'double');
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.equal(room.game.blockedLetter, 'A');
  const view = roomView(room, 'p1');
  assert.ok(!view.game.playableCardIds.includes(card('A').id));
  assert.throws(() => play(room, 'A'), /não pode/);
  for (const key of ['wild', 'swap']) {
    assert.ok(!view.game.allowedLettersByCard[card(key).id].includes('A'));
    assert.throws(() => play(room, key, 'A'), /permitida/);
  }
  assert.equal(play(room, 'B').game.blockedLetter, null);
});

test('Bloqueio persiste por toda a cadeia de 2x e só uma jogada com letra o consome', () => {
  let room = scenario({ hands: [['block', 'double:1', 'A', 'B'], ['double', 'C', 'D', 'E']] });
  room = play(room, 'block', 'X', 'A');
  for (const key of ['double', 'double:1']) {
    assert.equal(isCardPlayable(card(key), room.game), true);
    room = play(room, key);
    assert.equal(room.game.word, 'X');
    assert.equal(room.game.blockedLetter, 'A');
    for (const id of ['p1', 'p2']) assert.equal(roomView(room, id).game.blockedLetter, 'A');
  }
  assert.deepEqual(room.game.extraTurns, ['p2', 'p1']);
  room = play(room, 'C');
  assert.equal(room.game.word, 'XC');
  assert.equal(room.game.blockedLetter, null);
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.ok(roomView(room, 'p1').game.playableCardIds.includes(card('A').id));
});

test('letras fixas, coringas, restritivas e Troca consomem normalmente o bloqueio', () => {
  for (const [key, letter] of [['B', undefined], ['wild', 'B'], ['vowel', 'E'], ['consonant', 'B'], ['first', 'B'], ['last', 'N'], ['swap', 'O']]) {
    const room = scenario({ hands: [[key, 'C'], ['D']], blocked: 'Z', word: 'CASA', last: 'p2' });
    assert.equal(play(room, key, letter).game.blockedLetter, null, key);
  }
});

test('2x não pode ser a primeira jogada, mesmo com uma letra forjada no payload', () => {
  const room = scenario({ hands: [['double', 'A'], ['B']] });
  assert.equal(isCardPlayable(card('double'), room.game), false);
  assert.ok(!roomView(room, 'p1').game.playableCardIds.includes(card('double').id));
  assert.throws(() => play(room, 'double', 'A'), /não pode/);
});

test('2x: jogador anterior repete, autor recebe novo turno, depois segue a ordem normal', () => {
  let room = scenario({ hands: [['A', 'B', 'C'], ['double', 'D', 'E'], ['F', 'G']], word: 'C', last: 'p1', turn: 1 });
  room = drawCard(room, 'p2', random);
  room = play(room, 'double');
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.equal(room.game.word, 'C');
  assert.deepEqual(room.game.extraTurns, ['p2']);
  assert.equal(room.game.drawsThisTurn, 0);
  assert.match(room.notice, /2x/);
  assert.equal(canSkipTurn(room, 'p2'), false);
  room = play(room, 'A');
  assert.equal(room.game.turnPlayerId, 'p2');
  assert.equal(room.game.drawsThisTurn, 0);
  assert.equal(drawCard(room, 'p2', random).game.drawsThisTurn, 1);
  room = play(room, 'D');
  assert.equal(room.game.turnPlayerId, 'p3');
  assert.deepEqual(room.game.extraTurns, []);
});

test('2x em cadeia desempilha todos os retornos antes de retomar a ordem normal', () => {
  let room = scenario({ hands: [['double:1', 'A', 'B'], ['double', 'C', 'D', 'G'], ['E', 'F']], word: 'Z', last: 'p1', turn: 1 });
  const order = [];
  for (const key of ['double', 'double:1', 'C', 'A', 'D']) {
    order.push(room.game.turnPlayerId);
    room = play(room, key);
  }
  order.push(room.game.turnPlayerId);
  assert.deepEqual(order, ['p2', 'p1', 'p2', 'p1', 'p2', 'p3']);
  assert.deepEqual(room.game.extraTurns, []);
  assert.deepEqual(JSON.parse(JSON.stringify(room)), room);
});

test('2x como última carta vence sem iniciar turnos extras', () => {
  const room = play(scenario({ hands: [['A'], ['double']], last: 'p1', turn: 1, word: 'A' }), 'double');
  assert.equal(room.phase, 'finished');
  assert.equal(room.game.winnerId, 'p2');
  assert.deepEqual(room.game.extraTurns, []);
  assert.equal(room.game.word, 'A');
  assert.equal(canSkipTurn(room, 'p2'), false);
});

test('desconexão durante 2x pula o forçado ou o retorno sem perder a ordem normal', () => {
  const room = play(scenario({ hands: [['A', 'B'], ['double', 'C'], ['D', 'E']], last: 'p1', turn: 1 }), 'double');
  assert.equal(disconnectPlayer(room, 'p1', 2000).game.turnPlayerId, 'p2');
  const withoutAuthor = disconnectPlayer(room, 'p2', 2000);
  assert.equal(play(withoutAuthor, 'A').game.turnPlayerId, 'p3');
  const beforeDouble = disconnectPlayer(scenario({ hands: [['A'], ['double', 'B'], ['C', 'D']], last: 'p1', turn: 1 }), 'p1', 2000);
  const skipped = play(beforeDouble, 'double');
  assert.equal(skipped.game.turnPlayerId, 'p2');
  assert.deepEqual(skipped.game.extraTurns, []);
  assert.match(skipped.notice, /desconectado/);
});

test('vencer no turno forçado do 2x encerra e limpa os retornos pendentes', () => {
  let room = play(scenario({ hands: [['A'], ['double', 'B']], last: 'p1', turn: 1 }), 'double');
  room = resolvePendingVictory(play(room, 'A'), 10_000);
  assert.equal(room.phase, 'finished');
  assert.equal(room.game.winnerId, 'p1');
  assert.deepEqual(room.game.extraTurns, []);
  assert.throws(() => drawCard(room, 'p2', random), /andamento/);
});

for (const [name, hands, blocked] of [
  ['Troca com visor vazio', [['swap'], ['A']], null],
  ['2x sem jogada anterior', [['double'], ['A']], null],
  ['letra fixa bloqueada', [['A'], ['B']], 'A'],
]) {
  test(`Não consigo jogar fica habilitado após a compra: ${name}`, () => {
    const room = scenario({ hands, blocked });
    room.game.drawsThisTurn = 1;
    const view = roomView(room, 'p1');
    assert.equal(view.game.canSkipTurn, true);
    assert.equal(view.game.canDraw, false);
    assert.equal(view.game.noPlayableCards, true);
    assert.equal(room.game.drawsThisTurn, 1);
    const next = skipTurn(room, 'p1', random);
    assert.equal(next.players[0].hand.length, 5);
    assert.equal(next.game.turnPlayerId, 'p2');
    assert.equal(next.game.drawsThisTurn, 0);
    assert.equal(next.game.word, '');
    assert.equal(next.game.blockedLetter, null);
  });
}

test('compra opcional pode trazer uma carta jogável e desabilitar o Não consigo jogar sem passar a vez', () => {
  const original = scenario({ hands: [['swap'], ['B']], supply: ['A'] });
  const room = drawCard(original, 'p1', random);
  assert.equal(canSkipTurn(room, 'p1'), false);
  assert.equal(roomView(room, 'p1').game.canDraw, false);
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.equal(play(room, 'A').game.word, 'A');
  assert.throws(() => skipTurn(room, 'p1', random), /sem carta jogável/);
});

test('comprar uma carta injogável mantém Não consigo jogar, sem compras extras ou passagem automática', () => {
  const room = drawCard(scenario({ hands: [['swap'], ['B']], supply: ['swap:1'] }), 'p1', random);
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.equal(room.game.drawsThisTurn, 1);
  assert.equal(canSkipTurn(room, 'p1'), true);
  assert.throws(() => drawCard(room, 'p1', random), /já comprou/);
});

test('Não consigo jogar passa após esgotar as cartas se a penalidade não trouxe carta jogável', () => {
  const original = scenario({ hands: [['swap'], ['A']], supply: ['swap:1', 'swap:2'] });
  original.game.drawsThisTurn = 1;
  const room = skipTurn(original, 'p1', random);
  assert.equal(room.players[0].hand.length, 3);
  assert.equal(room.game.turnPlayerId, 'p2');
  assert.equal(room.game.drawsThisTurn, 0);
});

test('a visão de possibilidades continua privada e o estado inteiro é JSON serializável', () => {
  const room = scenario({ hands: [['swap', 'A'], ['block', 'double']], word: 'A', last: 'p2' });
  const view = roomView(room, 'p1');
  assert.deepEqual(Object.keys(view.game.allowedLettersByCard).sort(), ['letra-A', 'swap-0']);
  assert.ok(view.players.every((p) => !p.hand && !p.sessionId));
  assert.deepEqual(JSON.parse(JSON.stringify(room)), room);
});
