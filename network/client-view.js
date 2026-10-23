import { roomView } from '../game/game.js';

// Filtro exclusivo do transporte para humanos. Os reducers, o storage e a visão
// usada pelo cérebro dos bots mantêm os dados internos necessários às regras.
export function clientView(room, viewerId) {
  const view = roomView(room, viewerId);
  if (!view.game) return view;
  const challenge = room.game.challenge;
  if (challenge) {
    view.game.challenge = {
      id: challenge.id, phase: challenge.phase,
      challengerId: challenge.challengerId, challengedId: challenge.challengedId,
      baseWord: challenge.baseWord, addedLetters: challenge.addedLetters,
      completionDeadline: challenge.completionDeadline, voteDeadline: challenge.voteDeadline,
      ownVote: challenge.votes[viewerId] ?? null,
      hasVoted: view.game.challenge.hasVoted, canVote: view.game.challenge.canVote,
    };
    if (challenge.phase === 'votando') view.notice = 'Aceitar palavra?';
  }
  const result = room.game.challengeResult;
  view.game.challengeResult = result?.tally ? {
    outcome: result.tally.rejected ? 'recusada' : 'aceita',
  } : null;
  if (result?.tally) {
    const outcome = result.tally.rejected ? 'recusada' : 'aceita';
    // A mensagem interna pode conter cédulas, totais e detalhes do encerramento.
    // Só o resultado vai para a interface; avisos de jogadas posteriores seguem normais.
    if (room.notice.startsWith(`Palavra ${outcome}:`)) view.notice = `Palavra ${outcome}`;
  }
  if (view.game.pendingVictory) {
    const pending = view.game.pendingVictory;
    view.game.pendingVictory = {
      id: pending.id, playerId: pending.playerId, deadline: pending.deadline, canAccept: pending.canAccept,
    };
  }
  return view;
}
