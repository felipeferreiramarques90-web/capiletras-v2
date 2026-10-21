// Todas as regras ajustáveis ficam aqui. O total do baralho é derivado abaixo.
export const RULES = Object.freeze({
  minPlayers: 2,
  maxPlayers: 8,
  minHand: 3,
  defaultHand: 5,
  reservedDrawCards: 1,
  maxDrawsPerTurn: 1,
  lossPenalty: 4,
  nameMaxLength: 20,
  emptyRoomTtlMs: 30 * 60 * 1000,
  inactiveRoomTtlMs: 6 * 60 * 60 * 1000,
});

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// Composição e comportamento das cartas em uma única fonte, usada também na interface.
export const CARD_TYPES = Object.freeze(Object.fromEntries(Object.entries({
  letter: { quantity: ALPHABET.length, letters: ALPHABET, effect: 'append', label: 'Letra', symbol: '', color: 'ivory' },
  wild: { quantity: 12, letters: ALPHABET, effect: 'append', label: 'Coringa', symbol: '*', color: 'green' },
  vowel: { quantity: 1, letters: 'AEIOU', effect: 'append', label: 'Só vogal', symbol: '→', color: 'peach' },
  consonant: { quantity: 1, letters: 'BCDFGHJKLMNPQRSTVWXYZ', effect: 'append', label: 'Só consoante', symbol: '→', color: 'peach' },
  first: { quantity: 1, letters: 'ABCDEFGHIJKLM', effect: 'append', label: 'A até M', symbol: '→', color: 'peach' },
  last: { quantity: 1, letters: 'NOPQRSTUVWXYZ', effect: 'append', label: 'N até Z', symbol: '→', color: 'peach' },
  swap: { quantity: 8, letters: ALPHABET, effect: 'replace', label: 'Troca', symbol: '🔄', color: 'blue' },
  block: { quantity: 6, letters: ALPHABET, effect: 'block', label: 'Bloqueio', symbol: '➕🚫', color: 'red' },
  double: { quantity: 6, letters: '', effect: 'replay', label: '2x', symbol: '2x', color: 'orange' },
  multi: { quantity: 5, letters: ALPHABET, effect: 'appendMany', minLetters: 2, maxLetters: 16, label: '2+*', symbol: '2+*', color: 'purple' },
  life: { quantity: 5, letters: 'AEIOU', effect: 'append', protectsFromLoss: true, label: 'Vida', description: 'Só vogais', symbol: '❤️', color: 'pink' },
}).map(([type, rule]) => [type, Object.freeze(rule)])));
export const DECK_SIZE = Object.values(CARD_TYPES).reduce((total, card) => total + card.quantity, 0);
export const maxInitialCards = (players) => Math.floor((DECK_SIZE - RULES.reservedDrawCards) / players);
export const PUBLIC_CONFIG = Object.freeze({
  deckSize: DECK_SIZE, cardTypes: CARD_TYPES,
  minHand: RULES.minHand, reservedDrawCards: RULES.reservedDrawCards,
  maxDrawsPerTurn: RULES.maxDrawsPerTurn, lossPenalty: RULES.lossPenalty,
});
