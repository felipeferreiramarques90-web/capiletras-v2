import { GameError, drawCard, playCard, skipTurn } from '../game/game.js';
import { startChallenge, previewChallenge, confirmChallenge, voteChallenge, loseChallenge } from '../game/challenge.js';
import { acceptVictory } from '../game/victory.js';

// Despacho puro. Toda ação passa pelos mesmos reducers usados pelos sockets humanos.
export function applyBotAction(room, id, action, { version, now, rng }) {
  if (!room.players.some((p) => p.id === id && p.isBot && !p.left)) throw new GameError('Bot não encontrado.');
  if (room.game?.version !== version || room.phase !== 'playing') throw new GameError('A mesa mudou. Ação antiga do bot descartada.');
  if (action.type === 'decision' || action.type === 'challenge') {
    if (room.game.letterPlayNumber !== action.letterPlayNumber || room.game.botDecisions?.[id] === action.letterPlayNumber) {
      throw new GameError('O bot já decidiu nesta jogada.');
    }
    // Metadado privado: não muda a versão das jogadas nem invalida sorteios dos outros bots.
    const next = action.type === 'challenge' ? startChallenge(room, id, now) : structuredClone(room);
    next.game.botDecisions ??= {};
    next.game.botDecisions[id] = action.letterPlayNumber;
    return next;
  }
  switch (action.type) {
    case 'draw': return drawCard(room, id, rng);
    case 'play': return playCard(room, id, action.cardId, action.letter, action.blockedLetter, action.accumulatedLetters, version, now);
    case 'skip': return skipTurn(room, id, rng, version);
    case 'preview': return previewChallenge(room, id, action.challengeId, action.letters, now);
    case 'confirm': return confirmChallenge(room, id, action.challengeId, action.letters, now, rng);
    case 'vote': return voteChallenge(room, id, action.challengeId, action.vote, now, rng);
    case 'lose': return loseChallenge(room, id, action.challengeId, now, rng);
    case 'accept': return acceptVictory(room, id, action.pendingId, now);
    default: throw new GameError('Ação de bot desconhecida.');
  }
}
