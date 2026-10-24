import { compositionForHands } from './helpers/composition.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../game/config.js';
import { createDeck, createRoom, updateSettings, joinRoom, startGame, playCard, drawCard, skipTurn,
  canSkipTurn, roomView, isCardPlayable, disconnectPlayer } from '../game/game.js';
import { acceptVictory, resolvePendingVictory } from '../game/victory.js';
import { startChallenge, confirmChallenge, voteChallenge, loseChallenge, resolveChallenge } from '../game/challenge.js';

const random = () => 0.375, now = 1000;
function fixture(hands = [['letra-K'], ['letra-B', 'letra-C'], ['letra-D', 'letra-E']]) {
  let room = createRoom({ code: 'ABC234', playerId: 'p1', sessionId: 's1', name: 'Ana', now });
  room = updateSettings(room, 'p1', { playerCount: hands.length, initialCards: 3 });
  for (let i = 1; i < hands.length; i++) room = joinRoom(room, { playerId: `p${i + 1}`, sessionId: `s${i + 1}`, name: ['Ana', 'Bia', 'Caio'][i] });
  room = startGame(room, 'p1', random);
  room.settings.deckComposition = compositionForHands(hands);
  const cards = createDeck(room.settings.deckComposition), used = new Set(hands.flat());
  room.players.forEach((p, i) => { p.hand = hands[i].map((id) => cards.find((c) => c.id === id)); });
  Object.assign(room.game, { deck: cards.filter((c) => !used.has(c.id)), word: 'CA', blockedLetter: 'K', lastPlayerId: 'p3', lastLetterPlayerId: 'p3' });
  return room;
}
const play = (room, id, letter, blocked, payment) => playCard(room, room.game.turnPlayerId, id, letter, blocked, payment, room.game.version, now);
function unchanged(room, operation, pattern) {
  const before = structuredClone(room);
  assert.throws(operation, pattern);
  assert.deepEqual(room, before);
}
function pending() { return play(fixture([['letra-A'], ['letra-B', 'letra-C'], ['letra-D', 'letra-E']]), 'letra-A'); }
function voting() {
  const room = startChallenge(pending(), 'p2', now + 100);
  return confirmChallenge(room, 'p1', room.game.challenge.id, 'TO', now + 200, random);
}

test('exige compra prévia, rejeita sem mutações e habilita só se continuar sem carta jogável', () => {
  const room = fixture([['swap-0'], ['letra-B']]);
  room.game.word = '';
  room.game.deck = createDeck().filter((c) => ['swap-1', 'swap-2'].includes(c.id));
  assert.equal(canSkipTurn(room, 'p1'), false);
  unchanged(room, () => skipTurn(room, 'p1', random), /Compre uma carta primeiro/);
  const drawn = drawCard(room, 'p1', random);
  assert.equal(drawn.game.drawsThisTurn, 1);
  assert.equal(canSkipTurn(drawn, 'p1'), true);
  assert.equal(drawn.game.deck.length, 1, 'a compra é exigida mesmo quando ainda há outras cartas');
});

test('sem compra nem descarte a mão injogável pode passar sem comprar; descarte disponível exige compra', () => {
  const room = fixture();
  room.game.deck = [];
  room.game.discard = [{ id: 'swap-0', type: 'swap' }];
  assert.equal(canSkipTurn(room, 'p1'), false);
  room.game.discard = [];
  assert.equal(canSkipTurn(room, 'p1'), true);
  assert.doesNotThrow(() => skipTurn(room, 'p1', random));
});

test('novo turno normal, forçado pelo 2x e retorno zeram a compra exigida para passar', () => {
  const normal = fixture([['letra-A', 'letra-B'], ['swap-0'], ['letra-C']]);
  normal.game.drawsThisTurn = 1;
  assert.equal(play(normal, 'letra-A').game.drawsThisTurn, 0);
  const room = fixture([['swap-0'], ['double-0', 'letra-B'], ['letra-C']]);
  Object.assign(room.game, { word: '', lastPlayerId: 'p1', turnPlayerId: 'p2', drawsThisTurn: 1 });
  const extra = room.game.deck.findIndex((c) => c.id === 'swap-1');
  room.game.deck.push(...room.game.deck.splice(extra, 1));
  const forced = play(room, 'double-0');
  assert.equal(forced.game.turnPlayerId, 'p1');
  assert.equal(forced.game.drawsThisTurn, 0);
  assert.equal(canSkipTurn(forced, 'p1'), false);
  unchanged(forced, () => skipTurn(forced, 'p1', random), /Compre uma carta primeiro/);
  const drawn = drawCard(forced, 'p1', random);
  assert.equal(canSkipTurn(drawn, 'p1'), true);
  const returned = skipTurn(drawn, 'p1', random);
  assert.equal(returned.game.turnPlayerId, 'p2');
  assert.equal(returned.game.drawsThisTurn, 0);
});

test('Não consigo jogar: só a vez com mão não vazia e nenhuma carta jogável, sem proteção da Vida', () => {
  const room = fixture();
  room.game.drawsThisTurn = 1;
  assert.equal(canSkipTurn(room, 'p1'), true);
  assert.equal(canSkipTurn(room, 'p2'), false);
  unchanged(room, () => skipTurn(room, 'p2', random), /jogador da vez/);
  room.game.protectedPlayerId = 'p1';
  assert.equal(canSkipTurn(room, 'p1'), true);
  assert.doesNotThrow(() => skipTurn(room, 'p1', random));
  room.players[0].hand = [];
  assert.equal(canSkipTurn(room, 'p1'), false);
});

for (const id of ['letra-A', 'pass-0', 'life-0']) test(`${id} jogável impede Não consigo jogar`, () => {
  const room = fixture([[id, 'letra-K'], ['letra-B']]);
  room.game.drawsThisTurn = 1;
  assert.equal(canSkipTurn(room, 'p1'), false);
  unchanged(room, () => skipTurn(room, 'p1', random), /sem carta jogável/);
});

test('compra opcional jogável desabilita o botão; compra injogável mantém habilitado', () => {
  for (const id of ['letra-A', 'swap-0']) {
    const room = fixture([['swap-1'], ['letra-B']]);
    room.game.word = '';
    room.game.deck = createDeck().filter((c) => c.id === id);
    const next = drawCard(room, 'p1', random);
    assert.equal(canSkipTurn(next, 'p1'), id !== 'letra-A');
    assert.equal(next.game.turnPlayerId, 'p1');
  }
});

test('compra 4, zera a mesa e perde a vez mesmo recebendo cartas jogáveis; 2x perde o histórico', () => {
  const room = fixture();
  room.game.drawsThisTurn = 1;
  const next = skipTurn(room, 'p1', random);
  assert.equal(next.players[0].hand.length, 5);
  assert.equal(next.game.turnPlayerId, 'p2');
  assert.equal(next.game.word, '');
  assert.equal(next.game.blockedLetter, null);
  assert.equal(next.game.letterDebt.count, 0);
  assert.equal(next.game.lastPlayerId, null);
  assert.equal(next.game.lastLetterPlayerId, null);
  assert.equal(isCardPlayable({ type: 'double' }, next.game), false);
  assert.match(next.notice, /Ana não conseguiu jogar, comprou 4 cartas e perdeu a vez/);
});

test('perde a jogada forçada e devolve ao autor do 2x; compra opcional zera no novo turno', () => {
  const room = fixture();
  room.game.extraTurns = ['p2'];
  room.game.drawsThisTurn = 1;
  const next = skipTurn(room, 'p1', random);
  assert.equal(next.game.turnPlayerId, 'p2');
  assert.deepEqual(next.game.extraTurns, []);
  assert.equal(next.game.drawsThisTurn, 0);
});

test('sem compra nem descarte, passa a vez preservando o visor; com descarte reembaralha', () => {
  for (const count of [0, 2, 4]) {
    const room = fixture();
    room.game.drawsThisTurn = count ? 1 : 0;
    room.game.deck = [];
    room.game.discard = createDeck().filter((c) => c.id !== 'letra-K').slice(0, count);
    const next = skipTurn(room, 'p1', random);
    assert.equal(next.players[0].hand.length, 1 + count);
    assert.equal(next.game.word, count ? '' : 'CA');
    assert.equal(next.game.turnPlayerId, 'p2');
    assert.equal(next.game.blockedLetter, null);
    assert.equal(next.game.lastPlayerId, null);
  }
});

test('desafio e vitória pendente travam compra, jogada e Não consigo jogar para todos', () => {
  for (const room of [pending(), startChallenge(pending(), 'p2', now + 1)]) {
    for (const p of room.players) {
      const view = roomView(room, p.id);
      assert.equal(view.game.canSkipTurn, false);
      assert.equal(view.game.canPlay, false);
      assert.equal(view.game.canDraw, false);
      unchanged(room, () => skipTurn(room, p.id, random));
      unchanged(room, () => drawCard(room, p.id, random));
      unchanged(room, () => playCard(room, p.id, p.hand[0]?.id));
    }
  }
});

for (const [id, letter, blocked] of [['letra-A'], ['wild-0', 'B'], ['vowel-0', 'E'], ['consonant-0', 'B'], ['first-0', 'M'], ['last-0', 'Z'], ['swap-0', 'B'], ['block-0', 'B', 'X'], ['multi-0', 'AB']]) {
  test(`última ${id} aplica o efeito e abre vitória pendente de 10 segundos`, () => {
    const room = play(fixture([[id], ['letra-C'], ['letra-D']]), id, letter, blocked);
    assert.equal(room.phase, 'playing');
    assert.equal(room.game.winnerId, null);
    assert.equal(room.players[0].hand.length, 0);
    assert.equal(room.game.pendingVictory.playerId, 'p1');
    assert.equal(room.game.pendingVictory.deadline, now + RULES.victoryWindowMs);
    assert.equal(room.game.turnPlayerId, 'p1');
    assert.equal(room.game.discard.at(-1).id, id);
    assert.equal(room.game.lastLetterPlayerId, 'p1');
  });
}

for (const [id, letter] of [['life-0', 'E'], ['pass-0'], ['double-0']]) test(`última ${id} vence antes de qualquer efeito de turno`, () => {
  const original = fixture([[id], ['letra-C'], ['letra-D']]);
  const room = play(original, id, letter);
  assert.equal(room.phase, 'finished');
  assert.equal(room.game.winnerId, 'p1');
  assert.equal(room.game.pendingVictory, null);
  assert.equal(room.game.letterDebt.count, 0);
  assert.equal(room.game.turnNumber, original.game.turnNumber);
  assert.deepEqual(room.game.extraTurns, []);
  assert.equal(room.game.word, id === 'life-0' ? 'CAE' : 'CA');
  if (id === 'double-0') assert.doesNotMatch(room.notice, /joga de novo/);
});

test('última carta paga débito, mantém ordem das letras e pode ser duvidada', () => {
  const original = fixture([['letra-K'], ['letra-C'], ['letra-D']]);
  original.game.letterDebt = { count: 2, playerId: 'p1' };
  const room = play(original, 'letra-K', undefined, undefined, 'AK');
  assert.equal(room.game.word, 'CAAKK');
  assert.equal(room.game.letterDebt.count, 0);
  assert.equal(startChallenge(room, 'p2', now + 1).game.challenge.challengedId, 'p1');
});

test('fim dos 10 segundos confirma a vitória e rejeita ações posteriores, preservando palavra final', () => {
  const room = pending();
  assert.equal(resolvePendingVictory(room, now + 9999), room);
  const next = resolvePendingVictory(room, now + 10_000);
  assert.equal(next.phase, 'finished');
  assert.equal(next.game.word, 'CAA');
  assert.equal(next.game.winnerId, 'p1');
  unchanged(next, () => startChallenge(next, 'p2', now + 10_000), /andamento/);
  unchanged(next, () => drawCard(next, 'p2', random), /andamento/);
  unchanged(next, () => skipTurn(next, 'p2', random), /andamento/);
  unchanged(next, () => playCard(next, 'p2', 'letra-B'), /andamento/);
});

test('aceite unânime antecipado, aceite único e desconectados aceitos automaticamente', () => {
  let room = pending();
  const id = room.game.pendingVictory.id;
  unchanged(room, () => acceptVictory(room, 'p1', id, now), /outros/);
  unchanged(room, () => acceptVictory(room, 'p2', -1, now));
  room = acceptVictory(room, 'p2', id, now + 1);
  assert.equal(room.phase, 'playing');
  unchanged(room, () => acceptVictory(room, 'p2', id, now + 1), /já aceitou/);
  assert.equal(acceptVictory(room, 'p3', id, now + 2).phase, 'finished');
  const offline = disconnectPlayer(pending(), 'p3', now + 1);
  const settled = resolvePendingVictory(offline, now + 1);
  assert.deepEqual(settled.game.pendingVictory.acceptedIds, ['p3']);
  assert.equal(acceptVictory(settled, 'p2', settled.game.pendingVictory.id, now + 2).phase, 'finished');
});

test('desafio substitui a janela: palavra aceita penaliza X e confirma vitória com palavra completa', () => {
  let room = voting();
  unchanged(room, () => acceptVictory(room, 'p2', room.game.pendingVictory.id, now + 300));
  assert.equal(resolvePendingVictory(room, now + 100_000), room, 'Prazo original fica suspenso durante desafio');
  room = voteChallenge(room, 'p2', room.game.challenge.id, 'sim', now + 300, random);
  room = voteChallenge(room, 'p3', room.game.challenge.id, 'sim', now + 400, random);
  assert.equal(room.phase, 'finished');
  assert.equal(room.game.winnerId, 'p1');
  assert.equal(room.players[1].hand.length, 6);
  assert.equal(room.game.word, 'CAATO');
  assert.equal(room.game.pendingVictory, null);
});

for (const mode of ['recusa automática', 'PERDI de Y', 'prazo de completar']) test(`${mode} cancela vitória, compra 4, reseta e passa a vez sem devolver carta`, () => {
  let room = mode === 'prazo de completar' || mode === 'PERDI de Y' ? startChallenge(pending(), 'p2', now + 100) : voting();
  const playedCardId = room.game.discard.at(-1).id;
  if (mode.startsWith('recusa')) {
    room = voteChallenge(room, 'p2', room.game.challenge.id, 'nao', now + 300, random);
  }
  if (mode === 'PERDI de Y') room = loseChallenge(room, 'p1', room.game.challenge.id, now + 500, random);
  else if (mode === 'prazo de completar') room = resolveChallenge(room, now + 30_100, random);
  assert.equal(room.phase, 'playing');
  assert.equal(room.game.pendingVictory, null);
  assert.equal(room.players[0].hand.length, 4);
  assert.ok(!room.players[0].hand.some((c) => c.id === playedCardId));
  assert.equal(room.game.word, '');
  assert.equal(room.game.letterDebt.count, 0);
  assert.equal(room.game.blockedLetter, null);
  assert.equal(room.game.protectedPlayerId, null);
  assert.equal(room.game.lastLetterPlayerId, null);
  assert.equal(room.game.turnPlayerId, 'p2');
});

test('restauração JSON com prazo vencido confirma vitória; desafio salvo não usa prazo antigo da janela', () => {
  const saved = JSON.parse(JSON.stringify(pending()));
  assert.equal(resolvePendingVictory(saved, now + 60_000).phase, 'finished');
  const challenged = JSON.parse(JSON.stringify(voting()));
  assert.equal(resolvePendingVictory(challenged, now + 60_000), challenged);
  const settled = resolveChallenge(challenged, now + 60_000, random);
  assert.equal(settled.phase, 'finished');
  assert.equal(settled.game.winnerId, 'p1');
});
