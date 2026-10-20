import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { io as client } from 'socket.io-client';
import { createApp } from '../server.js';
import { MemoryStorage } from '../storage/memory.js';
import { allowedLetters } from '../game/game.js';

const waitFor = async (predicate) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('A atualização esperada não chegou.');
};
const emit = (socket, event, data = {}) => socket.timeout(3000).emitWithAck(event, data);

async function setup(t) {
  const storage = new MemoryStorage();
  const { server, io } = createApp({ roomStorage: storage, cleanupIntervalMs: 50 });
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
  return { a, b, code, storage, url, connect };
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
});

test('rede: mãos privadas, autoridade do servidor, compra concorrente e PERDI em tempo real', async (t) => {
  const { a, b, code, storage } = await setup(t);
  assert.equal((await emit(b, 'game:start')).ok, false);
  assert.equal((await emit(a, 'game:start')).ok, true);
  await waitFor(() => b.view.phase === 'playing');
  assert.equal(a.view.hand.length, 5);
  assert.equal(b.view.hand.length, 5);
  assert.ok(b.view.players.every((p) => !p.hand && !p.sessionId));
  assert.equal(b.view.game.deck, undefined);
  assert.equal((await emit(b, 'game:draw')).ok, false);
  const draws = await Promise.all([emit(a, 'game:draw'), emit(a, 'game:draw')]);
  assert.equal(draws.filter((result) => result.ok).length, 1);
  assert.equal(a.view.hand.length, 6);
  const stolen = b.view.hand[0];
  assert.equal((await emit(a, 'game:play', { cardId: stolen.id, letter: allowedLetters(stolen)[0] })).ok, false);
  const card = a.view.hand.at(-1);
  assert.equal((await emit(a, 'game:play', { cardId: card.id, letter: allowedLetters(card)[0] })).ok, true);
  await waitFor(() => b.view.game.turnPlayerId === b.view.meId);
  assert.equal(b.view.game.word, allowedLetters(card)[0]);
  assert.equal((await emit(b, 'game:lose')).ok, false);
  assert.equal((await emit(b, 'game:draw')).ok, true);
  assert.equal((await emit(a, 'game:lose')).ok, true);
  await waitFor(() => b.view.game.word === '');
  assert.equal(a.view.hand.length, 9);
  assert.equal(b.view.game.turnPlayerId, b.view.meId);
  assert.equal(b.view.game.drawsThisTurn, 1);
  const saved = await storage.getRoom(code);
  assert.equal(saved.game.word, '');
  assert.equal(saved.players[0].hand.length, 9);
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
  for (let i = 0; i < 5; i++) {
    const active = i % 2 ? b : a;
    await waitFor(() => active.view.game?.turnPlayerId === active.view.meId);
    const card = active.view.hand[0];
    assert.equal((await emit(active, 'game:play', { cardId: card.id, letter: allowedLetters(card)[0] })).ok, true);
  }
  await waitFor(() => a.view.phase === 'finished' && b.view.phase === 'finished');
  assert.equal(a.view.game.winnerId, a.view.meId);
  assert.equal(b.view.game.winnerId, a.view.meId);
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
