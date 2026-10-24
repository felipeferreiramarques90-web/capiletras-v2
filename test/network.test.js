import { compositionForHands } from './helpers/composition.js';
import { RULES, maxInitialCards } from '../game/config.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { io as client } from 'socket.io-client';
import { createApp } from '../server.js';
import { MemoryStorage } from '../storage/memory.js';
import { allowedLetters, createDeck } from '../game/game.js';
import { startChallenge, confirmChallenge } from '../game/challenge.js';

const waitFor = async (predicate) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('A atualização esperada não chegou.');
};
const emit = (socket, event, data = {}) => socket.timeout(3000).emitWithAck(event, ['game:skip', 'game:play'].includes(event) ? { version: socket.view?.game?.version, ...data } : data);

async function setup(t, options = {}) {
  const storage = new MemoryStorage();
  const { server, io } = createApp({ roomStorage: storage, cleanupIntervalMs: 50, randomSource: () => 0.375, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await new Promise((resolve) => io.close(resolve));
  });
  async function connect(sessionId = randomUUID()) {
    const socket = client(url, { transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false });
    socket.sessionId = sessionId;
    socket.on('room:state', (view) => { socket.view = view; });
    sockets.push(socket);
    socket.connect();
    await once(socket, 'connect');
    return socket;
  }
  const a = await connect();
  assert.equal((await emit(a, 'room:create', { sessionId: a.sessionId, name: 'Ana' })).ok, true);
  const code = a.view.code;
  const b = await connect();
  assert.equal((await emit(b, 'room:join', { sessionId: b.sessionId, name: 'Bia', code })).ok, true);
  await waitFor(() => a.view.players.length === 2);
  return { a, b, code, storage, url, connect, io };
}

test('HTTP: /health responde 200 e o mesmo servidor entrega o front-end e Socket.IO', async (t) => {
  const { url } = await setup(t);
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const html = await fetch(url);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /lang="pt-BR"/);
  assert.equal((await fetch(`${url}/socket.io/socket.io.js`)).status, 200);
  assert.equal((await fetch(`${url}/game/game.js`)).status, 404);
  const config = await (await fetch(`${url}/api/config`)).json();
  assert.equal(config.deckSize, 72);
  assert.equal(config.cardTypes.swap.quantity, 6);
  assert.equal(config.cardTypes.block.quantity, 6);
  assert.equal(config.cardTypes.double.quantity, 6);
  assert.equal(config.cardTypes.multi.quantity, 4);
  assert.equal(config.cardTypes.life.quantity, 0);
  assert.equal(config.cardTypes.pass.quantity, 8);
  assert.equal(config.cardTypes.life.letters, 'AEIOU');
  assert.equal(config.cardTypes.multi.minLetters, 2);
  assert.equal(config.cardTypes.multi.maxLetters, 16);
});

async function seedHands({ a, b, code, storage }, hands, game = {}) {
  assert.equal((await emit(a, 'room:deck', { composition: compositionForHands(hands) })).ok, true);
  assert.equal((await emit(a, 'game:start')).ok, true);
  const room = await storage.getRoom(code);
  const cards = createDeck(room.settings.deckComposition);
  const used = new Set(hands.flat());
  room.players.forEach((p, i) => { p.hand = hands[i].map((id) => cards.find((c) => c.id === id)); });
  Object.assign(room.game, { deck: cards.filter((c) => !used.has(c.id)), discard: [], ...game });
  await storage.saveRoom(room);
  // Retoma pela API real para enviar as visões privadas do cenário aos dois clientes.
  await emit(a, 'room:join', { code, name: 'Ana', sessionId: a.sessionId });
  await waitFor(() => b.view.game?.version === a.view.game.version);
  return room;
}

for (const outcome of ['recusa', 'aceitação', 'desconexão']) {
  test(`rede: votação encerra por ${outcome} antes de todos responderem e ignora votos tardios`, async (t) => {
    const fixture = await setup(t);
    const { a, b, code, connect, storage } = fixture;
    assert.equal((await emit(a, 'room:settings', { playerCount: 7, initialCards: 3 })).ok, true);
    const voters = [b];
    for (const name of ['Caio', 'Dora', 'Eva', 'Fábio', 'Gabi']) {
      const socket = await connect();
      assert.equal((await emit(socket, 'room:join', { sessionId: socket.sessionId, name, code })).ok, true);
      voters.push(socket);
    }
    const hands = Array.from({ length: 7 }, (_, i) => [`letra-${'ABCDEFGHIJKLMN'[2 * i]}`, `letra-${'ABCDEFGHIJKLMN'[2 * i + 1]}`]);
    await seedHands(fixture, hands, { word: 'CA', lastLetterPlayerId: a.view.meId });
    assert.equal((await emit(b, 'challenge:start')).ok, true);
    const challengeId = a.view.game.challenge.id;
    assert.equal((await emit(a, 'challenge:confirm', { challengeId, letters: 'TO' })).ok, true);
    const vote = outcome === 'recusa' ? 'nao' : 'sim';
    for (const socket of voters.slice(0, 3)) assert.equal((await emit(socket, 'challenge:vote', { challengeId, vote })).ok, true);
    if (outcome !== 'recusa') {
      assert.equal(Object.hasOwn(a.view.game.challenge, 'respondedCount'), false);
      if (outcome === 'desconexão') {
        voters[3].disconnect();
        await waitFor(() => !a.view.game.challenge);
      } else assert.equal((await emit(voters[3], 'challenge:vote', { challengeId, vote: 'sim' })).ok, true);
    }
    await waitFor(() => !voters[5].view.game.challenge);
    const saved = await storage.getRoom(code);
    assert.equal(saved.game.challenge, null);
    assert.equal(saved.game.challengeResult.tally.early, true);
    assert.equal(saved.game.challengeResult.tally.rejected, outcome === 'recusa');
    assert.equal(a.view.notice, outcome === 'recusa' ? 'Palavra recusada' : 'Palavra aceita');
    assert.equal((await emit(voters[5], 'challenge:vote', { challengeId, vote: 'nao' })).ok, true);
    assert.deepEqual(await storage.getRoom(code), saved);
  });
}

for (const outcome of ['prazo', 'aceite', 'palavra aceita', 'palavra recusada', 'PERDI']) {
  test(`rede: última carta e ${outcome} resolvem a vitória pendente com persistência e mãos privadas`, async (t) => {
    let clock = Date.now();
    const fixture = await setup(t, { nowSource: () => clock, challengeIntervalMs: 5 });
    const { a, b, storage, code } = fixture;
    await seedHands(fixture, [['letra-A'], ['letra-B', 'letra-C']], { word: 'CA' });
    assert.equal((await emit(a, 'game:play', { cardId: 'letra-A' })).ok, true);
    await waitFor(() => Boolean(b.view.game.pendingVictory));
    assert.equal(a.view.phase, 'playing');
    assert.equal(a.view.hand.length, 0);
    assert.equal(b.view.game.canPlay, false);
    const before = await storage.getRoom(code), pendingId = a.view.game.pendingVictory.id;
    for (const [event, data] of [['game:play', { cardId: 'letra-B' }], ['game:draw', {}], ['game:skip', {}]]) {
      assert.equal((await emit(b, event, data)).ok, false);
      assert.deepEqual(await storage.getRoom(code), before);
    }
    assert.equal((await emit(a, 'victory:accept', { pendingId })).ok, false);
    if (outcome === 'prazo') {
      clock += 10_000;
      await waitFor(() => b.view.phase === 'finished');
    } else if (outcome === 'aceite') {
      assert.equal((await emit(b, 'victory:accept', { pendingId })).ok, true);
    } else {
      assert.equal((await emit(b, 'challenge:start')).ok, true);
      const challengeId = a.view.game.challenge.id;
      if (outcome !== 'PERDI') {
        assert.equal((await emit(a, 'challenge:confirm', { challengeId, letters: 'TO' })).ok, true);
        assert.equal((await emit(b, 'challenge:vote', { challengeId, vote: outcome === 'palavra aceita' ? 'sim' : 'nao' })).ok, true);
      }
      if (outcome === 'PERDI') assert.equal((await emit(a, 'challenge:lose', { challengeId })).ok, true);
    }
    const saved = await storage.getRoom(code);
    assert.equal(saved.game.pendingVictory, null);
    assert.ok(b.view.players.every((p) => !p.hand && !p.sessionId));
    if (outcome === 'palavra recusada' || outcome === 'PERDI') {
      assert.equal(saved.phase, 'playing');
      assert.equal(saved.game.word, '');
      assert.equal(saved.players[0].hand.length, 4);
      assert.equal(saved.game.turnPlayerId, b.view.meId);
    } else {
      assert.equal(saved.phase, 'finished');
      assert.equal(saved.game.winnerId, a.view.meId);
      assert.equal(saved.game.word, outcome === 'palavra aceita' ? 'CAATO' : 'CAA');
      assert.equal((await emit(b, 'challenge:start')).ok, false);
    }
  });
}

test('rede: restaura vitória pendente vencida sem precisar de clientes conectados', async (t) => {
  const fixture = await setup(t);
  const { a, b, storage, code } = fixture;
  await seedHands(fixture, [['letra-A'], ['letra-B', 'letra-C']]);
  assert.equal((await emit(a, 'game:play', { cardId: 'letra-A' })).ok, true);
  const saved = await storage.getRoom(code);
  saved.game.pendingVictory.deadline = Date.now() - 1;
  const restored = new MemoryStorage();
  await restored.saveRoom(JSON.parse(JSON.stringify(saved)));
  const app = createApp({ roomStorage: restored, challengeIntervalMs: 5 });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => new Promise((resolve) => app.io.close(resolve)));
  await waitFor(async () => (await restored.getRoom(code)).phase === 'finished');
  assert.equal((await restored.getRoom(code)).game.winnerId, a.view.meId);
});

test('rede: débito impede desafio com aviso privado e sem gravações, até ser pago', async (t) => {
  const fixture = await setup(t);
  const { a, b, storage, code } = fixture;
  await seedHands(fixture, [['pass-0', 'letra-A', 'letra-B'], ['pass-1', 'letra-C', 'letra-D']], {
    word: 'CA', lastLetterPlayerId: a.view.meId,
  });
  const updates = [];
  a.on('room:state', () => updates.push('a'));
  b.on('room:state', () => updates.push('b'));
  for (const [socket, cardId, count, name] of [[a, 'pass-0', 1, 'Bia'], [b, 'pass-1', 2, 'Ana']]) {
    assert.equal((await emit(socket, 'game:play', { cardId })).ok, true);
    await waitFor(() => a.view.game.letterDebt.count === count && b.view.game.letterDebt.count === count);
    const before = await storage.getRoom(code), received = updates.length;
    const reply = await emit(socket === a ? b : a, 'challenge:start');
    assert.equal(reply.ok, false);
    assert.match(reply.error, new RegExp(`${name} ainda deve ${count} letra`));
    assert.deepEqual(await storage.getRoom(code), before);
    assert.equal(updates.length, received, 'Rejeição não deve publicar avisos nem novo estado aos outros jogadores');
  }
  assert.equal((await emit(a, 'game:play', { cardId: 'letra-A', accumulatedLetters: 'BC' })).ok, true);
  await waitFor(() => b.view.game.letterDebt.count === 0);
  assert.equal((await emit(b, 'challenge:start')).ok, true);
  assert.equal(b.view.game.challenge.challengedId, a.view.meId);
});

test('rede: primeiro desafio vence, cancela jogadas e transmite apenas voto próprio e resultado', async (t) => {
  const fixture = await setup(t);
  const { a, b, code, storage, connect } = fixture;
  assert.equal((await emit(a, 'room:settings', { playerCount: 3, initialCards: 3 })).ok, true);
  const c = await connect();
  assert.equal((await emit(c, 'room:join', { sessionId: c.sessionId, name: 'Caio', code })).ok, true);
  await seedHands(fixture, [['letra-A', 'letra-B'], ['wild-0', 'letra-C'], ['letra-D', 'letra-E']], {
    word: 'CA', lastLetterPlayerId: a.view.meId, lastPlayerId: a.view.meId, turnPlayerId: b.view.meId,
  });
  const before = await storage.getRoom(code);
  const clicks = await Promise.all([emit(b, 'challenge:start'), emit(c, 'challenge:start')]);
  assert.equal(clicks.filter((reply) => reply.ok).length, 1);
  await waitFor(() => Boolean(a.view.game.challenge));
  const challengeId = a.view.game.challenge.id;
  assert.equal(a.view.game.challenge.challengedId, a.view.meId);
  assert.deepEqual((await storage.getRoom(code)).players, before.players);
  const active = await storage.getRoom(code);
  for (const [event, data] of [['game:draw', {}], ['game:play', { cardId: 'wild-0', letter: 'Z' }], ['game:skip', {}], ['challenge:confirm', { challengeId, letters: '' }]]) {
    assert.equal((await emit(b, event, data)).ok, false);
    assert.deepEqual(await storage.getRoom(code), active);
  }
  assert.equal((await emit(a, 'challenge:preview', { challengeId, letters: 'to' })).ok, true);
  await waitFor(() => b.view.game.challenge.addedLetters === 'TO');
  assert.equal((await emit(a, 'challenge:confirm', { challengeId, letters: 'to' })).ok, true);
  assert.equal((await emit(a, 'challenge:vote', { challengeId, vote: 'sim' })).ok, false);
  assert.equal((await emit(b, 'challenge:vote', { challengeId, vote: 'sim' })).ok, true);
  await waitFor(() => c.view.game.version === b.view.game.version);
  assert.equal(b.view.game.challenge.ownVote, 'sim');
  for (const socket of [a, b, c]) {
    for (const field of ['votes', 'tally', 'respondedCount', 'voterCount', 'voterIds']) {
      assert.equal(Object.hasOwn(socket.view.game.challenge, field), false);
    }
    assert.equal(socket.view.game.challenge.ownVote, socket === b ? 'sim' : null);
  }
  assert.equal((await emit(c, 'challenge:vote', { challengeId, vote: 'nao' })).ok, true);
  await waitFor(() => !b.view.game.challenge);
  const final = await storage.getRoom(code);
  assert.equal(final.game.word, '');
  assert.equal(final.game.lastLetterPlayerId, null);
  assert.equal(final.game.turnPlayerId, before.game.turnPlayerId);
  assert.equal(final.players[0].hand.length, before.players[0].hand.length + 4);
  for (const socket of [a, b, c]) {
    assert.deepEqual(socket.view.game.challengeResult, { outcome: 'recusada' });
    assert.equal(socket.view.notice, 'Palavra recusada');
  }

  const reset = structuredClone(final);
  assert.equal((await emit(b, 'game:play', { cardId: 'wild-0', letter: 'Z', version: before.game.version })).ok, false);
  assert.equal((await emit(b, 'challenge:start')).ok, false);
  assert.deepEqual(await storage.getRoom(code), reset);
});

test('rede: prazos automáticos usam timestamps e desconexão de Y aplica PERDI', async (t) => {
  let clock = Date.now();
  const fixture = await setup(t, { nowSource: () => clock, challengeIntervalMs: 5 });
  const { a, b, storage, code } = fixture;
  await seedHands(fixture, [['letra-A', 'letra-B'], ['letra-C', 'letra-D']], { word: 'CA', lastLetterPlayerId: a.view.meId });
  assert.equal((await emit(b, 'challenge:start')).ok, true);
  const initial = await storage.getRoom(code);
  clock += 30_000;
  await waitFor(() => !a.view.game.challenge);
  assert.equal((await emit(a, 'challenge:confirm', { challengeId: initial.game.challenge.id, letters: 'TO' })).ok, false);
  await waitFor(() => !b.view.game.challenge);
  let room = await storage.getRoom(code);
  assert.equal(room.game.challengeResult.automatic, true);
  assert.equal(room.players[0].hand.length, initial.players[0].hand.length + 4);
  // Nova letra habilita outro desafio. Desconectar Y resolve sem esperar prazo.
  assert.equal((await emit(a, 'game:play', { cardId: 'letra-A' })).ok, true);
  assert.equal((await emit(b, 'challenge:start')).ok, true);
  a.disconnect();
  await waitFor(() => !b.view.game.challenge);
  room = await storage.getRoom(code);
  assert.equal(room.game.challengeResult.reason, 'desconexao');
});

test('rede: sala restaurada com votação vencida resolve mesmo sem conexões', async (t) => {
  const fixture = await setup(t);
  const { a, b, storage, code } = fixture;
  await seedHands(fixture, [['letra-A', 'letra-B'], ['letra-C', 'letra-D']], { word: 'CA', lastLetterPlayerId: a.view.meId });
  const current = await storage.getRoom(code), at = Date.now() - 100_000;
  const voting = confirmChallenge(startChallenge(current, b.view.meId, at), a.view.meId, current.game.version + 1, 'TO', at + 1000, () => 0.5);
  // Outro armazenamento/processo: os únicos dados compartilhados são o JSON salvo.
  const restored = new MemoryStorage();
  await restored.saveRoom(JSON.parse(JSON.stringify(voting)));
  const app = createApp({ roomStorage: restored, challengeIntervalMs: 5 });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => new Promise((resolve) => app.io.close(resolve)));
  await waitFor(async () => !(await restored.getRoom(code)).game.challenge);
  const settled = await restored.getRoom(code);
  assert.equal(settled.game.challengeResult.reason, 'aceita');
  assert.equal(settled.game.challengeResult.tally.yes, 1);
  assert.equal(settled.game.word, '');
  assert.equal(settled.players[1].hand.length, voting.players[1].hand.length + 4);
});

test('rede: cascata de Passar letra e pagamento atômico validado, persistido e privado', async (t) => {
  const fixture = await setup(t);
  const { a, b, storage, code } = fixture;
  await seedHands(fixture, [['pass-0', 'letra-K', 'letra-E'], ['pass-1', 'letra-C', 'letra-D']], { blockedLetter: 'K' });
  assert.equal((await emit(a, 'game:play', { cardId: 'pass-0' })).ok, true);
  await waitFor(() => b.view.game.letterDebt.count === 1);
  assert.deepEqual(b.view.game.letterDebt, { count: 1, playerId: b.view.meId });
  assert.equal((await emit(b, 'game:play', { cardId: 'pass-1' })).ok, true);
  await waitFor(() => a.view.game.letterDebt.count === 2);
  assert.deepEqual(a.view.game.letterDebt, { count: 2, playerId: a.view.meId });
  assert.equal(a.view.game.blockedLetter, 'K');
  assert.ok(a.view.game.playableCardIds.includes('letra-K'));
  const before = await storage.getRoom(code);
  for (const accumulatedLetters of [undefined, 'A', 'ABC', 'KZ', 'A1', 'ÁB']) {
    assert.equal((await emit(a, 'game:play', { cardId: 'letra-K', accumulatedLetters })).ok, false);
    assert.deepEqual(await storage.getRoom(code), before);
  }
  assert.equal((await emit(a, 'game:play', { cardId: 'letra-K', accumulatedLetters: 'aK' })).ok, true);
  await waitFor(() => b.view.game.word === 'AKK');
  const paid = await storage.getRoom(code);
  assert.equal(paid.game.version, before.game.version + 1);
  assert.deepEqual(paid.game.letterDebt, { count: 0, playerId: null });
  assert.equal(paid.game.blockedLetter, null);
  assert.equal(paid.players[0].hand.length, before.players[0].hand.length - 1);
  assert.match(b.view.notice, /pagou 2 letras acumuladas/);
  assert.ok(b.view.players.every((p) => !p.hand && !p.sessionId));
  assert.ok(!b.view.hand.some((card) => card.id === 'letra-E'));
});

test('rede: Vida respeita Bloqueio, protege contra desafio e encerra a proteção na próxima carta', async (t) => {
  const fixture = await setup(t);
  const { a, b, storage, code } = fixture;
  await seedHands(fixture, [['life-0', 'letra-B', 'letra-E'], ['double-0', 'letra-C', 'letra-D']], { word: 'C', blockedLetter: 'A' });
  assert.ok(!a.view.game.allowedLettersByCard['life-0'].includes('A'));
  assert.equal(a.view.game.allowedLettersByCard['life-0'], 'EIOU');
  const beforeLife = await storage.getRoom(code);
  assert.equal((await emit(a, 'game:play', { cardId: 'life-0', letter: 'A' })).ok, false);
  assert.deepEqual(await storage.getRoom(code), beforeLife);
  for (const letter of ['B', 'z', 'Y']) {
    assert.equal((await emit(a, 'game:play', { cardId: 'life-0', letter })).ok, false);
    assert.deepEqual(await storage.getRoom(code), beforeLife);
  }
  assert.equal((await emit(a, 'game:play', { cardId: 'life-0', letter: 'e' })).ok, true);
  await waitFor(() => b.view.game.protectedPlayerId === a.view.meId);
  assert.equal(a.view.game.word, 'CE');
  assert.equal(a.view.game.blockedLetter, null);
  assert.equal(a.view.game.canSkipTurn, false);
  assert.equal(b.view.game.canSkipTurn, false);
  assert.match(b.view.notice, /Vida ❤️/);
  assert.equal((await emit(b, 'game:draw')).ok, true);
  await waitFor(() => a.view.game.version === b.view.game.version);
  const protectedState = await storage.getRoom(code);
  const denied = await emit(a, 'game:skip');
  assert.equal(denied.ok, false);
  assert.match(denied.error, /jogador da vez/);
  assert.match((await emit(b, 'challenge:start')).error, /protegido pela Vida/);
  assert.deepEqual(await storage.getRoom(code), protectedState);
  assert.equal((await emit(b, 'game:play', { cardId: 'double-0' })).ok, true);
  await waitFor(() => a.view.game.turnPlayerId === a.view.meId);
  assert.equal(a.view.game.protectedPlayerId, null);
  assert.equal((await emit(a, 'game:play', { cardId: 'letra-B' })).ok, true);
  assert.equal(a.view.game.canSkipTurn, false);
  assert.equal((await emit(a, 'game:skip')).ok, false);
  assert.ok(b.view.players.every((p) => !p.hand && !p.sessionId));
});

test('rede: valida 2+* no servidor, salva o estado e publica apenas a mão de cada participante', async (t) => {
  const fixture = await setup(t);
  const { a, b, storage, code } = fixture;
  await seedHands(fixture, [['multi-0', 'letra-B'], ['double-0', 'letra-C', 'letra-D']], { word: 'C', blockedLetter: 'A' });
  assert.ok(a.view.game.playableCardIds.includes('multi-0'));
  const before = await storage.getRoom(code);
  for (const letter of ['A', 'A'.repeat(17), 'aB', 'A B', 'BÁ', 'ß', 'AB\n', null]) {
    assert.equal((await emit(a, 'game:play', { cardId: 'multi-0', letter })).ok, false);
    assert.deepEqual(await storage.getRoom(code), before, 'entrada inválida não salva nem modifica a sala');
  }
  assert.equal((await emit(a, 'game:play', { cardId: 'multi-0', letter: 'baaa' })).ok, true);
  await waitFor(() => b.view.game.word === 'CBAAA');
  assert.equal(b.view.game.blockedLetter, null);
  assert.match(b.view.notice, /2\+\*/);
  assert.equal((await storage.getRoom(code)).game.word, 'CBAAA');
  assert.ok(b.view.players.every((p) => !p.hand && !p.sessionId));
  assert.ok(!Object.hasOwn(b.view.game.allowedLettersByCard, 'letra-B'));
  assert.equal((await emit(b, 'game:play', { cardId: 'double-0' })).ok, true);
  await waitFor(() => a.view.game.turnPlayerId === a.view.meId);
  assert.equal(a.view.game.word, 'CBAAA');
});

test('rede: valida Troca, publica Bloqueio e aplica 2x sem vazar mãos', async (t) => {
  const fixture = await setup(t);
  const { a, b, storage, code } = fixture;
  await seedHands(fixture, [['swap-0', 'letra-B', 'letra-C'], ['block-0', 'double-0', 'letra-D']],
    { word: 'CASA', lastPlayerId: b.view.meId, });
  assert.equal((await emit(a, 'game:play', { cardId: 'swap-0', letter: 'A' })).ok, false);
  assert.equal((await emit(a, 'game:play', { cardId: 'swap-0', letter: 'O' })).ok, true);
  await waitFor(() => b.view.game.word === 'CASO');
  assert.equal((await emit(b, 'game:play', { cardId: 'block-0', letter: 'U' })).ok, false);
  assert.equal((await emit(b, 'game:play', { cardId: 'block-0', letter: 'U', blockedLetter: 'B' })).ok, true);
  await waitFor(() => a.view.game.blockedLetter === 'B');
  assert.ok(!a.view.game.playableCardIds.includes('letra-B'));
  assert.equal((await emit(a, 'game:play', { cardId: 'letra-B' })).ok, false);
  assert.equal((await emit(a, 'game:play', { cardId: 'letra-C' })).ok, true);
  await waitFor(() => b.view.game.blockedLetter === null);
  assert.equal((await emit(b, 'game:play', { cardId: 'double-0' })).ok, true);
  await waitFor(() => a.view.game.extraTurns.length === 1);
  assert.equal(a.view.game.turnPlayerId, a.view.meId);
  assert.equal(a.view.game.word, 'CASOUC');
  assert.equal((await storage.getRoom(code)).game.extraTurns[0], b.view.meId);
  assert.ok(a.view.players.every((p) => !p.hand && !p.sessionId));
  assert.deepEqual(Object.keys(a.view.game.allowedLettersByCard), ['letra-B']);
});

test('rede: Bloqueio permanece visível na cadeia de 2x e restringe seu próprio criador', async (t) => {
  const fixture = await setup(t);
  const { a, b, storage, code } = fixture;
  await seedHands(fixture, [['block-0', 'double-1', 'letra-A', 'letra-B'], ['double-0', 'letra-C', 'letra-D', 'letra-E']]);
  assert.equal((await emit(a, 'game:play', { cardId: 'block-0', letter: 'X', blockedLetter: 'A' })).ok, true);
  await waitFor(() => b.view.game.blockedLetter === 'A');
  assert.equal((await emit(b, 'game:play', { cardId: 'double-0' })).ok, true);
  await waitFor(() => a.view.game.turnPlayerId === a.view.meId);
  assert.equal(a.view.game.blockedLetter, 'A');
  assert.ok(!a.view.game.playableCardIds.includes('letra-A'));
  assert.equal((await emit(a, 'game:play', { cardId: 'letra-A' })).ok, false);
  assert.equal((await emit(a, 'game:play', { cardId: 'double-1' })).ok, true);
  await waitFor(() => b.view.game.extraTurns.length === 2);
  for (const socket of [a, b]) {
    assert.equal(socket.view.game.blockedLetter, 'A');
    assert.equal(socket.view.game.word, 'X');
  }
  assert.equal((await storage.getRoom(code)).game.blockedLetter, 'A');
  assert.equal((await emit(b, 'game:play', { cardId: 'letra-C' })).ok, true);
  await waitFor(() => a.view.game.blockedLetter === null);
  assert.equal(a.view.game.turnPlayerId, a.view.meId);
  assert.ok(a.view.game.playableCardIds.includes('letra-A'));
});

test('rede: só o jogador da vez sem carta jogável pode passar; cliques duplicados não duplicam penalidade', async (t) => {
  const fixture = await setup(t);
  const { a, b, storage, code } = fixture;
  await seedHands(fixture, [['letra-B'], ['letra-A']], { word: 'X', blockedLetter: 'A', turnPlayerId: b.view.meId, drawsThisTurn: 1 });
  assert.equal(a.view.game.canSkipTurn, false);
  assert.equal(b.view.game.canSkipTurn, true);
  const before = await storage.getRoom(code);
  assert.equal((await emit(a, 'game:skip')).ok, false);
  assert.deepEqual(await storage.getRoom(code), before);
  const version = b.view.game.version;
  const replies = await Promise.all([emit(b, 'game:skip', { version }), emit(b, 'game:skip', { version })]);
  assert.equal(replies.filter((reply) => reply.ok).length, 1);
  assert.match(replies.find((reply) => !reply.ok).error, /mesa mudou/);
  const room = await storage.getRoom(code);
  assert.equal(room.players[1].hand.length, 5);
  assert.equal(room.game.turnPlayerId, a.view.meId);
  assert.equal(room.game.lastPlayerId, null);
});

test('rede: Não consigo jogar exige versão e passa a vez somente ao clicar', async (t) => {
  const fixture = await setup(t);
  const { a, storage, code } = fixture;
  const cards = createDeck();
  const deck = cards.filter((c) => !['swap-0', 'double-0', 'letra-A', 'letra-B', 'swap-1'].includes(c.id));
  deck.push(cards.find((c) => c.id === 'swap-1'));
  await seedHands(fixture, [['swap-0', 'double-0'], ['letra-A', 'letra-B']], { deck });
  assert.equal(a.view.game.canSkipTurn, false);
  const before = await storage.getRoom(code);
  assert.match((await emit(a, 'game:skip')).error, /Compre uma carta primeiro/);
  assert.deepEqual(await storage.getRoom(code), before);
  assert.equal((await emit(a, 'game:draw')).ok, true);
  assert.equal(a.view.game.canSkipTurn, true);
  assert.equal(a.view.game.canDraw, false);
  assert.equal(a.view.game.turnPlayerId, a.view.meId);
  assert.equal((await a.timeout(3000).emitWithAck('game:skip', {})).ok, false);
  assert.equal((await emit(a, 'game:skip')).ok, true);
  assert.equal(a.view.hand.length, 7);
  assert.notEqual(a.view.game.turnPlayerId, a.view.meId);
});

test('rede: mãos privadas, autoridade do servidor, compra concorrente e PERDI em tempo real', async (t) => {
  const { a, b, code, storage } = await setup(t);
  assert.equal((await emit(b, 'game:start')).ok, false);
  assert.equal((await emit(a, 'game:start')).ok, true);
  await waitFor(() => b.view.phase === 'playing');
  assert.equal(a.view.hand.length, RULES.defaultHand);
  assert.equal(b.view.hand.length, RULES.defaultHand);
  assert.ok(b.view.players.every((p) => !p.hand && !p.sessionId));
  assert.equal(b.view.game.deck, undefined);
  assert.equal((await emit(b, 'game:draw')).ok, false);
  const draws = await Promise.all([emit(a, 'game:draw'), emit(a, 'game:draw')]);
  assert.equal(draws.filter((result) => result.ok).length, 1);
  assert.equal(a.view.hand.length, RULES.defaultHand + 1);
  const stolen = b.view.hand[0];
  assert.equal((await emit(a, 'game:play', { cardId: stolen.id, letter: allowedLetters(stolen)[0] })).ok, false);
  const card = a.view.hand.find((c) => !['double', 'pass'].includes(c.type) && !a.view.config.cardTypes[c.type].protectsFromChallenge && a.view.game.playableCardIds.includes(c.id));
  const letter = a.view.game.allowedLettersByCard[card.id][0].repeat(a.view.config.cardTypes[card.type].minLetters || 1);
  assert.equal((await emit(a, 'game:play', { cardId: card.id, letter, blockedLetter: 'Z' })).ok, true);
  await waitFor(() => b.view.game.turnPlayerId === b.view.meId);
  assert.equal(b.view.game.word, letter);
  assert.equal((await emit(b, 'game:skip')).ok, false);
  assert.equal((await emit(b, 'game:draw')).ok, true);
  assert.equal((await emit(a, 'game:skip')).ok, false);
  assert.equal(b.view.game.word, letter);
  assert.equal(a.view.hand.length, RULES.defaultHand);
  assert.equal(b.view.game.turnPlayerId, b.view.meId);
  assert.equal(b.view.game.drawsThisTurn, 1);
  const saved = await storage.getRoom(code);
  assert.equal(saved.game.word, letter);
  assert.equal(saved.players[0].hand.length, RULES.defaultHand);
});

test('rede: reconexão retoma cartas e identidade; a partida pausa e continua', async (t) => {
  const { a, b, code, connect } = await setup(t);
  await emit(a, 'game:start');
  await waitFor(() => b.view.phase === 'playing');
  const originalHand = b.view.hand;
  const originalId = b.view.meId;
  b.disconnect();
  await waitFor(() => a.view.game.paused);
  assert.equal((await emit(a, 'game:draw')).ok, false);
  const resumed = await connect(b.sessionId);
  assert.equal((await emit(resumed, 'room:join', { sessionId: resumed.sessionId, name: 'Bia', code })).ok, true);
  assert.equal(resumed.view.meId, originalId);
  assert.deepEqual(resumed.view.hand, originalHand);
  await waitFor(() => !a.view.game.paused);
  assert.equal((await emit(a, 'game:draw')).ok, true);
  const duplicate = await connect(b.sessionId);
  assert.equal((await emit(duplicate, 'room:join', { sessionId: duplicate.sessionId, name: 'Bia', code })).ok, true);
  await waitFor(() => !resumed.connected);
  assert.equal(duplicate.view.players.length, 2);
});

test('rede: uma partida completa mostra a mesma vitória e permite revanche e lobby', async (t) => {
  const { a, b } = await setup(t);
  assert.equal((await emit(a, 'room:settings', { playerCount: 2, initialCards: 3 })).ok, true);
  assert.equal((await emit(a, 'game:start')).ok, true);
  for (let i = 0; i < 100 && a.view.phase === 'playing'; i++) {
    if (a.view.game.pendingVictory) {
      const voter = a.view.game.pendingVictory.playerId === a.view.meId ? b : a;
      assert.equal((await emit(voter, 'victory:accept', { pendingId: a.view.game.pendingVictory.id })).ok, true);
      break;
    }
    const active = a.view.game.turnPlayerId === a.view.meId ? a : b;
    await waitFor(() => active.view.game.version === a.view.game.version);
    const card = active.view.hand.find((c) => active.view.game.playableCardIds.includes(c.id));
    if (!card) {
      const event = !active.view.game.drawsThisTurn && active.view.game.availableCount ? 'game:draw' : 'game:skip';
      assert.equal((await emit(active, event)).ok, true);
    } else {
      const usesLetters = !['double', 'pass'].includes(card.type);
      const debt = active.view.game.letterDebt.playerId === active.view.meId ? active.view.game.letterDebt.count : 0;
      const accumulatedLetters = usesLetters ? (active.view.game.blockedLetter === 'A' ? 'B' : 'A').repeat(debt) : '';
      const choices = [...active.view.game.allowedLettersByCard[card.id]].filter((letter) => card.type !== 'swap' || !accumulatedLetters || letter !== accumulatedLetters.at(-1));
      const letter = choices[0]?.repeat(active.view.config.cardTypes[card.type].minLetters || 1);
      assert.equal((await emit(active, 'game:play', { cardId: card.id, letter, blockedLetter: 'Z', accumulatedLetters })).ok, true);
    }
    const version = active.view.game.version;
    await waitFor(() => a.view.game.version === version && b.view.game.version === version);
  }
  await waitFor(() => a.view.phase === 'finished' && b.view.phase === 'finished');
  assert.equal(a.view.game.winnerId, b.view.game.winnerId);
  assert.equal([a, b].find((s) => s.view.meId === a.view.game.winnerId).view.hand.length, 0);
  assert.equal((await emit(a, 'game:start')).ok, true);
  assert.equal(a.view.hand.length, 3);
  assert.equal(a.view.game.word, '');
  b.disconnect();
  await waitFor(() => a.view.game.paused);
  assert.equal((await emit(a, 'room:lobby')).ok, true);
  assert.equal(a.view.phase, 'lobby');
  assert.equal(a.view.players.length, 1);
});

test('rede: expiração remove a sala do armazenamento e avisa os conectados', async (t) => {
  const { a, code, storage } = await setup(t);
  const room = await storage.getRoom(code);
  room.updatedAt = 0;
  const expired = once(a, 'room:expired');
  await storage.saveRoom(room);
  await expired;
  assert.equal(await storage.getRoom(code), null);
  assert.equal((await emit(a, 'game:start')).ok, false);
});

test('rede: valida entradas malformadas sem derrubar o servidor', async (t) => {
  const { a, connect } = await setup(t);
  const c = await connect();
  assert.equal((await emit(c, 'room:join', null)).ok, false);
  assert.equal((await emit(c, 'room:create', { sessionId: c.sessionId, name: ' ' })).ok, false);
  assert.equal((await emit(c, 'room:join', { sessionId: c.sessionId, name: 'Caio', code: 'ABC' })).ok, false);
  assert.equal((await emit(a, 'room:settings', null)).ok, false);
  assert.equal((await emit(a, 'game:start')).ok, true);
  assert.equal((await emit(a, 'game:play', null)).ok, false);
});

test('composição do lobby: validação pela rede, leitura em tempo real e baralho personalizado ao iniciar', async (t) => {
  const { a, b, code, storage } = await setup(t);
  const composition = Object.fromEntries(a.view.config.configurableCardTypes.map((type) => [type, 0]));
  const before = await storage.getRoom(code);
  assert.equal((await emit(b, 'room:deck', { composition })).ok, false);
  assert.equal((await emit(a, 'room:deck', { composition: { ...composition, wild: -1 } })).ok, false);
  assert.equal((await emit(a, 'room:deck', { composition: { ...composition, letter: 26 } })).ok, false);
  assert.deepEqual(await storage.getRoom(code), before);
  assert.equal((await emit(a, 'room:settings', { playerCount: 2, initialCards: maxInitialCards(2) })).ok, true);
  assert.equal((await emit(a, 'room:deck', { composition })).ok, true);
  await waitFor(() => b.view.deckSize === 30);
  assert.deepEqual(b.view.settings.deckComposition, composition);
  assert.equal(a.view.settings.initialCards, 14);
  assert.equal(a.view.settings.maxInitialCards, 14);
  assert.match(a.view.settingsAdjustment.message, /ajustadas/);
  assert.equal(b.view.settingsAdjustment, null);
  assert.equal((await emit(b, 'room:deck:reset')).ok, false);
  assert.equal((await emit(a, 'room:deck:reset')).ok, true);
  await waitFor(() => b.view.deckSize === a.view.config.deckSize);
  assert.deepEqual(a.view.settings.deckComposition, a.view.config.defaultDeckComposition);
  assert.equal((await emit(a, 'room:deck', { composition })).ok, true);
  assert.equal((await emit(a, 'game:start')).ok, true);
  const playing = await storage.getRoom(code);
  const cards = [...playing.game.deck, ...playing.game.discard, ...playing.players.flatMap((p) => p.hand)];
  assert.equal(cards.length, a.view.deckSize);
  assert.ok(cards.every((c) => !a.view.config.configurableCardTypes.includes(c.type)));
  assert.equal((await emit(a, 'room:deck:reset')).ok, false);
  assert.equal((await emit(a, 'room:deck', { composition: a.view.config.defaultDeckComposition })).ok, false);
  assert.deepEqual(await storage.getRoom(code), playing);
});
