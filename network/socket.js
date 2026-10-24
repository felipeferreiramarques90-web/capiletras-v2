import { randomInt, randomUUID } from 'node:crypto';
import {
  GameError, createRoom, joinRoom, updateSettings, startGame, drawCard, playCard,
  skipTurn, disconnectPlayer, returnToLobby, removeFromLobby, shouldDeleteRoom, updateDeckComposition, restoreDefaultComposition,
} from '../game/game.js';
import { CHALLENGE_RULES } from '../game/config.js';
import { startChallenge, previewChallenge, confirmChallenge, voteChallenge, loseChallenge, resolveChallenge } from '../game/challenge.js';
import { acceptVictory, resolvePendingVictory } from '../game/victory.js';
import { addBot, removeBot } from '../bots/players.js';
import { defaultDictionary, defaultCommonDictionary } from '../bots/load-dictionary.js';
import { createBotScheduler } from './bots.js';
import { clientView } from './client-view.js';

const random = () => randomInt(0, 2 ** 32) / 2 ** 32;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');

export function registerSockets(io, storage, { cleanupIntervalMs = 60_000, randomSource = random,
  nowSource = () => Date.now(), challengeIntervalMs = CHALLENGE_RULES.tickMs, botOptions = {} } = {}) {
  const owners = new Map();
  const queues = new Map();
  const ownerKey = (code, id) => `${code}:${id}`;
  const settle = (room) => resolvePendingVictory(resolveChallenge(room, nowSource(), randomSource), nowSource());

  // Serializa leitura/regra/salvamento por sala, inclusive reconexões e limpeza.
  // Com vários processos, mova também este bloqueio para o banco/uma fila distribuída.
  async function locked(code, operation) {
    const previous = queues.get(code) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    queues.set(code, next);
    try { return await next; }
    finally { if (queues.get(code) === next) queues.delete(code); }
  }

  function broadcast(room) {
    for (const player of room.players.filter((p) => p.connected && !p.left)) {
      const target = io.sockets.sockets.get(owners.get(ownerKey(room.code, player.id)));
      target?.emit('room:state', { ...clientView(room, player.id), serverNow: nowSource() });
    }
  }

  async function save(room) {
    room.updatedAt = nowSource();
    await storage.saveRoom(room);
    broadcast(room);
    bots.schedule(room);
  }

  const bots = createBotScheduler({ storage, locked, settle, save, nowSource,
    dictionary: botOptions.dictionary || defaultDictionary(), rng: botOptions.rng || randomSource,
    commonDictionary: botOptions.commonDictionary || (botOptions.dictionary ? botOptions.dictionary : defaultCommonDictionary()),
    timings: botOptions.timings, chooseAction: botOptions.chooseAction });

  async function deleteRoom(room, { notify = true } = {}) {
    bots.forget(room.code);
    await storage.deleteRoom(room.code);
    for (const player of room.players) {
      const key = ownerKey(room.code, player.id);
      const target = io.sockets.sockets.get(owners.get(key));
      if (target) { if (notify) target.emit('room:expired'); target.data = {}; }
      owners.delete(key);
    }
  }

  function bind(socket, room, sessionId) {
    const player = room.players.find((p) => !p.isBot && p.sessionId === sessionId && !p.left);
    const key = ownerKey(room.code, player.id);
    const oldSocket = io.sockets.sockets.get(owners.get(key));
    owners.set(key, socket.id);
    socket.data = { code: room.code, playerId: player.id };
    if (oldSocket && oldSocket.id !== socket.id) {
      oldSocket.data = {};
      oldSocket.emit('session:replaced');
      oldSocket.disconnect(true);
    }
  }

  function identity(data) {
    if (!data || typeof data.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{24,100}$/.test(data.sessionId)) {
      throw new GameError('Identificação inválida. Recarregue a página.');
    }
    if (typeof data.name !== 'string') throw new GameError('Informe seu nome.');
    return { sessionId: data.sessionId, name: data.name, playerId: randomUUID() };
  }

  io.on('connection', (socket) => {
    let rate = { since: Date.now(), count: 0 };
    let socketQueue = Promise.resolve();
    const on = (event, handler) => socket.on(event, (data, ack) => {
      socketQueue = socketQueue.catch(() => {}).then(async () => {
        const respond = typeof ack === 'function' ? ack : () => {};
        try {
          if (!socket.connected) return;
          if (Date.now() - rate.since > 10_000) rate = { since: Date.now(), count: 0 };
          if (++rate.count > 60) throw new GameError('Muitas ações seguidas. Aguarde alguns segundos.');
          await handler(data);
          respond({ ok: true });
        } catch (error) {
          if (!(error instanceof GameError)) console.error('Falha na operação da sala:', error);
          respond({ ok: false, error: error instanceof GameError ? error.message : 'Não foi possível salvar a ação. Tente novamente.' });
        }
      });
    });

    on('room:create', async (data) => {
      if (socket.data.code) throw new GameError('Saia da sala atual antes de criar outra.');
      const credentials = identity(data);
      await locked('__create__', async () => {
        let code;
        do { code = newCode(); } while (await storage.getRoom(code));
        const room = createRoom({ ...credentials, code, now: nowSource() });
        await storage.saveRoom(room);
        bind(socket, room, credentials.sessionId);
        broadcast(room);
        bots.schedule(room);
      });
    });

    on('room:join', async (data) => {
      const credentials = identity(data);
      const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
      if (!/^[A-Z2-9]{6}$/.test(code)) throw new GameError('Informe um código de sala com 6 caracteres.');
      if (socket.data.code && socket.data.code !== code) throw new GameError('Saia da sala atual antes de entrar em outra.');
      await locked(code, async () => {
        const previous = await storage.getRoom(code);
        if (!previous) throw new GameError('Sala não encontrada. Ela pode ter expirado ou o servidor reiniciado.');
        const room = settle(joinRoom(previous, credentials));
        await storage.saveRoom({ ...room, updatedAt: nowSource() });
        bind(socket, room, credentials.sessionId);
        broadcast(room);
        bots.schedule(room);
      });
    });

    async function action(reducer) {
      const { code, playerId } = socket.data;
      if (!code) throw new GameError('Entre em uma sala primeiro.');
      await locked(code, async () => {
        if (owners.get(ownerKey(code, playerId)) !== socket.id) throw new GameError('Sua vaga foi retomada em outra aba.');
        let room = await storage.getRoom(code);
        if (!room) throw new GameError('Esta sala expirou. Crie uma nova sala.');
        const settled = settle(room);
        if (settled !== room) { await save(settled); room = settled; }
        const next = settle(reducer(room, playerId));
        if (next !== room) await save(next);
      });
    }

    on('room:settings', (data) => action((room, id) => updateSettings(room, id, data)));
    on('room:deck', (data) => action((room, id) => updateDeckComposition(room, id, data?.composition)));
    on('room:deck:reset', () => action((room, id) => restoreDefaultComposition(room, id)));
    on('game:start', () => action((room, id) => startGame(room, id, randomSource)));
    on('game:draw', () => action((room, id) => drawCard(room, id, randomSource)));
    on('game:play', (data) => action((room, id) => playCard(room, id, data?.cardId, data?.letter, data?.blockedLetter, data?.accumulatedLetters, data?.version ?? null, nowSource())));
    on('victory:accept', (data) => action((room, id) => acceptVictory(room, id, data?.pendingId, nowSource())));
    on('challenge:start', () => action((room, id) => startChallenge(room, id, nowSource())));
    on('challenge:preview', (data) => action((room, id) => previewChallenge(room, id, data?.challengeId, data?.letters, nowSource())));
    on('challenge:confirm', (data) => action((room, id) => confirmChallenge(room, id, data?.challengeId, data?.letters, nowSource(), randomSource)));
    on('challenge:vote', (data) => action((room, id) => voteChallenge(room, id, data?.challengeId, data?.vote, nowSource(), randomSource)));
    on('challenge:lose', (data) => action((room, id) => loseChallenge(room, id, data?.challengeId, nowSource(), randomSource)));
    // Versão obrigatória na rede: dois cliques sobre a mesma mesa não cobram duas penalidades.
    on('game:skip', (data) => action((room, id) => skipTurn(room, id, randomSource, data?.version ?? null)));
    on('room:lobby', () => action((room, id) => returnToLobby(room, id)));
    on('room:remove', (data) => action((room, id) => removeFromLobby(room, id, data?.playerId)));
    on('room:bot:add', () => action((room, id) => addBot(room, id, randomUUID())));
    on('room:bot:remove', (data) => action((room, id) => removeBot(room, id, data?.playerId)));

    async function detach(leave) {
      const { code, playerId } = socket.data;
      if (!code) return;
      await locked(code, async () => {
        const key = ownerKey(code, playerId);
        if (owners.get(key) !== socket.id) return;
        const previous = await storage.getRoom(code);
        if (previous) {
          const room = settle(disconnectPlayer(previous, playerId, nowSource(), leave));
          if (!room.players.some((p) => !p.isBot && !p.left)) await deleteRoom(room, { notify: false });
          else await save(room);
        }
        owners.delete(key);
        socket.data = {};
      });
    }

    on('room:leave', () => detach(true));
    socket.on('disconnect', () => { socketQueue.catch(() => {}).then(() => detach(false)).catch((error) => console.error('Falha ao registrar desconexão:', error)); });
  });

  // Os timers apenas acordam o processamento. A fonte de verdade são os prazos
  // JSON salvos; uma sala restaurada é resolvida mesmo sem sockets conectados.
  let sweeping = false;
  async function sweepChallenges() {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const candidate of await storage.listRooms()) {
        if (!candidate.game?.challenge && !candidate.game?.pendingVictory && !candidate.players.some((p) => p.isBot)) continue;
        await locked(candidate.code, async () => {
          const room = await storage.getRoom(candidate.code);
          if (!room) return;
          const next = settle(room);
          if (next !== room) await save(next);
          else bots.schedule(room);
        });
      }
    } catch (error) { console.error('Falha ao resolver prazos da partida:', error); }
    finally { sweeping = false; }
  }
  void sweepChallenges();
  const challengeClock = setInterval(sweepChallenges, challengeIntervalMs);
  challengeClock.unref();

  const cleanup = setInterval(async () => {
    try {
      for (const candidate of await storage.listRooms()) {
        await locked(candidate.code, async () => {
          const room = await storage.getRoom(candidate.code);
          if (!room || !shouldDeleteRoom(room, nowSource())) return;
          await deleteRoom(room);
        });
      }
    } catch (error) { console.error('Falha ao limpar salas:', error); }
  }, cleanupIntervalMs);
  cleanup.unref();
  return () => { clearInterval(cleanup); clearInterval(challengeClock); bots.stop(); };
}
