import { CHALLENGE_RULES, RULES } from './config.js';
import { GameError, takeCards, advanceTurn } from './game.js';
import { finishVictory } from './victory.js';

const requireRule = (condition, message) => { if (!condition) throw new GameError(message); };
const player = (room, id) => room.players.find((p) => p.id === id);
const fullWord = (challenge) => challenge.baseWord + challenge.addedLetters;
const voteNotice = (tally) => `Palavra ${tally.rejected ? 'recusada' : 'aceita'}: ${tally.yes} Sim e ${tally.no} Não.${tally.early ? ` Votação encerrada antecipadamente; ${tally.pending} votante(s) não precisaram responder.` : ''}`;

function requireParticipant(room, id) {
  const participant = player(room, id);
  requireRule(room.phase === 'playing', 'Não há partida em andamento.');
  requireRule(participant?.connected && !participant.left, 'Reconecte para participar do desafio.');
  return participant;
}

function requireChallenge(room, id, challengeId) {
  requireParticipant(room, id);
  const challenge = room.game.challenge;
  requireRule(challenge && challenge.id === challengeId, 'Este desafio já terminou ou a mesa mudou.');
  return challenge;
}

function normalizeLetters(letters) {
  requireRule(typeof letters === 'string' && !/[^A-Za-z]/.test(letters), 'Use somente letras de A a Z, sem espaços, números, acentos ou símbolos.');
  requireRule(letters.length >= CHALLENGE_RULES.minLetters && letters.length <= CHALLENGE_RULES.maxLetters,
    `Acrescente de ${CHALLENGE_RULES.minLetters} a ${CHALLENGE_RULES.maxLetters} letras.`);
  return letters.toUpperCase();
}

// Desafios comuns mantêm a vez. Ao recusar uma última carta, a jogada termina;
// ao aceitá-la, preservamos a palavra completa para a tela de vitória.
function finish(room, penalizedId, reason, automatic, now, random) {
  const game = room.game, challenge = game.challenge;
  if (automatic && (challenge.phase === 'completando' || reason === 'prazo')) challenge.addedLetters = '';
  const penalized = player(room, penalizedId);
  const cards = takeCards(game, RULES.lossPenalty, random);
  penalized.hand.push(...cards);
  game.challengeResult = {
    id: challenge.id, challengerId: challenge.challengerId, challengedId: challenge.challengedId,
    word: fullWord(challenge), votes: { ...challenge.votes }, tally: challenge.tally ? { ...challenge.tally } : null,
    penalizedId, drawnCount: cards.length, reason, automatic, finishedAt: now,
  };
  const pending = game.pendingVictory;
  if (pending && reason === 'aceita') {
    game.word = fullWord(challenge);
    game.challenge = null;
    room.notice = `${voteNotice(challenge.tally)} ${penalized.name} comprou ${cards.length} carta${cards.length === 1 ? '' : 's'}.`;
    return finishVictory(room, pending.playerId);
  }
  game.word = '';
  game.blockedLetter = null;
  game.letterDebt = { count: 0, playerId: null };
  game.protectedPlayerId = null;
  game.lastLetterPlayerId = null;
  game.challenge = null;
  game.pendingVictory = null;
  game.version++;
  if (pending) advanceTurn(room);
  room.notice = `${challenge.tally ? `${voteNotice(challenge.tally)} ` : ''}${penalized.name} ${penalizedId === challenge.challengedId ? `disse PERDI${automatic ? ' automaticamente' : ''} e ` : ''}comprou ${cards.length} carta${cards.length === 1 ? '' : 's'}. Mesa reiniciada: palavra, débito, bloqueio e proteção zerados. ${pending ? 'Vitória cancelada; a vez passou.' : 'A vez continua a mesma.'}`;
  return room;
}

export function startChallenge(original, id, now) {
  const room = structuredClone(original);
  const challenger = requireParticipant(room, id);
  requireRule(!room.game.challenge, 'Já existe um desafio em andamento.');
  requireRule(!room.game.pendingVictory || now < room.game.pendingVictory.deadline, 'O prazo da vitória pendente terminou.');
  const debt = room.game.letterDebt;
  requireRule(debt.count === 0,
    `Não dá para duvidar: ${player(room, debt.playerId)?.name || 'um jogador'} ainda deve ${debt.count} letra${debt.count === 1 ? '' : 's'}.`);
  requireRule(room.game.word && room.game.lastLetterPlayerId, 'A palavra está vazia. Aguarde alguém adicionar uma letra.');
  const challenged = player(room, room.game.lastLetterPlayerId);
  requireRule(challenged && challenged.id !== id, 'Você não pode duvidar da própria palavra.');
  requireRule(room.game.protectedPlayerId !== challenged.id, `${challenged.name} está protegido pela Vida`);
  room.game.version++;
  room.game.challenge = {
    id: room.game.version, phase: 'completando', challengerId: id, challengedId: challenged.id,
    baseWord: room.game.word, addedLetters: '', votes: {},
    voterIds: room.players.filter((p) => !p.left && p.id !== challenged.id).map((p) => p.id),
    completionDeadline: now + CHALLENGE_RULES.completionMs, voteDeadline: null,
    tally: null,
  };
  room.game.challengeResult = null;
  room.notice = `${challenger.name} desafia ${challenged.name} a completar a palavra.`;
  return room;
}

export function previewChallenge(original, id, challengeId, letters, now) {
  const room = structuredClone(original);
  const challenge = requireChallenge(room, id, challengeId);
  requireRule(challenge.challengedId === id, 'Só o desafiado pode completar a palavra.');
  requireRule(challenge.phase === 'completando' && now < challenge.completionDeadline, 'O prazo para completar terminou. A penalidade é automática.');
  const normalized = normalizeLetters(letters);
  if (normalized === challenge.addedLetters) return original;
  challenge.addedLetters = normalized;
  room.game.version++;
  return room;
}

export function confirmChallenge(original, id, challengeId, letters, now, random) {
  const room = structuredClone(previewChallenge(original, id, challengeId, letters, now));
  const challenge = room.game.challenge;
  challenge.phase = 'votando';
  challenge.voteDeadline = now + CHALLENGE_RULES.voteMs;
  room.game.word = fullWord(challenge);
  room.game.version++;
  room.notice = 'Aceitar palavra? Os votos ficam ocultos até o resultado.';
  return resolveChallenge(room, now, random);
}

export function voteChallenge(original, id, challengeId, vote, now, random) {
  // Respostas em trânsito de uma votação já encerrada não alteram o resultado.
  const result = original.game?.challengeResult;
  if (!original.game?.challenge && result?.id === challengeId) {
    const voter = player(original, id);
    requireRule(voter?.connected && !voter.left, 'Reconecte para participar do desafio.');
    requireRule(id !== result.challengedId, 'O desafiado não vota.');
    requireRule(vote === 'sim' || vote === 'nao', 'Escolha Sim ou Não.');
    return original;
  }
  const room = structuredClone(original);
  const challenge = requireChallenge(room, id, challengeId);
  requireRule(challenge.phase === 'votando' && now < challenge.voteDeadline, 'A votação já terminou.');
  requireRule(challenge.voterIds.includes(id), 'O desafiado não vota.');
  requireRule(!Object.hasOwn(challenge.votes, id), 'Você já respondeu a esta votação.');
  requireRule(vote === 'sim' || vote === 'nao', 'Escolha Sim ou Não.');
  challenge.votes[id] = vote;
  room.game.version++;
  return resolveChallenge(room, now, random);
}

export function loseChallenge(original, id, challengeId, now, random) {
  const room = structuredClone(original);
  const challenge = requireChallenge(room, id, challengeId);
  requireRule(challenge.challengedId === id, 'Só o desafiado pode dizer PERDI neste desafio.');
  requireRule(challenge.phase === 'completando', 'Aguarde o resultado da votação.');
  requireRule(now < challenge.completionDeadline, 'O prazo terminou; a penalidade é automática.');
  return finish(room, id, 'desistencia', false, now, random);
}

// Executável após restauração do storage, antes de ações e a cada varredura.
// Resolve as fases vencidas diretamente, sem um prazo adicional de penalidade.
// Sem mudança, devolve a mesma referência para evitar gravações e broadcasts.
export function resolveChallenge(original, now, random) {
  if (original.phase !== 'playing' || !original.game.challenge) return original;
  const room = structuredClone(original), challenge = room.game.challenge;
  const challenged = player(room, challenge.challengedId);
  if (!challenged?.connected || challenged.left) return finish(room, challenge.challengedId, 'desconexao', true, now, random);
  // Compatibilidade com salas antigas: a fase de espera já não existe.
  if (challenge.phase === 'perdi') return finish(room, challenge.challengedId, challenge.reason || 'recusada', true, now, random);
  if (Object.hasOwn(challenge, 'lossDeadline')) { delete challenge.lossDeadline; delete challenge.reason; room.game.version++; }
  if (challenge.phase === 'completando' && now >= challenge.completionDeadline) return finish(room, challenge.challengedId, 'prazo', true, now, random);
  if (challenge.phase === 'votando') {
    for (const id of challenge.voterIds) {
      if (!Object.hasOwn(challenge.votes, id) && (now >= challenge.voteDeadline || !player(room, id)?.connected || player(room, id).left)) {
        challenge.votes[id] = 'sim';
        room.game.version++;
      }
    }
    const no = Object.values(challenge.votes).filter((vote) => vote === 'nao').length;
    const yes = Object.values(challenge.votes).filter((vote) => vote === 'sim').length;
    const total = challenge.voterIds.length, pending = total - no - yes;
    const rejected = no / total >= CHALLENGE_RULES.rejectionRatio;
    const accepted = (no + pending) / total < CHALLENGE_RULES.rejectionRatio;
    if (rejected || accepted) {
      challenge.tally = { yes, no, total, pending, early: pending > 0, rejected };
      return finish(room, rejected ? challenge.challengedId : challenge.challengerId,
        rejected ? 'recusada' : 'aceita', rejected, now, random);
    }
  }
  return room.game.version === original.game.version ? original : room;
}
