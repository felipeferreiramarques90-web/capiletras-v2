import test from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGE_RULES, DECK_SIZE } from '../game/config.js';
import { createDeck, createRoom, updateSettings, joinRoom, startGame, playCard, drawCard, skipTurn,
  roomView, disconnectPlayer, returnToLobby } from '../game/game.js';
import { startChallenge, previewChallenge, confirmChallenge, voteChallenge, loseChallenge, resolveChallenge } from '../game/challenge.js';

const random = () => 0.375;
const now = 100_000;
function fixture(count = 3) {
  let room = createRoom({ code: 'ABC234', playerId: 'p1', sessionId: 's1', name: 'Ana', now });
  room = updateSettings(room, 'p1', { playerCount: count, initialCards: 3 });
  for (let i = 1; i < count; i++) room = joinRoom(room, { playerId: `p${i + 1}`, sessionId: `s${i + 1}`, name: ['Ana', 'Bia', 'Caio', 'Dani', 'Eva', 'Fábio', 'Gui', 'Hugo'][i] });
  room = startGame(room, 'p1', random);
  const cards = createDeck();
  room.players.forEach((p, i) => { p.hand = cards.splice(0, 3); });
  Object.assign(room.game, { deck: cards, discard: [], word: 'CA', lastLetterPlayerId: 'p1', lastPlayerId: 'p1',
    turnPlayerId: 'p2', blockedLetter: 'K', letterDebt: { count: 0, playerId: null },
    drawsThisTurn: 1, extraTurns: ['p3'] });
  return room;
}
function hand(room, id, ids) {
  const cards = createDeck();
  room.players.find((p) => p.id === id).hand = ids.map((id) => cards.find((c) => c.id === id));
}
const begin = (room = fixture(), id = 'p2') => startChallenge(room, id, now);
const confirm = (room, letters = '', at = now + 1000) => confirmChallenge(room, 'p1', room.game.challenge.id, letters, at, random);
const vote = (room, id, value, at = now + 2000) => voteChallenge(room, id, room.game.challenge.id, value, at, random);
const concede = (room, at = now + 3000) => loseChallenge(room, 'p1', room.game.challenge.id, at, random);
const assertUnchanged = (room, operation, pattern) => {
  const before = structuredClone(room);
  assert.throws(operation, pattern);
  assert.deepEqual(room, before);
};
function assertReset(room, before, penalizedId) {
  assert.equal(room.game.challenge, null);
  assert.equal(room.game.word, '');
  assert.equal(room.game.lastLetterPlayerId, null);
  assert.equal(room.game.blockedLetter, null);
  assert.equal(room.game.protectedPlayerId, null);
  assert.deepEqual(room.game.letterDebt, { count: 0, playerId: null });

  assert.equal(room.game.turnPlayerId, before.game.turnPlayerId);
  assert.equal(room.game.turnNumber, before.game.turnNumber);
  assert.equal(room.game.drawsThisTurn, before.game.drawsThisTurn);
  assert.deepEqual(room.game.extraTurns, before.game.extraTurns);
  const p = room.players.find((p) => p.id === penalizedId);
  assert.equal(p.hand.length, before.players.find((p) => p.id === penalizedId).hand.length + 4);
  assertUnchanged(room, () => startChallenge(room, 'p2', now + 60_000), /vazia/);
  assert.equal(roomView(room, 'p1').game.canSkipTurn, false, 'Último jogador não ganha direito ao botão da mesa');
  assert.deepEqual(JSON.parse(JSON.stringify(room)), room);
}

test('desafio não altera o baralho de 84 cartas e tem tempos/limites em constantes', () => {
  assert.equal(DECK_SIZE, 84);
  assert.equal(createDeck().length, 84);
  assert.equal(CHALLENGE_RULES.completionMs, 30_000);
  assert.equal(CHALLENGE_RULES.voteMs, 15_000);
  assert.equal(Object.hasOwn(CHALLENGE_RULES, 'lossMs'), false);
  assert.equal(CHALLENGE_RULES.maxLetters, 16);
});

for (const count of [1, 2, 5]) {
  test(`débito de ${count} letra(s) impede qualquer participante de desafiar sem alterar estado`, () => {
    const room = fixture();
    room.game.letterDebt = { count, playerId: 'p2' };
    for (const p of room.players) assertUnchanged(room, () => startChallenge(room, p.id, now),
      new RegExp(`Não dá para duvidar: Bia ainda deve ${count} letra`));
  });
}

test('pagamento do débito libera um desafio normal contra quem adicionou as novas letras', () => {
  const room = fixture();
  room.game.letterDebt = { count: 2, playerId: 'p2' };
  hand(room, 'p2', ['letra-D', 'letra-E']);
  const paid = playCard(room, 'p2', 'letra-D', undefined, undefined, 'AB');
  assert.equal(paid.game.letterDebt.count, 0);
  assert.equal(paid.game.word, 'CAABD');
  assert.equal(startChallenge(paid, 'p1', now).game.challenge.challengedId, 'p2');
});

test('2x transfere o débito ao jogador forçado e continua impedindo o desafio para todos', () => {
  const room = fixture();
  room.game.letterDebt = { count: 3, playerId: 'p2' };
  hand(room, 'p2', ['double-0', 'letra-E']);
  const forced = playCard(room, 'p2', 'double-0');
  assert.deepEqual(forced.game.letterDebt, { count: 3, playerId: 'p1' });
  for (const p of forced.players) assertUnchanged(forced, () => startChallenge(forced, p.id, now), /Ana ainda deve 3 letras/);
});

for (const [cardId, letter] of [['letra-B'], ['wild-0', 'Z'], ['vowel-0', 'E'], ['consonant-0', 'Z'], ['first-0', 'M'], ['last-0', 'Z'], ['swap-0', 'C'], ['block-0', 'E'], ['life-0', 'E'], ['multi-0', 'BA']]) {
  test(`último autor do visor é atualizado por ${cardId}, inclusive com pagamento`, () => {
    for (const debt of [0, 2]) {
      const room = fixture();
      room.game.letterDebt = { count: debt, playerId: debt ? 'p2' : null };
      hand(room, 'p2', [cardId, 'letra-Z']);
      const next = playCard(room, 'p2', cardId, letter, 'X', debt ? 'AB' : '');
      assert.equal(next.game.lastLetterPlayerId, 'p2');
      if (cardId === 'life-0') assertUnchanged(next, () => startChallenge(next, 'p3', now), /protegido pela Vida/);
      else assert.equal(startChallenge(next, 'p3', now).game.challenge.challengedId, 'p2');
    }
  });
}

test('Passar letra mantém o autor, mas impede desafio; 2x sem débito preserva o desafiado', () => {
  let room = fixture();
  room.game.protectedPlayerId = 'p1';
  hand(room, 'p2', ['pass-0', 'letra-Z']);
  room = playCard(room, 'p2', 'pass-0');
  assert.equal(room.game.lastLetterPlayerId, 'p1');
  assert.equal(room.game.protectedPlayerId, null);
  assertUnchanged(room, () => startChallenge(room, 'p2', now), /ainda deve 1 letra/);
  room = fixture();
  hand(room, 'p2', ['double-0', 'letra-Y']);
  room = playCard(room, 'p2', 'double-0');
  assert.equal(room.game.lastLetterPlayerId, 'p1');
  assert.equal(startChallenge(room, 'p2', now).game.challenge.challengedId, 'p1');
});

test('rejeita visor vazio, próprio autor, Vida, fim de jogo e segundo desafio sem mutações', () => {
  const empty = fixture(); empty.game.word = '';
  assertUnchanged(empty, () => begin(empty), /vazia/);
  const self = fixture(); assertUnchanged(self, () => begin(self, 'p1'), /própria/);
  const life = fixture(); life.game.protectedPlayerId = 'p1';
  assertUnchanged(life, () => begin(life), /Ana está protegido pela Vida/);
  const finished = fixture(); finished.phase = 'finished';
  assertUnchanged(finished, () => begin(finished), /andamento/);
  const first = begin();
  assertUnchanged(first, () => begin(first, 'p3'), /Já existe/);
  assert.equal(first.game.challenge.challengerId, 'p2');
});

test('desafio congela compras, jogadas, PERDI e versões anteriores, sem retirar carta da mão', () => {
  const original = fixture(), room = begin(original);
  assert.deepEqual(room.players, original.players);
  assert.equal(room.game.challenge.completionDeadline, now + 30_000);
  assertUnchanged(room, () => drawCard(room, 'p2', random), /desafio/);
  assertUnchanged(room, () => playCard(room, 'p2', room.players[1].hand[0].id), /desafio/);
  assertUnchanged(room, () => skipTurn(room, 'p1', random), /desafio/);
  for (const p of room.players) {
    const view = roomView(room, p.id);
    assert.equal(view.game.canDraw, false);
    assert.equal(view.game.canPlay, false);
    assert.equal(view.game.canSkipTurn, false);
  }
  const reset = concede(room);
  assertUnchanged(reset, () => playCard(reset, 'p2', reset.players[1].hand[0].id, undefined, undefined, '', original.game.version), /mesa mudou/);
});

test('prévia livre, maiúscula e em tempo real não consome Bloqueio e mantém débito zerado', () => {
  const room = begin();
  const preview = previewChallenge(room, 'p1', room.game.challenge.id, 'kz', now + 100);
  assert.equal(preview.game.challenge.addedLetters, 'KZ');
  assert.equal(preview.game.word, 'CA');
  assert.equal(preview.game.blockedLetter, 'K');
  assert.equal(preview.game.letterDebt.count, 0);
  assert.equal(roomView(preview, 'p3').game.challenge.addedLetters, 'KZ');
  assertUnchanged(room, () => previewChallenge(room, 'p3', room.game.challenge.id, 'Z', now), /Só o desafiado/);
});

test('OK aceita zero a 16 letras, normaliza e só Y confirma; entradas inválidas não mudam nada', () => {
  for (const letters of ['', 'to', 'a'.repeat(16)]) {
    const room = begin(), next = confirm(room, letters);
    assert.equal(next.game.word, `CA${letters.toUpperCase()}`);
    assert.equal(next.game.challenge.phase, 'votando');
    assert.equal(next.game.challenge.voteDeadline, now + 16_000);
    assert.equal(next.game.blockedLetter, 'K');
  }
  for (const letters of ['A'.repeat(17), 'A B', 'Á', '1', '!', 'ß', null, undefined, {}]) {
    const room = begin();
    assertUnchanged(room, () => confirmChallenge(room, 'p1', room.game.challenge.id, letters, now + 1000, random));
  }
  const room = begin();
  assertUnchanged(room, () => confirmChallenge(room, 'p2', room.game.challenge.id, '', now, random), /Só o desafiado/);
});

test('PERDI no modal compra 4 e faz reset total sem mudar vez nem contador de compra', () => {
  const room = begin();
  room.game.protectedPlayerId = 'p3';
  // Simula desafio salvo antes da restrição de início, para preservar o reset legado.
  room.game.letterDebt = { count: 2, playerId: 'p2' };
  const preview = previewChallenge(room, 'p1', room.game.challenge.id, 'TO', now + 100);
  assertUnchanged(preview, () => loseChallenge(preview, 'p2', preview.game.challenge.id, now + 200, random), /Só o desafiado/);
  const next = concede(preview);
  assertReset(next, preview, 'p1');
  assert.equal(next.game.challengeResult.word, 'CATO');
  assert.equal(next.game.challengeResult.reason, 'desistencia');
});

test('aos 30s aplica PERDI imediato, descarta letras digitadas e não cria prazo extra', () => {
  const initial = begin(), id = initial.game.challenge.id;
  const room = previewChallenge(initial, 'p1', id, 'TO', now + 100);
  assertUnchanged(room, () => confirm(room, 'TO', now + 30_000), /prazo/);
  assertUnchanged(room, () => previewChallenge(room, 'p1', id, 'TO', now + 30_000), /prazo/);
  assert.equal(resolveChallenge(room, now + 29_999, random), room);
  const next = resolveChallenge(room, now + 30_000, random);
  assertReset(next, room, 'p1');
  assert.equal(next.game.challengeResult.word, 'CA');
  assert.equal(next.game.challengeResult.automatic, true);
  assert.equal(Object.hasOwn(initial.game.challenge, 'lossDeadline'), false);
});

test('Y não vota; voto único, opções, id do desafio e prazos são validados', () => {
  const room = confirm(begin(fixture(4)));
  assertUnchanged(room, () => vote(room, 'p1', 'sim'), /não vota/);
  assertUnchanged(room, () => vote(room, 'p2', true), /Escolha/);
  assertUnchanged(room, () => voteChallenge(room, 'p2', -1, 'sim', now, random), /terminou/);
  assertUnchanged(room, () => vote(room, 'p2', 'nao', room.game.challenge.voteDeadline), /terminou/);
  const voted = vote(room, 'p2', 'nao');
  assertUnchanged(voted, () => vote(voted, 'p2', 'sim'), /já respondeu/);
  assertUnchanged(voted, () => concede(voted), /resultado/);
  for (const p of voted.players) {
    const view = roomView(voted, p.id);
    assert.equal(view.game.challenge.respondedCount, 1);
    assert.equal(view.game.challenge.voterCount, 3);
    assert.equal(Object.hasOwn(view.game.challenge, 'votes'), false);
    assert.equal(Object.hasOwn(view.game.challenge, 'tally'), false);
    assert.ok(view.players.every((other) => !other.hand && !other.sessionId));
  }
});

for (const [count, no, rejected] of [[7, 3, true], [8, 4, true], [8, 3, false], [3, 1, true], [4, 1, false], [2, 1, true], [2, 0, false]]) {
  test(`votação com ${count - 1} votante(s) e ${no} Não: ${rejected ? 'recusa automática' : 'aceita'}`, () => {
    let room = confirm(begin(fixture(count)), 'TO');
    const before = structuredClone(room);
    for (let i = 2; i <= count && room.game.challenge; i++) room = vote(room, `p${i}`, i - 2 < no ? 'nao' : 'sim');
    assertReset(room, before, rejected ? 'p1' : 'p2');
    assert.equal(room.game.challengeResult.tally.rejected, rejected);
    assert.equal(room.game.challengeResult.tally.no, no);
    assert.equal(room.game.challengeResult.automatic, rejected);
  });
}

test('3 Não de 6 recusam imediatamente, dispensam os pendentes e ignoram votos tardios', () => {
  let room = confirm(begin(fixture(7)), 'TO');
  const before = structuredClone(room), id = room.game.challenge.id;
  room = vote(vote(vote(room, 'p2', 'nao'), 'p3', 'nao'), 'p4', 'nao');
  assertReset(room, before, 'p1');
  assert.deepEqual(room.game.challengeResult.tally, { yes: 0, no: 3, total: 6, pending: 3, early: true, rejected: true });
  assert.match(room.notice, /encerrada antecipadamente/);
  assert.equal(voteChallenge(room, 'p5', id, 'sim', now + 3000, random), room);
  assert.equal(voteChallenge(room, 'p2', id, 'sim', now + 3000, random), room);
  assertUnchanged(room, () => voteChallenge(room, 'p1', id, 'sim', now + 3000, random), /não vota/);
});

test('3 Sim e 3 pendentes ainda são incertos; o quarto Sim aceita antecipadamente', () => {
  let room = confirm(begin(fixture(7)), 'TO');
  const before = structuredClone(room), id = room.game.challenge.id;
  room = vote(vote(vote(room, 'p2', 'sim'), 'p3', 'sim'), 'p4', 'sim');
  assert.equal(room.game.challenge.phase, 'votando');
  assert.equal(Object.keys(room.game.challenge.votes).length, 3);
  assert.equal(room.game.challenge.tally, null);
  room.game.protectedPlayerId = 'p7';
  room = vote(room, 'p5', 'sim');
  assertReset(room, before, 'p2');
  assert.deepEqual(room.game.challengeResult.tally, { yes: 4, no: 0, total: 6, pending: 2, early: true, rejected: false });
  assert.equal(room.game.challengeResult.word, 'CATO');
  assert.equal(voteChallenge(room, 'p6', id, 'nao', now + 3000, random), room);
});

test('desconectados sem voto contam Sim na hora e podem definir o resultado', () => {
  let room = confirm(begin(fixture(7)));
  room = vote(vote(vote(room, 'p2', 'sim'), 'p3', 'sim'), 'p4', 'sim');
  room = resolveChallenge(disconnectPlayer(room, 'p5', now + 2000), now + 2000, random);
  assert.equal(room.game.challenge, null);
  assert.equal(room.game.challengeResult.votes.p5, 'sim');
  assert.equal(room.game.challengeResult.tally.yes, 4);
  assert.equal(room.game.challengeResult.tally.pending, 2);
});

test('15 segundos continuam como limite: não respondidos viram Sim', () => {
  let room = confirm(begin(fixture(4)), 'TO');
  const deadline = room.game.challenge.voteDeadline, before = structuredClone(room);
  room = vote(room, 'p2', 'nao');
  assert.equal(resolveChallenge(room, deadline - 1, random), room);
  room = resolveChallenge(room, deadline, random);
  assertReset(room, before, 'p2');
  assert.deepEqual(room.game.challengeResult.votes, { p2: 'nao', p3: 'sim', p4: 'sim' });
  assert.equal(room.game.challengeResult.tally.early, false);
});

test('N=2: um Sim espera; um Não recusa; dois Sim aceitam', () => {
  const room = confirm(begin());
  assert.equal(vote(room, 'p2', 'sim').game.challenge.phase, 'votando');
  assert.equal(vote(room, 'p2', 'nao').game.challengeResult.reason, 'recusada');
  assert.equal(vote(vote(room, 'p2', 'sim'), 'p3', 'sim').game.challengeResult.reason, 'aceita');
});

test('desconexão de Y aplica PERDI imediatamente ao completar ou votar, mantendo a vez', () => {
  for (const initial of [begin(), confirm(begin())]) {
    initial.game.turnPlayerId = 'p1';
    const offline = disconnectPlayer(initial, 'p1', now + 2500);
    const next = resolveChallenge(offline, now + 2500, random);
    assertReset(next, initial, 'p1');
    assert.equal(next.game.challengeResult.reason, 'desconexao');
  }
});

test('turno de outro jogador que desconecta no desafio fica preservado; anfitrião pode encerrar a pausa', () => {
  const before = begin(fixture(4));
  const offline = disconnectPlayer(before, 'p2', now + 1000, true);
  assert.equal(offline.game.turnPlayerId, 'p2');
  const reset = concede(offline);
  assert.equal(reset.game.turnPlayerId, 'p2');
  assert.equal(roomView(reset, 'p3').game.paused, true);
  assert.equal(returnToLobby(reset, 'p1').phase, 'lobby');
});

test('aceitação reembaralha descarte e compra só as cartas que existirem', () => {
  for (const available of [0, 2, 4]) {
    let room = confirm(begin(fixture(2)));
    room.game.deck = [];
    room.game.discard = createDeck().slice(-available || createDeck().length);
    const before = room.players[1].hand.length;
    room = vote(room, 'p2', 'sim');
    assert.equal(room.players[1].hand.length, before + available);
    assert.equal(room.game.challengeResult.drawnCount, available);
  }
});

test('restauração JSON resolve prazos vencidos sem mais dez segundos e migra a antiga fase de PERDI', () => {
  const saved = JSON.parse(JSON.stringify(begin()));
  assertReset(resolveChallenge(saved, now + 30_000, random), saved, 'p1');
  const voting = JSON.parse(JSON.stringify(confirm(begin(), 'TO')));
  assertReset(resolveChallenge(voting, now + 16_000, random), voting, 'p2');
  const legacy = begin();
  Object.assign(legacy.game.challenge, { phase: 'perdi', reason: 'recusada', lossDeadline: now + 99_000 });
  const resolved = resolveChallenge(legacy, now + 1, random);
  assertReset(resolved, legacy, 'p1');
  assert.equal(resolved.game.challengeResult.reason, 'recusada');
  const completing = begin();
  const legacyTimeout = previewChallenge(completing, 'p1', completing.game.challenge.id, 'TO', now + 100);
  Object.assign(legacyTimeout.game.challenge, { phase: 'perdi', reason: 'prazo', lossDeadline: now + 99_000 });
  assert.equal(resolveChallenge(legacyTimeout, now + 30_000, random).game.challengeResult.word, 'CA');
  const oldCompleting = begin();
  oldCompleting.game.challenge.lossDeadline = null;
  const migrated = resolveChallenge(oldCompleting, now + 1, random);
  assert.equal(Object.hasOwn(migrated.game.challenge, 'lossDeadline'), false);
});
