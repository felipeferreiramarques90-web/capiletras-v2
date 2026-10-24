import assert from 'node:assert/strict';
import { createDictionary } from '../../bots/dictionary.js';
import { addBot } from '../../bots/players.js';
import { chooseTurnAction, decideBotAction } from '../../bots/brain.js';
import { applyBotAction } from '../../bots/actions.js';
import { createRoom, updateDeckComposition, startGame, roomView, playCard, drawCard, skipTurn } from '../../game/game.js';
import { confirmChallenge, loseChallenge, resolveChallenge, voteChallenge } from '../../game/challenge.js';
import { acceptVictory, resolvePendingVictory } from '../../game/victory.js';
import { deckSize } from '../../game/config.js';

const dictionary = createDictionary(['casa', 'casas', 'casca', 'canto', 'cantamos', 'cantaram', 'bola', 'bolas', 'bacana', 'abacate', 'capivara', 'futebol', 'zebra']);
// O humano simulado usa as mesmas intenções e validadores, sem alterar política dos bots.
export function simulateMatch(composition, seed = 123456, { full = dictionary, common = full } = {}) {
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  let room = createRoom({ code: 'ABC234', playerId: 'h', sessionId: 's', name: 'Ana', now: 0 });
  room = updateDeckComposition(room, 'h', composition);
  for (let i = 1; i <= 3; i++) room = addBot(room, 'h', `b${i}`);
  room = startGame(room, 'h', random);
  let clock = 100000;
  for (let step = 0; step < 6000 && room.phase === 'playing'; step++) {
    clock += 1000;
    room = resolvePendingVictory(resolveChallenge(room, clock, random), clock);
    if (room.phase !== 'playing') break;
    const ch = room.game.challenge;
    if (ch?.challengedId === 'h' && ch.phase === 'completando') {
      const [letters] = full.continuations(ch.baseWord, { limit: 1 });
      room = letters === undefined ? loseChallenge(room, 'h', ch.id, clock, random) : confirmChallenge(room, 'h', ch.id, letters, clock, random);
    } else if (ch?.phase === 'votando' && ch.voterIds.includes('h') && !Object.hasOwn(ch.votes, 'h')) {
      room = voteChallenge(room, 'h', ch.id, 'sim', clock, random);
    } else if (!ch && room.game.pendingVictory?.voterIds.includes('h') && !room.game.pendingVictory.acceptedIds.includes('h')) {
      room = acceptVictory(room, 'h', room.game.pendingVictory.id, clock);
    } else if (!ch && !room.game.pendingVictory && room.game.turnPlayerId === 'h') {
      const action = chooseTurnAction(roomView(room, 'h'), full, { rng: random, commonDictionary: common });
      assert.ok(action, 'O humano simulado precisa ter uma ação válida.');
      if (action.type === 'play') room = playCard(room, 'h', action.cardId, action.letter, action.blockedLetter, action.accumulatedLetters, room.game.version, clock);
      else if (action.type === 'draw') room = drawCard(room, 'h', random);
      else if (action.type === 'skip') room = skipTurn(room, 'h', random);
      else assert.fail(`Ação inesperada: ${action.type}`);
    }
    for (const id of ['b1', 'b2', 'b3']) {
      if (room.phase !== 'playing') break;
      const action = decideBotAction(roomView(room, id), full, random, { commonDictionary: common });
      if (action) room = applyBotAction(room, id, action, { version: room.game.version, now: clock, rng: random });
    }
    assert.equal(room.players.reduce((n, p) => n + p.hand.length, 0) + room.game.deck.length + room.game.discard.length, deckSize(composition));
  }
  assert.equal(room.phase, 'finished', `Simulação travou no turno ${room.game.turnNumber}.`);
  return room;
}
