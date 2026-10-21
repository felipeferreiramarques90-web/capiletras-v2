import { randomInt, randomUUID } from 'node:crypto';
import {
  GameError, createRoom, joinRoom, updateSettings, startGame, drawCard, playCard,
  loseRound, disconnectPlayer, returnToLobby, removeFromLobby, roomView, shouldDeleteRoom,
} from '../game/game.js';

const random = () => randomInt(0, 2 ** 32) / 2 ** 32;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');

export function registerSockets(io, storage, { cleanupIntervalMs = 60_000, randomSource = random } = {}) {
  const owners = new Map();
  const queues = new Map();
  const ownerKey = (code, id) => `${code}:${id}`;

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
      target?.emit('room:state', roomView(room, player.id));
    }
  }

  async function save(room) {
    room.updatedAt = Date.now();
    await storage.saveRoom(room);
    broadcast(room);
  }

  function bind(socket, room, sessionId) {
    const player = room.players.find((p) => p.sessionId === sessionId && !p.left);
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
        const room = createRoom({ ...credentials, code, now: Date.now() });
        await storage.saveRoom(room);
        bind(socket, room, credentials.sessionId);
        broadcast(room);
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
        const room = joinRoom(previous, credentials);
        await storage.saveRoom({ ...room, updatedAt: Date.now() });
        bind(socket, room, credentials.sessionId);
        broadcast(room);
      });
    });

    async function action(reducer) {
      const { code, playerId } = socket.data;
      if (!code) throw new GameError('Entre em uma sala primeiro.');
      await locked(code, async () => {
        if (owners.get(ownerKey(code, playerId)) !== socket.id) throw new GameError('Sua vaga foi retomada em outra aba.');
        const room = await storage.getRoom(code);
        if (!room) throw new GameError('Esta sala expirou. Crie uma nova sala.');
        await save(reducer(room, playerId));
      });
    }

    on('room:settings', (data) => action((room, id) => updateSettings(room, id, data)));
    on('game:start', () => action((room, id) => startGame(room, id, randomSource)));
    on('game:draw', () => action((room, id) => drawCard(room, id, randomSource)));
    on('game:play', (data) => action((room, id) => playCard(room, id, data?.cardId, data?.letter, data?.blockedLetter)));
    // Versão obrigatória na rede: dois cliques sobre a mesma mesa não cobram duas penalidades.
    on('game:lose', (data) => action((room, id) => loseRound(room, id, randomSource, data?.version ?? null)));
    on('room:lobby', () => action((room, id) => returnToLobby(room, id)));
    on('room:remove', (data) => action((room, id) => removeFromLobby(room, id, data?.playerId)));

    async function detach(leave) {
      const { code, playerId } = socket.data;
      if (!code) return;
      await locked(code, async () => {
        const key = ownerKey(code, playerId);
        if (owners.get(key) !== socket.id) return;
        const previous = await storage.getRoom(code);
        if (previous) {
          const room = disconnectPlayer(previous, playerId, Date.now(), leave);
          await save(room);
          if (!room.players.length) await storage.deleteRoom(code);
        }
        owners.delete(key);
        socket.data = {};
      });
    }

    on('room:leave', () => detach(true));
    socket.on('disconnect', () => { socketQueue.catch(() => {}).then(() => detach(false)).catch((error) => console.error('Falha ao registrar desconexão:', error)); });
  });

  const cleanup = setInterval(async () => {
    try {
      for (const candidate of await storage.listRooms()) {
        await locked(candidate.code, async () => {
          const room = await storage.getRoom(candidate.code);
          if (!room || !shouldDeleteRoom(room, Date.now())) return;
          await storage.deleteRoom(room.code);
          for (const player of room.players) {
            const key = ownerKey(room.code, player.id);
            const target = io.sockets.sockets.get(owners.get(key));
            if (target) {
              target.emit('room:expired');
              target.data = {};
            }
            owners.delete(key);
          }
        });
      }
    } catch (error) { console.error('Falha ao limpar salas:', error); }
  }, cleanupIntervalMs);
  cleanup.unref();
  return () => clearInterval(cleanup);
}
