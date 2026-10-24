import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_TYPES, CONFIGURABLE_CARD_TYPES, DEFAULT_DECK_COMPOSITION, DECK_RULES, DECK_SIZE, RULES, deckSize, maxInitialCards } from '../game/config.js';
import { deckStartIssue, roomComposition } from '../game/deck.js';
import { createDeck, createRoom, joinRoom, updateSettings, updateDeckComposition, restoreDefaultComposition, startGame, returnToLobby, roomView, disconnectPlayer } from '../game/game.js';
import { addBot } from '../bots/players.js';
import { simulateMatch } from './helpers/simulation.js';

const random = () => .375;
const lobby = () => joinRoom(createRoom({ code: 'ABC234', playerId: 'h', sessionId: 's1', name: 'Ana', now: 0 }), { playerId: 'p2', sessionId: 's2', name: 'Bia' });
const allZero = Object.fromEntries(CONFIGURABLE_CARD_TYPES.map((type) => [type, 0]));
const countTypes = (cards) => Object.fromEntries(Object.keys(CARD_TYPES).map((type) => [type, cards.filter((card) => card.type === type).length]));
const allCards = (room) => [...room.game.deck, ...room.game.discard, ...room.players.flatMap((p) => p.hand)];
function rejectUnchanged(room, change, pattern) {
  const before = structuredClone(room);
  assert.throws(change, pattern);
  assert.deepEqual(room, before);
}

test('padrão deriva das constantes: 76 cartas, 30 fixas e Vida desativada', () => {
  assert.equal(DECK_SIZE, 76);
  assert.deepEqual(DEFAULT_DECK_COMPOSITION, { wild: 12, life: 0, pass: 8, swap: 6, block: 6, double: 6, multi: 4, sword: 4 });
  for (const type of CONFIGURABLE_CARD_TYPES) assert.equal(DEFAULT_DECK_COMPOSITION[type], CARD_TYPES[type].quantity);
  assert.equal(deckSize(allZero), 30);
  assert.deepEqual(roomComposition(lobby()), DEFAULT_DECK_COMPOSITION);
});

test('montagem personalizada conserva letras/restritivas, IDs únicos e todas as cartas ao distribuir', () => {
  const composition = { wild: 3, life: 0, pass: 2, swap: 7, block: 1, double: 4, multi: 9, sword: 2 };
  const deck = createDeck(composition, 2);
  assert.equal(deck.length, deckSize(composition, 2));
  assert.equal(new Set(deck.map((c) => c.id)).size, deck.length);
  const counts = countTypes(deck);
  for (const [type, rule] of Object.entries(CARD_TYPES)) assert.equal(counts[type], type === 'sword' ? 0 : composition[type] ?? rule.quantity);
  const room = startGame(updateDeckComposition(lobby(), 'h', composition), 'h', random);
  assert.deepEqual(countTypes(allCards(room)), counts);
  assert.equal(roomView(room, 'h').deckSize, deck.length);
  assert.ok(room.game.deck.length >= RULES.reservedDrawCards);
});

test('limites inteiros inclusivos por tipo, tipos desconhecidos e total máximo validados sem mutação', () => {
  const room = lobby();
  for (const type of CONFIGURABLE_CARD_TYPES) {
    for (const value of [DECK_RULES.minQuantity, DECK_RULES.maxQuantity]) {
      assert.equal(updateDeckComposition(room, 'h', { ...allZero, [type]: value }).settings.deckComposition[type], value);
    }
    for (const value of [-1, 31, 1.5, '2', NaN, Infinity, null, true]) {
      rejectUnchanged(room, () => updateDeckComposition(room, 'h', { ...DEFAULT_DECK_COMPOSITION, [type]: value }), /inteiras/);
    }
  }
  for (const composition of [null, [], {}, { ...DEFAULT_DECK_COMPOSITION, letter: 26 }, { ...DEFAULT_DECK_COMPOSITION, desconhecida: 1 }]) {
    rejectUnchanged(room, () => updateDeckComposition(room, 'h', composition), /tipos/);
  }
  const exactLimit = { ...allZero, wild: 30, life: 30, pass: 30, swap: 30 };
  assert.equal(deckSize(exactLimit), DECK_RULES.maxTotal);
  assert.equal(roomView(updateDeckComposition(room, 'h', exactLimit), 'h').deckSize, DECK_RULES.maxTotal);
  rejectUnchanged(room, () => updateDeckComposition(room, 'h', { ...exactLimit, block: 1 }), /no máximo/);
  assert.throws(() => createDeck({ ...exactLimit, block: 1 }), /no máximo/);
});

test('só anfitrião altera/restaura e apenas antes do início; restore mantém outros ajustes', () => {
  const room = lobby();
  rejectUnchanged(room, () => updateDeckComposition(room, 'p2', allZero), /anfitrião/);
  rejectUnchanged(room, () => restoreDefaultComposition(room, 'p2'), /anfitrião/);
  const playing = startGame(room, 'h', random);
  rejectUnchanged(playing, () => updateDeckComposition(playing, 'h', allZero), /começou/);
  rejectUnchanged(playing, () => restoreDefaultComposition(playing, 'h'), /começou/);
  let edited = updateSettings(updateDeckComposition(room, 'h', allZero), 'h', { playerCount: 2, initialCards: 8 });
  edited = restoreDefaultComposition(edited, 'h');
  assert.deepEqual(edited.settings.deckComposition, DEFAULT_DECK_COMPOSITION);
  assert.equal(edited.settings.initialCards, 8);
});

test('máximo inicial usa composição e participantes; composição menor ajusta a mão com aviso só ao anfitrião', () => {
  let room = updateSettings(lobby(), 'h', { playerCount: 2, initialCards: maxInitialCards(2) });
  room = updateDeckComposition(room, 'h', allZero);
  assert.equal(room.settings.initialCards, maxInitialCards(2, allZero));
  assert.match(roomView(room, 'h').settingsAdjustment.message, /ajustadas/);
  assert.equal(roomView(room, 'p2').settingsAdjustment, null);
  for (let players = 2; players <= RULES.maxPlayers; players++) {
    const updated = updateSettings(room, 'h', { playerCount: players, initialCards: room.settings.initialCards });
    const maximum = maxInitialCards(players, allZero);
    assert.equal(roomView(updated, 'h').settings.maxInitialCards, maximum);
    assert.equal(updated.settings.initialCards, Math.min(room.settings.initialCards, maximum));
    assert.ok(deckSize(allZero) - maximum * players >= RULES.reservedDrawCards);
  }
  room = updateSettings(room, 'h', { playerCount: 8, initialCards: room.settings.initialCards });
  assert.equal(room.settings.initialCards, 3);
  assert.match(roomView(room, 'h').settingsAdjustment.message, /ajustadas para 3/);
});

test('adicionar bots recalcula a mão pelo baralho escolhido, inclusive sem especiais', () => {
  let room = updateDeckComposition(lobby(), 'h', allZero);
  room = updateSettings(room, 'h', { playerCount: 2, initialCards: 14 });
  for (let i = 2; i < 8; i++) room = addBot(room, 'h', `b${i}`);
  assert.equal(room.settings.initialCards, maxInitialCards(8, allZero));
  assert.equal(allCards(startGame(room, 'h', random)).length, deckSize(allZero));
});

test('início rejeita estado inválido e falta de reserva sem mutação, com motivo público', () => {
  for (const corrupt of [
    { ...lobby(), settings: { ...lobby().settings, initialCards: maxInitialCards(2) + 1 } },
    { ...lobby(), settings: { ...lobby().settings, deckComposition: Object.fromEntries(CONFIGURABLE_CARD_TYPES.map((type) => [type, 30])) } },
  ]) {
    assert.ok(deckStartIssue(corrupt));
    assert.equal(roomView(corrupt, 'h').startIssue, deckStartIssue(corrupt));
    rejectUnchanged(corrupt, () => startGame(corrupt, 'h', random));
  }
});

test('composição persiste no jogar de novo, retorno à sala e serialização JSON; sala antiga usa padrão', () => {
  let room = startGame(updateDeckComposition(lobby(), 'h', allZero), 'h', random);
  room.phase = 'finished'; room.game.winnerId = 'h';
  let replay = startGame(room, 'h', random);
  assert.deepEqual(replay.settings.deckComposition, allZero);
  assert.equal(allCards(replay).length, deckSize(allZero));
  replay = disconnectPlayer(replay, 'p2', 100);
  replay = returnToLobby(replay, 'h');
  assert.deepEqual(replay.settings.deckComposition, allZero);
  assert.deepEqual(JSON.parse(JSON.stringify(replay)), replay);
  const old = lobby(); delete old.settings.deckComposition;
  assert.equal(roomView(old, 'h').deckSize, deckSize(undefined, 2));
  assert.equal(allCards(startGame(old, 'h', random)).length, deckSize(undefined, 2));
});

for (const type of [...CONFIGURABLE_CARD_TYPES, 'todos']) {
  test(`${type} em zero: simulação completa com um humano e três bots termina e conserva o baralho`, () => {
    const composition = type === 'todos' ? allZero : { ...DEFAULT_DECK_COMPOSITION, [type]: 0 };
    const room = simulateMatch(composition, 417 + CONFIGURABLE_CARD_TYPES.indexOf(type));
    assert.equal(room.phase, 'finished');
    assert.equal(allCards(room).length, deckSize(composition));
    if (type === 'todos') assert.ok(allCards(room).every((c) => !CONFIGURABLE_CARD_TYPES.includes(c.type)));
    else assert.ok(allCards(room).every((c) => c.type !== type));
  });
}

test('mão inicial padrão é 7 e ajusta ao reduzir o baralho ou aumentar a turma', () => {
  const original = lobby();
  assert.equal(RULES.defaultHand, 7);
  assert.equal(original.settings.initialCards, 7);
  const eight = updateSettings(original, 'h', { playerCount: 8, initialCards: original.settings.initialCards });
  assert.equal(eight.settings.initialCards, 7, '7 cabe no padrão de 76 com oito jogadores');
  const reduced = updateDeckComposition(eight, 'h', allZero);
  assert.equal(reduced.settings.initialCards, maxInitialCards(8, allZero));
  assert.match(roomView(reduced, 'h').settingsAdjustment.message, /ajustadas para 3/);
  const smallerFirst = updateDeckComposition(original, 'h', allZero);
  assert.equal(smallerFirst.settings.initialCards, 7);
  assert.equal(updateSettings(smallerFirst, 'h', { playerCount: 8, initialCards: 7 }).settings.initialCards, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(reduced)), reduced);
});

test('baralho padrão de 76, sem Vida e mão de 7: partida com bots termina com estado serializável', () => {
  const room = simulateMatch(DEFAULT_DECK_COMPOSITION);
  assert.equal(room.settings.initialCards, 7);
  assert.equal(allCards(room).length, 76);
  assert.ok(allCards(room).every((card) => card.type !== 'life'));
  assert.equal(room.game.protectedPlayerId, null);
  assert.deepEqual(JSON.parse(JSON.stringify(room)), room);
});
