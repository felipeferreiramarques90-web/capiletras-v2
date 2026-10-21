import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeck, createRoom, joinRoom, updateSettings, startGame, playCard, drawCard,
  loseRound, canLoseRound, isCardPlayable, playableLetters, roomView, disconnectPlayer,
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
    canLose: last !== null, deck: supply.map(card), discard: discard.map(card) });
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

test('Bloqueio permanece durante compra e desaparece após exatamente uma jogada', () => {
  let room = scenario({ blocked: 'A', last: 'p2' });
  room = drawCard(room, 'p1', random);
  assert.equal(room.game.blockedLetter, 'A');
  room = play(room, 'B');
  assert.equal(room.game.blockedLetter, null);
  assert.equal(room.game.turnPlayerId, 'p2');
});

test('um Bloqueio pode substituir outro; a letra a bloquear não é limitada pelo bloqueio anterior', () => {
  const room = scenario({ hands: [['block', 'C'], ['A', 'B']], blocked: 'A' });
  assert.equal(play(room, 'block', 'B', 'A').game.blockedLetter, 'A');
  assert.equal(play(room, 'block', 'B', 'B').game.blockedLetter, 'B');
});

test('2x consome um bloqueio sem adicionar letra', () => {
  const next = play(scenario({ hands: [['double', 'A'], ['B']], last: 'p2', word: 'CASA', blocked: 'A' }), 'double');
  assert.equal(next.game.blockedLetter, null);
  assert.equal(next.game.word, 'CASA');
});

test('PERDI de qualquer caso elegível cancela o bloqueio e avisa todos', () => {
  let room = scenario({ hands: [['B'], ['A']], last: 'p1', turn: 1, word: 'CAS', blocked: 'A' });
  assert.equal(canLoseRound(room, 'p1'), true);
  assert.equal(canLoseRound(room, 'p2'), true);
  for (const id of ['p1', 'p2']) {
    const next = loseRound(room, id, random);
    assert.equal(next.game.word, '');
    assert.equal(next.game.blockedLetter, null);
    assert.equal(next.game.turnPlayerId, 'p2');
    assert.match(next.notice, /bloqueio.*cancelado/);
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
  assert.equal(canLoseRound(room, 'p2'), true);
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
  assert.equal(canLoseRound(room, 'p2'), false);
});

test('2x ainda é válido após PERDI zerar a palavra: histórico não é apagado', () => {
  let room = scenario({ hands: [['A', 'B'], ['double', 'C']], word: 'A', last: 'p1', turn: 1 });
  room = loseRound(room, 'p1', random);
  assert.equal(room.game.word, '');
  assert.equal(isCardPlayable(card('double'), room.game), true);
  assert.equal(play(room, 'double').game.turnPlayerId, 'p1');
});

test('PERDI durante 2x mantém a pilha de retornos e o turno atual', () => {
  let room = play(scenario({ hands: [['A', 'B'], ['double', 'C']], word: 'A', last: 'p1', turn: 1 }), 'double');
  const pending = [...room.game.extraTurns];
  room = loseRound(room, 'p2', random);
  assert.deepEqual(room.game.extraTurns, pending);
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.equal(play(room, 'A').game.turnPlayerId, 'p2');
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
  room = play(room, 'A');
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
  test(`PERDI fica habilitado imediatamente sem compra: ${name}`, () => {
    const room = scenario({ hands, blocked });
    const view = roomView(room, 'p1');
    assert.equal(view.game.canLose, true);
    assert.equal(view.game.canDraw, true);
    assert.equal(view.game.noPlayableCards, true);
    assert.equal(room.game.drawsThisTurn, 0);
    const next = loseRound(room, 'p1', random);
    assert.equal(next.players[0].hand.length, 5);
    assert.equal(next.game.turnPlayerId, 'p1');
    assert.equal(next.game.drawsThisTurn, 0);
    assert.equal(next.game.word, '');
    assert.equal(next.game.blockedLetter, null);
  });
}

test('compra opcional pode trazer uma carta jogável e desabilitar o PERDI sem passar a vez', () => {
  const original = scenario({ hands: [['swap'], ['B']], supply: ['A'] });
  const room = drawCard(original, 'p1', random);
  assert.equal(canLoseRound(room, 'p1'), false);
  assert.equal(roomView(room, 'p1').game.canDraw, false);
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.equal(play(room, 'A').game.word, 'A');
  assert.throws(() => loseRound(room, 'p1', random), /sem carta jogável/);
});

test('comprar uma carta injogável mantém PERDI, sem compras extras ou passagem automática', () => {
  const room = drawCard(scenario({ hands: [['swap'], ['B']], supply: ['swap:1'] }), 'p1', random);
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.equal(room.game.drawsThisTurn, 1);
  assert.equal(canLoseRound(room, 'p1'), true);
  assert.throws(() => drawCard(room, 'p1', random), /já comprou/);
});

test('PERDI continua habilitado após penalidade se a mão continuar injogável e ainda houver compra', () => {
  const original = scenario({ hands: [['swap'], ['B']], supply: ['A', 'swap:1', 'swap:2', 'swap:3', 'swap:4'] });
  const room = loseRound(original, 'p1', random);
  assert.equal(room.players[0].hand.length, 5);
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.equal(canLoseRound(room, 'p1'), true);
  assert.equal(roomView(room, 'p1').game.canDraw, true);
  assert.equal(loseRound(room, 'p1', random).game.turnPlayerId, 'p1');
});

test('PERDI sem pilha nem descarte zera a palavra, cancela bloqueio e passa se ainda injogável', () => {
  // A letra continua bloqueada inicialmente; cancelar o bloqueio a libera e mantém o turno.
  let room = scenario({ hands: [['A'], ['B']], word: 'CAS', blocked: 'A', supply: [] });
  room = loseRound(room, 'p1', random);
  assert.equal(room.game.word, '');
  assert.equal(room.game.blockedLetter, null);
  assert.equal(room.game.turnPlayerId, 'p1');
  // Sem histórico, só 2x: nada pode ser jogado mesmo após zerar o visor.
  room = loseRound(scenario({ hands: [['double'], ['A']], word: 'CAS', supply: [] }), 'p1', random);
  assert.equal(room.game.word, '');
  assert.equal(room.game.turnPlayerId, 'p2');
  assert.match(room.notice, /vez passou/);
  assert.equal(room.players[0].hand.length, 1);
});

test('PERDI passa após esgotar as cartas se a penalidade não trouxe carta jogável', () => {
  const room = loseRound(scenario({ hands: [['swap'], ['A']], supply: ['swap:1', 'swap:2'] }), 'p1', random);
  assert.equal(room.players[0].hand.length, 3);
  assert.equal(room.game.turnPlayerId, 'p2');
  assert.equal(room.game.drawsThisTurn, 0);
});

test('disputa dos dois PERDI: só o primeiro da mesma versão é aceito, nas duas ordens', () => {
  const original = scenario({ hands: [['B'], ['A']], last: 'p1', turn: 1, blocked: 'A', word: 'X' });
  for (const [first, second] of [['p1', 'p2'], ['p2', 'p1']]) {
    const version = original.game.version;
    assert.equal(canLoseRound(original, first), true);
    assert.equal(canLoseRound(original, second), true);
    const room = loseRound(original, first, random, version);
    assert.throws(() => loseRound(room, second, random, version), /mesa mudou/);
  }
});

test('versão rejeita clique simultâneo antigo mesmo quando o PERDI continua habilitado', () => {
  const original = scenario({ hands: [['B'], ['swap']], last: 'p1', turn: 1, supply: ['A', 'swap:1', 'swap:2', 'swap:3', 'swap:4'] });
  const room = loseRound(original, 'p1', random, original.game.version);
  assert.equal(canLoseRound(room, 'p2'), true);
  assert.throws(() => loseRound(room, 'p2', random, original.game.version), /mesa mudou/);
  assert.doesNotThrow(() => loseRound(room, 'p2', random, room.game.version));
});

test('a visão de possibilidades continua privada e o estado inteiro é JSON serializável', () => {
  const room = scenario({ hands: [['swap', 'A'], ['block', 'double']], word: 'A', last: 'p2' });
  const view = roomView(room, 'p1');
  assert.deepEqual(Object.keys(view.game.allowedLettersByCard).sort(), ['letra-A', 'swap-0']);
  assert.ok(view.players.every((p) => !p.hand && !p.sessionId));
  assert.deepEqual(JSON.parse(JSON.stringify(room)), room);
});
