import test from 'node:test';
import { resolvePendingVictory } from '../game/victory.js';
import assert from 'node:assert/strict';
import {
  createDeck, createRoom, joinRoom, updateSettings, startGame, drawCard, playCard,
  skipTurn, disconnectPlayer, returnToLobby, removeFromLobby, roomView, allowedLetters, playableLetters, isCardPlayable, shouldDeleteRoom,
} from '../game/game.js';
import { CARD_TYPES, DECK_SIZE, RULES, maxInitialCards } from '../game/config.js';
import { MemoryStorage } from '../storage/memory.js';

const random = () => 0.375;
function lobby(count = 2, hand = 5) {
  let room = createRoom({ code: 'ABC234', playerId: 'p1', sessionId: 's1', name: 'Ana', now: 1000 });
  room = updateSettings(room, 'p1', { playerCount: count, initialCards: hand });
  for (let i = 2; i <= count; i++) room = joinRoom(room, { playerId: `p${i}`, sessionId: `s${i}`, name: `Pessoa ${i}` });
  return room;
}
const playing = (count = 2, hand = 5) => startGame(lobby(count, hand), 'p1', random);
const firstPlay = (room, id = room.game.turnPlayerId) => {
  const hand = room.players.find((p) => p.id === id).hand;
  const card = hand.find((c) => !['double', 'pass'].includes(c.type) && !CARD_TYPES[c.type].protectsFromChallenge && isCardPlayable(c, room.game)) || hand.find((c) => isCardPlayable(c, room.game));
  if (!card) return room.game.drawsThisTurn === 0 && room.game.deck.length + room.game.discard.length > 0
    ? firstPlay(drawCard(room, id, random), id) : skipTurn(room, id, random);
  const usesLetters = !['double', 'pass'].includes(card.type);
  const debt = room.game.letterDebt.playerId === id ? room.game.letterDebt.count : 0;
  const payment = usesLetters ? (room.game.blockedLetter === 'A' ? 'B' : 'A').repeat(debt) : '';
  const choices = [...playableLetters(card, room.game)].filter((letter) => card.type !== 'swap' || !payment || letter !== payment.at(-1));
  const choice = choices[0]?.repeat(CARD_TYPES[card.type].minLetters || 1);
  return playCard(room, id, card.id, choice, 'Z', payment);
};
const allCards = (room) => [...room.game.deck, ...room.game.discard, ...room.players.flatMap((p) => p.hand)];

test('baralho contém exatamente 84 cartas com identificadores únicos e a composição pedida', () => {
  const cards = createDeck();
  assert.equal(DECK_SIZE, 84);
  assert.equal(cards.length, DECK_SIZE);
  for (const [type, count] of [['swap', 8], ['block', 6], ['double', 6], ['multi', 5], ['life', 5], ['pass', 12]]) assert.equal(cards.filter((c) => c.type === type).length, count);
  assert.equal(new Set(cards.map((c) => c.id)).size, DECK_SIZE);
  assert.equal(cards.filter((c) => c.type === 'wild').length, 12);
  assert.equal(cards.filter((c) => c.type === 'letter').length, 26);
  for (const type of ['vowel', 'consonant', 'first', 'last']) assert.equal(cards.filter((c) => c.type === type).length, 1);
});

test('limites de 2 a 8 jogadores e distribuição máxima sempre reservam compra', () => {
  for (let count = 2; count <= 8; count++) {
    const maximum = maxInitialCards(count);
    const room = playing(count, maximum);
    assert.ok(room.players.every((p) => p.hand.length === maximum));
    assert.equal(room.game.deck.length, DECK_SIZE - count * maximum);
    assert.ok(room.game.deck.length >= 1);
    assert.equal(new Set(allCards(room).map((c) => c.id)).size, DECK_SIZE);
  }
  for (const playerCount of [1, 9, 2.5, '2', null]) {
    assert.throws(() => updateSettings(lobby(), 'p1', { playerCount, initialCards: 3 }));
  }
  for (const initialCards of [2, maxInitialCards(2) + 1, 3.5, '5']) {
    assert.throws(() => updateSettings(lobby(), 'p1', { playerCount: 2, initialCards }));
  }
});

test('só o anfitrião configura/inicia e o início exige todos os participantes conectados', () => {
  assert.throws(() => updateSettings(lobby(), 'p2', { playerCount: 2, initialCards: 3 }), /anfitrião/);
  assert.throws(() => startGame(lobby(), 'p2', random), /anfitrião/);
  const disconnected = disconnectPlayer(lobby(), 'p2', 2000);
  assert.throws(() => startGame(disconnected, 'p1', random), /conectados/);
  assert.throws(() => joinRoom(lobby(), { playerId: 'p3', sessionId: 's3', name: 'Extra' }), /cheia/);
});

test('comprar é opcional, limitado a uma vez por turno e não passa a vez', () => {
  const original = playing();
  let room = drawCard(original, 'p1', random);
  assert.equal(room.players[0].hand.length, 6);
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.equal(room.game.drawsThisTurn, 1);
  assert.equal(roomView(room, 'p1').game.canDraw, false);
  assert.throws(() => drawCard(room, 'p1', random), /já comprou/);
  room = firstPlay(room);
  assert.equal(room.game.drawsThisTurn, 0);
  assert.equal(room.game.turnPlayerId, 'p2');
  room = firstPlay(room);
  assert.equal(room.game.turnPlayerId, 'p1');
  assert.equal(drawCard(room, 'p1', random).game.drawsThisTurn, 1);
  assert.equal(original.players[0].hand.length, 5, 'a entrada não é modificada');
});

test('a carta recém-comprada pode ser jogada no mesmo turno', () => {
  const original = playing();
  const index = original.game.deck.findIndex((c) => c.type === 'letter');
  [original.game.deck[index], original.game.deck[original.game.deck.length - 1]] = [original.game.deck.at(-1), original.game.deck[index]];
  let room = drawCard(original, 'p1', random);
  const card = room.players[0].hand.at(-1);
  room = playCard(room, 'p1', card.id, allowedLetters(card)[0]);
  assert.equal(room.players[0].hand.length, 5);
  assert.equal(room.game.turnPlayerId, 'p2');
});

test('jogar sem comprar funciona, e comprar/jogar fora da vez é rejeitado', () => {
  const room = playing();
  assert.throws(() => drawCard(room, 'p2', random), /sua vez/);
  assert.throws(() => firstPlay(room, 'p2'), /sua vez/);
  assert.throws(() => playCard(room, 'p1', 'carta-inexistente', 'A'), /não está/);
  assert.equal(firstPlay(room).game.turnPlayerId, 'p2');
});

for (const [type, valid, invalid] of [
  ['wild', 'Z', 'Á'], ['vowel', 'E', 'B'], ['consonant', 'Y', 'A'], ['first', 'M', 'N'], ['last', 'N', 'M'],
]) {
  test(`${type}: aceita somente uma letra permitida e rejeita escolhas inválidas`, () => {
    const room = playing();
    const card = createDeck().find((c) => c.type === type);
    room.players[0].hand[0] = card;
    assert.equal(playCard(room, 'p1', card.id, valid.toLowerCase()).game.word, valid);
    for (const choice of [invalid, '', 'AB', 1, null, {}, ' A']) {
      assert.throws(() => playCard(room, 'p1', card.id, choice), /permitida/);
    }
  });
}

test('letra fixa vem da carta, sem permitir que o cliente altere seu valor', () => {
  const room = playing();
  room.players[0].hand[0] = { id: 'letra-A', type: 'letter', letter: 'A' };
  assert.equal(playCard(room, 'p1', 'letra-A', 'Z').game.word, 'A');
});

test('compra falha quando não há pilha nem descarte', () => {
  const room = playing();
  room.game.deck = [];
  room.game.discard = [];
  assert.throws(() => drawCard(room, 'p1', random), /Não há cartas/);
});

test('esvaziar a mão confirma vitória após a janela e impede ações posteriores', () => {
  const original = playing();
  original.players[0].hand = [original.players[0].hand[0]];
  const room = resolvePendingVictory(firstPlay(original), 10_000);
  assert.equal(room.phase, 'finished');
  assert.equal(room.game.winnerId, 'p1');
  assert.equal(roomView(room, 'p1').game.canSkipTurn, false);
  assert.throws(() => drawCard(room, 'p2', random), /andamento/);
  assert.throws(() => skipTurn(room, 'p1', random), /andamento/);
  assert.equal(startGame(room, 'p1', random).game.word, '');
  assert.equal(returnToLobby(room, 'p1').phase, 'lobby');
});

test('visão pública contém somente a própria mão, sem pilha, descarte ou credenciais', () => {
  const room = playing();
  const view = roomView(room, 'p1');
  assert.deepEqual(view.hand, room.players[0].hand);
  assert.ok(view.players.every((p) => !('hand' in p) && !('sessionId' in p)));
  assert.ok(!('deck' in view.game) && !('discard' in view.game));
  assert.throws(() => roomView(room, 'intruso'));
  assert.deepEqual(JSON.parse(JSON.stringify(room)), room);
});

test('reconexão retoma a mesma vaga e mão sem criar participante adicional', () => {
  const original = playing();
  let room = disconnectPlayer(original, 'p2', 2000);
  assert.equal(roomView(room, 'p1').game.paused, true);
  assert.throws(() => drawCard(room, 'p1', random), /pausada/);
  room = joinRoom(room, { playerId: 'id-novo', sessionId: 's2', name: 'Outro nome' });
  assert.equal(room.players.length, 2);
  assert.deepEqual(room.players[1].hand, original.players[1].hand);
  assert.equal(room.players[1].id, 'p2');
  assert.equal(room.players[1].name, 'Pessoa 2');
  assert.equal(roomView(room, 'p1').game.paused, false);
  assert.throws(() => joinRoom(room, { playerId: 'p3', sessionId: 's3', name: 'Intruso' }), /já começou/);
});

test('pula desconectados, transfere anfitrião e reinicia contador ao passar o turno', () => {
  let room = drawCard(playing(3), 'p1', random);
  room = disconnectPlayer(room, 'p1', 2000);
  assert.equal(room.hostId, 'p2');
  assert.equal(room.game.turnPlayerId, 'p2');
  assert.equal(room.game.drawsThisTurn, 0);
  room = firstPlay(firstPlay(room));
  assert.equal(room.game.turnPlayerId, 'p2');
});

test('anfitrião pode encerrar uma partida pausada e liberar vagas desconectadas no lobby', () => {
  const paused = disconnectPlayer(playing(), 'p2', 2000);
  const room = returnToLobby(paused, 'p1');
  assert.equal(room.phase, 'lobby');
  assert.equal(room.players.length, 1);
  assert.throws(() => returnToLobby(playing(), 'p1'), /ainda não terminou/);
  const disconnected = disconnectPlayer(lobby(), 'p2', 2000);
  assert.equal(removeFromLobby(disconnected, 'p1', 'p2').players.length, 1);
  assert.throws(() => removeFromLobby(lobby(), 'p1', 'p2'), /desconectado/);
});

test('salas vazias e inativas expiram nos limites configurados', () => {
  let room = playing();
  assert.equal(shouldDeleteRoom(room, 2000), false);
  room = disconnectPlayer(disconnectPlayer(room, 'p1', 2000), 'p2', 2000);
  assert.equal(shouldDeleteRoom(room, 2000 + RULES.emptyRoomTtlMs - 1), false);
  assert.equal(shouldDeleteRoom(room, 2000 + RULES.emptyRoomTtlMs), true);
  assert.equal(shouldDeleteRoom(playing(), 1000 + RULES.inactiveRoomTtlMs), true);
});

test('armazenamento assíncrono isola cópias e implementa get/save/delete/list', async () => {
  const storage = new MemoryStorage();
  const room = playing();
  await storage.saveRoom(room);
  room.game.word = 'ALTERADO';
  const saved = await storage.getRoom(room.code);
  assert.equal(saved.game.word, '');
  saved.players[0].hand.pop();
  assert.equal((await storage.getRoom(room.code)).players[0].hand.length, 5);
  assert.equal((await storage.listRooms()).length, 1);
  await storage.deleteRoom(room.code);
  assert.equal(await storage.getRoom(room.code), null);
});

test('partida completa preserva todas as cartas do baralho padrão e produz vencedor', () => {
  let room = playing(8, 3);
  let turns = 0;
  while (room.phase === 'playing' && turns++ < 150) {
    room = resolvePendingVictory(firstPlay(room), 10_000);
    assert.equal(allCards(room).length, DECK_SIZE);
    assert.equal(new Set(allCards(room).map((c) => c.id)).size, DECK_SIZE);
  }
  assert.equal(room.phase, 'finished');
  assert.equal(room.players.find((p) => p.id === room.game.winnerId).hand.length, 0);
});
