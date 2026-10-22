import { RULES } from './config.js';
import { GameError } from './errors.js';

// Helpers internos recebem uma cópia local da sala, nunca o objeto do storage.
export function finishVictory(room, playerId) {
  room.phase = 'finished';
  room.game.winnerId = playerId;
  room.game.pendingVictory = null;
  room.game.challenge = null;
  room.game.extraTurns = [];
  room.game.letterDebt = { count: 0, playerId: null };
  room.game.version++;
  room.notice += ` ${room.players.find((p) => p.id === playerId).name} esvaziou a mão e venceu!`;
  return room;
}

export function beginPendingVictory(room, playerId, now) {
  room.game.pendingVictory = {
    id: room.game.version, playerId, deadline: now + RULES.victoryWindowMs,
    voterIds: room.players.filter((p) => p.id !== playerId && !p.left).map((p) => p.id), acceptedIds: [],
  };
  room.notice += ' Última carta: a vitória aguarda a janela de dúvida.';
  return resolvePendingVictory(room, now);
}

export function resolvePendingVictory(original, now) {
  if (original.phase !== 'playing' || !original.game.pendingVictory || original.game.challenge) return original;
  const room = structuredClone(original), pending = room.game.pendingVictory;
  for (const id of pending.voterIds) {
    const p = room.players.find((p) => p.id === id);
    if ((!p?.connected || p.left) && !pending.acceptedIds.includes(id)) {
      pending.acceptedIds.push(id);
      room.game.version++;
    }
  }
  if (now >= pending.deadline || pending.voterIds.every((id) => pending.acceptedIds.includes(id))) return finishVictory(room, pending.playerId);
  return room.game.version === original.game.version ? original : room;
}

export function acceptVictory(original, id, pendingId, now) {
  const pending = original.game?.pendingVictory;
  const player = original.players.find((p) => p.id === id && p.connected && !p.left);
  if (original.phase !== 'playing' || !pending || pending.id !== pendingId || original.game.challenge) throw new GameError('Não há vitória pendente disponível para aceitar.');
  if (now >= pending.deadline) throw new GameError('O prazo da vitória pendente terminou.');
  if (!player || !pending.voterIds.includes(id)) throw new GameError('Só os outros jogadores podem aceitar a palavra.');
  if (pending.acceptedIds.includes(id)) throw new GameError('Você já aceitou a palavra.');
  const room = structuredClone(original);
  room.game.pendingVictory.acceptedIds.push(id);
  room.game.version++;
  return resolvePendingVictory(room, now);
}
