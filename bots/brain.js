import { ALPHABET, CHALLENGE_RULES } from '../game/config.js';
import { BOT_RULES } from './config.js';
import { previewCardWord } from '../game/game.js';

// Recebe exclusivamente roomView(room, botId): a única mão disponível é view.hand.
// As cartas jogáveis e letras permitidas já vêm das mesmas funções dos humanos.
const player = (view, id) => view.players.find((p) => p.id === id);
const debt = (view) => view.game.letterDebt.playerId === view.meId ? view.game.letterDebt.count : 0;
const decided = (view) => view.game.botDecisionPlay === view.game.letterPlayNumber;
const canChallenge = (view) => view.game.word && !view.game.letterDebt.count
  && view.game.lastLetterPlayerId && view.game.lastLetterPlayerId !== view.meId
  && view.game.protectedPlayerId !== view.game.lastLetterPlayerId;

// Não sorteia aqui. O agendador usa esta função para saber se há trabalho pendente.
export function botTask(view, dictionary) {
  if (view.phase !== 'playing') return null;
  const game = view.game, challenge = game.challenge;
  if (challenge) {
    if (challenge.phase === 'completando' && challenge.challengedId === view.meId) return { kind: 'complete', key: `complete:${challenge.id}` };
    if (challenge.canVote) return { kind: 'vote', key: `vote:${challenge.id}` };
    return null;
  }
  if (canChallenge(view) && !decided(view) && !dictionary.hasPrefix(game.word)) {
    return { kind: 'doubt', key: `doubt:${game.letterPlayNumber}` };
  }
  if (game.pendingVictory) {
    return game.pendingVictory.canAccept && dictionary.hasPrefix(game.word)
      ? { kind: 'accept', key: `accept:${game.pendingVictory.id}` } : null;
  }
  return !game.paused && game.canPlay ? { kind: 'turn', key: `turn:${game.turnNumber}:${game.drawsThisTurn}` } : null;
}

function intent(view, card, letters, accumulatedLetters = '') {
  const word = previewCardWord(view.game.word, card, letters, accumulatedLetters);
  return { type: 'play', cardId: card.id, letter: letters, accumulatedLetters, word };
}

function candidatesFor(view, card, dictionary) {
  const game = view.game, rule = view.config.cardTypes[card.type], owed = debt(view);
  if (rule.effect === 'pass' || rule.effect === 'replay') return [];
  const choices = game.allowedLettersByCard[card.id];
  // Com débito, Troca troca a última acumulada. Procuramos o resultado desejado
  // no trie e usamos uma letra livre diferente no pagamento, antes da substituição.
  if (owed && rule.effect === 'replace') {
    return dictionary.extensions(game.word, owed, { limit: BOT_RULES.maxPaymentCandidates,
      excludedFirst: owed > 1 ? game.blockedLetter : null }).flatMap((suffix) => {
      const letter = suffix.at(-1);
      if (!choices.includes(letter)) return [];
      const alternate = [...ALPHABET].find((l) => l !== letter && (owed > 1 || l !== game.blockedLetter));
      return [intent(view, card, letter, suffix.slice(0, -1) + alternate)];
    });
  }
  const payments = owed ? dictionary.extensions(game.word, owed, {
    limit: BOT_RULES.maxPaymentCandidates, excludedFirst: game.blockedLetter,
  }) : [''];
  const result = [];
  for (const payment of payments) {
    const base = game.word + payment;
    if (rule.effect === 'appendMany') {
      const options = { minLetters: rule.minLetters, maxLetters: rule.maxLetters,
        excludedFirst: owed ? null : game.blockedLetter };
      const suffixes = dictionary.continuations(base, options);
      suffixes.push(...dictionary.extensions(base, rule.minLetters, options));
      for (const letters of new Set(suffixes)) result.push(intent(view, card, letters, payment));
    } else {
      for (const letter of choices) {
        const action = intent(view, card, letter, payment);
        if (dictionary.hasPrefix(action.word)) result.push(action);
      }
    }
  }
  return result;
}

function fallbackFor(view, card) {
  const game = view.game, effect = view.config.cardTypes[card.type].effect;
  if (effect === 'pass' || effect === 'replay') return intent(view, card, '');
  const owed = debt(view);
  const freeLetter = [...ALPHABET].find((letter) => letter !== game.blockedLetter);
  const payment = owed ? freeLetter.repeat(owed) : '';
  const choices = game.allowedLettersByCard[card.id];
  const letter = [...choices].find((l) => effect !== 'replace' || l !== (game.word + payment).at(-1));
  const letters = effect === 'appendMany' ? letter.repeat(view.config.cardTypes[card.type].minLetters) : letter;
  return intent(view, card, letters, payment);
}

function finishPlay(action, view, dictionary) {
  const card = view.hand.find((c) => c.id === action.cardId);
  const result = { ...action };
  if (view.config.cardTypes[card.type].effect === 'block') {
    result.blockedLetter = dictionary.nextLetters(action.word)[0] || dictionary.nextLetters('')[0] || 'E';
  }
  delete result.word;
  return result;
}

export function chooseTurnAction(view, dictionary, { safety = false } = {}) {
  const game = view.game;
  const cards = view.hand.filter((card) => game.playableCardIds.includes(card.id));
  const letters = safety ? [] : cards.flatMap((card) => candidatesFor(view, card, dictionary));
  // Sem uma boa carta de letra, as defesas também preservam um prefixo já válido.
  // Nesse caso não é necessário comprar antes de usá-las.
  const defenses = !safety && dictionary.hasPrefix(game.word)
    ? cards.filter((card) => ['pass', 'replay'].includes(view.config.cardTypes[card.type].effect)).map((card) => intent(view, card, '')) : [];
  const valid = letters.length ? letters : defenses;
  const score = (action) => {
    const card = view.hand.find((c) => c.id === action.cardId);
    const instantWin = view.hand.length === 1 && ['life', 'pass', 'double'].includes(card.type);
    // Em blefes, prefira gastar cartas antigas. Recomprar e baixar sempre a mesma
    // Vida reciclada pode manter o visor protegido e impedir progresso indefinidamente.
    const justDrawn = !safety && !valid.length && game.drawsThisTurn > 0 && action.cardId === view.hand.at(-1)?.id;
    return (instantWin ? 10_000 : 0) + (view.hand.length === 1 && dictionary.isWord(action.word) ? 1_000 : 0)
      + (dictionary.hasPrefix(action.word) ? 100 : 0) + ({ life: 30, pass: 25, double: 20, multi: 12, block: 8, letter: 5 }[card.type] || 0)
      - (justDrawn ? BOT_RULES.recentDrawBluffPenalty : 0);
  };
  const instant = view.hand.length === 1 && cards.some((c) => ['life', 'pass', 'double'].includes(c.type));
  if (!safety && !valid.length && !instant && game.canDraw) return { type: 'draw' };
  if (cards.length) {
    const options = valid.length ? valid : cards.map((card) => fallbackFor(view, card));
    options.sort((a, b) => score(b) - score(a));
    return finishPlay(options[0], view, dictionary);
  }
  if (game.canDraw) return { type: 'draw' };
  return game.canSkipTurn ? { type: 'skip' } : null;
}

export function decideBotAction(view, dictionary, rng, { safety = false } = {}) {
  const task = botTask(view, dictionary);
  if (!task) return null;
  const challenge = view.game.challenge;
  if (task.kind === 'vote') {
    // Humanos têm a palavra aceita por todos os bots, inclusive pelo desafiante.
    const human = !player(view, challenge.challengedId)?.isBot;
    return { type: 'vote', challengeId: challenge.id, vote: human || dictionary.isWord(view.game.word) ? 'sim' : 'nao' };
  }
  if (task.kind === 'complete') {
    const [letters] = dictionary.continuations(challenge.baseWord, {
      minLetters: CHALLENGE_RULES.minLetters, maxLetters: CHALLENGE_RULES.maxLetters, limit: 1,
    });
    if (letters === undefined) return { type: 'lose', challengeId: challenge.id };
    return { type: challenge.addedLetters === letters ? 'confirm' : 'preview', challengeId: challenge.id, letters };
  }
  if (task.kind === 'accept') return { type: 'accept', pendingId: view.game.pendingVictory.id };
  if (task.kind === 'doubt') {
    const chance = view.game.pendingVictory ? BOT_RULES.finalChallengeChance : BOT_RULES.challengeChance;
    return { type: rng() < chance ? 'challenge' : 'decision', letterPlayNumber: view.game.letterPlayNumber };
  }
  return chooseTurnAction(view, dictionary, { safety });
}
