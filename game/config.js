// Todas as regras ajustáveis ficam aqui. O total do baralho é derivado abaixo.
export const RULES = Object.freeze({
  minPlayers: 2,
  maxPlayers: 8,
  minHand: 3,
  defaultHand: 7,
  defaultAutomaticValidation: true,
  minHandForRestrictedCards: 2,
  actionNoticeMs: 1200,
  reservedDrawCards: 1,
  maxDrawsPerTurn: 1,
  lossPenalty: 4,
  victoryWindowMs: 10_000,
  nameMaxLength: 20,
  emptyRoomTtlMs: 30 * 60 * 1000,
  inactiveRoomTtlMs: 6 * 60 * 60 * 1000,
});

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const CHALLENGE_RULES = Object.freeze({
  validationFallbackNotice: 'Validação automática indisponível, a mesa vota',
  completionMs: 30_000,
  voteMs: 15_000,
  minLetters: 0,
  maxLetters: 16,
  rejectionRatio: 0.5,
  tickMs: 250,
  previewIntervalMs: 300,
});
// Composição e comportamento das cartas em uma única fonte, usada também na interface.
export const CARD_TYPES = Object.freeze(Object.fromEntries(Object.entries({
  letter: { quantity: ALPHABET.length, letters: ALPHABET, effect: 'append', label: 'Letra', symbol: '', color: 'ivory' },
  wild: { quantity: 12, letters: ALPHABET, effect: 'append', label: 'Coringa', symbol: '*', color: 'green' },
  vowel: { quantity: 1, letters: 'AEIOU', effect: 'append', label: 'Só vogal', symbol: '→', color: 'peach' },
  consonant: { quantity: 1, letters: 'BCDFGHJKLMNPQRSTVWXYZ', effect: 'append', label: 'Só consoante', symbol: '→', color: 'peach' },
  first: { quantity: 1, letters: 'ABCDEFGHIJKLM', effect: 'append', label: 'A até M', symbol: '→', color: 'peach' },
  last: { quantity: 1, letters: 'NOPQRSTUVWXYZ', effect: 'append', label: 'N até Z', symbol: '→', color: 'peach' },
  swap: { quantity: 6, letters: ALPHABET, effect: 'replace', label: 'Troca', symbol: '🔄', color: 'blue' },
  block: { quantity: 6, letters: ALPHABET, effect: 'block', label: 'Bloqueio', symbol: '➕🚫', color: 'red' },
  double: { cannotBeLast: true, quantity: 6, letters: '', effect: 'replay', label: '2x', symbol: '2x', color: 'double' },
  multi: { quantity: 4, letters: ALPHABET, effect: 'appendMany', minLetters: 2, maxLetters: 16, label: '2+*', symbol: '2+*', color: 'purple' },
  life: { cannotBeLast: true, quantity: 0, letters: 'AEIOU', effect: 'append', protectsFromChallenge: true, label: 'Vida', description: 'Só vogais', symbol: '❤️', color: 'pink' },
  pass: { cannotBeLast: true, quantity: 8, letters: '', effect: 'pass', debtIncrement: 1, label: 'Passar letra', symbol: '→', color: 'black' },
  sword: { cannotBeLast: true, quantity: 4, letters: ALPHABET, effect: 'interrupt', label: 'Jogar na vez do outro', caption: 'jogue na vez do outro', symbol: '⚔️', color: 'sword' },
}).map(([type, rule]) => [type, Object.freeze(rule)])));
export const CONFIGURABLE_CARD_TYPES = Object.freeze(['wild', 'life', 'pass', 'swap', 'block', 'double', 'multi', 'sword']);
export const DECK_RULES = Object.freeze({ minQuantity: 0, maxQuantity: 30, maxTotal: 150, swordUnavailablePlayers: 2 });
// Os padrões vêm das quantidades acima; letras e restritivas continuam fixas.
export const DEFAULT_DECK_COMPOSITION = Object.freeze(Object.fromEntries(
  CONFIGURABLE_CARD_TYPES.map((type) => [type, CARD_TYPES[type].quantity]),
));
export const compositionForPlayers = (composition, participants) => participants === DECK_RULES.swordUnavailablePlayers
  ? { ...composition, sword: 0 } : { ...composition };
export const deckSize = (composition = DEFAULT_DECK_COMPOSITION, participants) => {
  const effective = compositionForPlayers(composition, participants);
  return Object.entries(CARD_TYPES).reduce((total, [type, card]) => total
    + (CONFIGURABLE_CARD_TYPES.includes(type) ? effective[type] : card.quantity), 0);
};
export const DECK_SIZE = deckSize();
export const maxInitialCards = (players, composition = DEFAULT_DECK_COMPOSITION, participants = players) => Math.floor((deckSize(composition, participants) - RULES.reservedDrawCards) / players);
export const PUBLIC_CONFIG = Object.freeze({
  maxPlayers: RULES.maxPlayers,
  deckSize: DECK_SIZE, cardTypes: CARD_TYPES,
  configurableCardTypes: CONFIGURABLE_CARD_TYPES, defaultDeckComposition: DEFAULT_DECK_COMPOSITION, deckRules: DECK_RULES,
  minHand: RULES.minHand, reservedDrawCards: RULES.reservedDrawCards,
  maxDrawsPerTurn: RULES.maxDrawsPerTurn, lossPenalty: RULES.lossPenalty,
  challenge: CHALLENGE_RULES,
  victoryWindowMs: RULES.victoryWindowMs, minHandForRestrictedCards: RULES.minHandForRestrictedCards, actionNoticeMs: RULES.actionNoticeMs,
});
