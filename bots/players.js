import { GameError, updateSettings } from '../game/game.js';
import { RULES } from '../game/config.js';
import { BOT_NAMES } from './config.js';

function lobbyHost(room, id) {
  if (room.phase !== 'lobby') throw new GameError('Só é possível gerenciar bots no lobby.');
  if (room.hostId !== id || !room.players.some((p) => p.id === id && !p.isBot && p.connected && !p.left)) {
    throw new GameError('Só o anfitrião humano pode gerenciar bots.');
  }
}
export function addBot(original, hostId, botId) {
  lobbyHost(original, hostId);
  if (original.players.length >= RULES.maxPlayers) throw new GameError('A sala já tem 8 jogadores.');
  if (typeof botId !== 'string' || !botId || original.players.some((p) => p.id === botId)) throw new GameError('Identificação de bot inválida ou já utilizada.');
  let room = structuredClone(original);
  const occupied = new Set(room.players.map((p) => p.name.toLocaleLowerCase('pt-BR')));
  const name = BOT_NAMES.find((name) => !occupied.has(name.toLocaleLowerCase('pt-BR')));
  const count = Math.max(room.settings.playerCount, room.players.length + 1);
  room = updateSettings(room, hostId, { playerCount: count, initialCards: room.settings.initialCards });
  room.players.push({ id: botId, sessionId: null, name, isBot: true, connected: true, left: false, hand: [] });
  room.notice = `${name} 🤖 entrou na sala.`;
  return room;
}
export function removeBot(original, hostId, botId) {
  lobbyHost(original, hostId);
  const bot = original.players.find((p) => p.id === botId && p.isBot);
  if (!bot) throw new GameError('Bot não encontrado nesta sala.');
  const room = structuredClone(original);
  const wasFull = room.settings.playerCount === room.players.length;
  room.players = room.players.filter((p) => p.id !== botId);
  if (wasFull) room.settings.playerCount = Math.max(RULES.minPlayers, room.players.length);
  room.notice = `${bot.name} 🤖 foi removido da sala.`;
  return room;
}
