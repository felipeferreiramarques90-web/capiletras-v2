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
  if (!game.paused && game.canPlaySword && game.botSwordDecisionPlay !== game.playNumber) {
    return { kind: 'sword', key: `sword:${game.playNumber}` };
  }
  return !game.paused && game.canPlay ? { kind: 'turn', key: `turn:${game.turnNumber}:${game.drawsThisTurn}` } : null;
}

function intent(view, card, letters, accumulatedLetters = '') {
  const word = previewCardWord(view.game.word, card, letters, accumulatedLetters);
  return { type: 'play', cardId: card.id, letter: letters, accumulatedLetters, word };
}

const pick = (options, rng) => options.length === 1 ? options[0] : options[Math.floor(rng() * options.length)];

// Exatamente um sorteio de modo por decisão de letras. O fallback não sorteia
// outro modo, e os dois léxicos permanecem argumentos locais, fora do estado.
function letterOptions(dictionary, commonDictionary, rng, collect) {
  const erudite = rng() < BOT_RULES.eruditeChance;
  const selected = erudite ? dictionary : commonDictionary;
  const options = collect(selected);
  return options.length || selected === dictionary ? { options, dictionary: selected }
    : { options: collect(dictionary), dictionary };
}

function candidatesFor(view, card, dictionary) {
  const game = view.game, rule = view.config.cardTypes[card.type], owed = debt(view);
  if (rule.effect === 'pass' || rule.effect === 'replay') return [];
  const choices = game.allowedLettersByCard[card.id];
  // Com débito, Troca troca a última acumulada. Procuramos o resultado desejado
  // no trie e usamos uma letra livre diferente no pagamento, antes da substituição.
  if (owed && rule.effect === 'replace') {
    return dictionary.allExtensions(game.word, owed, {
      excludedFirst: owed > 1 ? game.blockedLetter : null }).flatMap((suffix) => {
      const letter = suffix.at(-1);
      if (!choices.includes(letter)) return [];
      return [...ALPHABET].filter((l) => l !== letter && (owed > 1 || l !== game.blockedLetter))
        .map((alternate) => intent(view, card, letter, suffix.slice(0, -1) + alternate));
    });
  }
  const payments = owed ? dictionary.allExtensions(game.word, owed, {
    excludedFirst: game.blockedLetter,
  }) : [''];
  const result = [];
  for (const payment of payments) {
    const base = game.word + payment;
    if (rule.effect === 'appendMany') {
      const options = { minLetters: rule.minLetters, maxLetters: rule.maxLetters,
        excludedFirst: owed ? null : game.blockedLetter };
      // Uma opção por palavra completa, sem cortar candidatas por ordem da trie.
      for (const letters of dictionary.allContinuations(base, options)) result.push(intent(view, card, letters, payment));
    } else {
      for (const letter of choices) {
        const action = intent(view, card, letter, payment);
        if (dictionary.hasPrefix(action.word)) result.push(action);
      }
    }
  }
  return result;
}

function fallbackFor(view, card, rng) {
  const game = view.game, effect = view.config.cardTypes[card.type].effect;
  if (effect === 'pass' || effect === 'replay') return intent(view, card, '');
  const owed = debt(view);
  const free = [...ALPHABET].filter((letter) => letter !== game.blockedLetter);
  const payment = Array.from({ length: owed }, (_, i) => pick(i === 0 ? free : [...ALPHABET], rng)).join('');
  const choices = game.allowedLettersByCard[card.id];
  const letter = pick([...choices].filter((l) => effect !== 'replace' || l !== (game.word + payment).at(-1)), rng);
  const letters = effect === 'appendMany' ? letter + Array.from({ length: view.config.cardTypes[card.type].minLetters - 1 },
    () => pick([...ALPHABET], rng)).join('') : letter;
  return intent(view, card, letters, payment);
}

function finishPlay(action, view, dictionary) {
  const card = view.hand.find((c) => c.id === action.cardId);
  const result = { ...action };
  if (view.config.cardTypes[card.type].effect === 'block') {
    // O alvo defensivo do Bloqueio mantém a estratégia anterior no léxico
    // completo; o modo comum/erudito muda somente a letra que entra no visor.
    result.blockedLetter = dictionary.nextLetters(action.word)[0] || dictionary.nextLetters('')[0] || 'E';
  }
  delete result.word;
  return result;
}

export function chooseTurnAction(view, dictionary, { safety = false, rng, commonDictionary = dictionary } = {}) {
  const game = view.game;
  const cards = view.hand.filter((card) => game.playableCardIds.includes(card.id));
  const selected = letterOptions(dictionary, commonDictionary, rng,
    (lexicon) => cards.flatMap((card) => candidatesFor(view, card, lexicon)));
  const letters = selected.options;
  // Sem uma boa carta de letra, as defesas também preservam um prefixo já válido.
  // Nesse caso não é necessário comprar antes de usá-las.
  const defenses = !safety && dictionary.hasPrefix(game.word)
    ? cards.filter((card) => ['pass', 'replay'].includes(view.config.cardTypes[card.type].effect)).map((card) => intent(view, card, '')) : [];
  let valid = letters.length ? letters : defenses;
  // Mantém a preferência já existente por completar a palavra na última carta.
  if (view.hand.length === 1) {
    const complete = valid.filter((action) => dictionary.isWord(action.word));
    if (complete.length) valid = complete;
  }
  if (valid.length) return finishPlay(pick(valid, rng), view, dictionary);
  const score = (action) => {
    const card = view.hand.find((c) => c.id === action.cardId);
    // Em blefes, prefira gastar cartas antigas. Recomprar e baixar sempre a mesma
    // Vida reciclada pode manter o visor protegido e impedir progresso indefinidamente.
    const justDrawn = !safety && game.drawsThisTurn > 0 && card.id === view.hand.at(-1)?.id;
    return (dictionary.hasPrefix(action.word) ? 100 : 0)
      + ({ life: 30, pass: 25, double: 20, multi: 12, block: 8, letter: 5 }[card.type] || 0)
      - (justDrawn ? BOT_RULES.recentDrawBluffPenalty : 0);
  };
  if (!safety && game.canDraw) return { type: 'draw' };
  if (cards.length) {
    const options = cards.map((card) => fallbackFor(view, card, rng));
    const best = Math.max(...options.map(score));
    return finishPlay(pick(options.filter((action) => score(action) === best), rng), view, dictionary);
  }
  if (game.canDraw) return { type: 'draw' };
  return game.canSkipTurn ? { type: 'skip' } : null;
}

export function decideBotAction(view, dictionary, rng, { safety = false, commonDictionary = dictionary } = {}) {
  const task = botTask(view, dictionary);
  if (!task) return null;
  const challenge = view.game.challenge;
  if (task.kind === 'vote') {
    // Humanos têm a palavra aceita por todos os bots, inclusive pelo desafiante.
    const human = !player(view, challenge.challengedId)?.isBot;
    return { type: 'vote', challengeId: challenge.id, vote: human || dictionary.isWord(view.game.word) ? 'sim' : 'nao' };
  }
  if (task.kind === 'complete') {
    // Uma prévia já escolhida é confirmada sem refazer o sorteio ao receber o
    // próprio broadcast. Isso também garante OK dentro do prazo do desafio.
    if (challenge.addedLetters && dictionary.isWord(challenge.baseWord + challenge.addedLetters)) {
      return { type: 'confirm', challengeId: challenge.id, letters: challenge.addedLetters };
    }
    const selected = letterOptions(dictionary, commonDictionary, rng, (lexicon) => lexicon.allContinuations(challenge.baseWord, {
      minLetters: CHALLENGE_RULES.minLetters, maxLetters: CHALLENGE_RULES.maxLetters,
    }));
    const letters = selected.options.length ? pick(selected.options, rng) : undefined;
    if (letters === undefined) return { type: 'lose', challengeId: challenge.id };
    return { type: challenge.addedLetters === letters ? 'confirm' : 'preview', challengeId: challenge.id, letters };
  }
  if (task.kind === 'sword') {
    const chosen = rng() < BOT_RULES.swordChance;
    const selected = chosen ? letterOptions(dictionary, commonDictionary, rng, (lexicon) => view.hand
      .filter((card) => card.type === 'sword' && view.game.playableCardIds.includes(card.id))
      .flatMap((card) => candidatesFor(view, card, lexicon))) : { options: [] };
    return selected.options.length ? { ...finishPlay(pick(selected.options, rng), view, selected.dictionary), type: 'sword', playNumber: view.game.playNumber }
      : { type: 'sword-decision', playNumber: view.game.playNumber };
  }
  if (task.kind === 'accept') return { type: 'accept', pendingId: view.game.pendingVictory.id };
  if (task.kind === 'doubt') {
    const chance = view.game.pendingVictory ? BOT_RULES.finalChallengeChance : BOT_RULES.challengeChance;
    return { type: rng() < chance ? 'challenge' : 'decision', letterPlayNumber: view.game.letterPlayNumber };
  }
  return chooseTurnAction(view, dictionary, { safety, rng, commonDictionary });
}
