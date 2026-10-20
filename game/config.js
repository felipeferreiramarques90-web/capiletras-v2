// Todas as regras ajustáveis ficam aqui. O total do baralho é derivado abaixo.
export const RULES = Object.freeze({
  minPlayers: 2,
  maxPlayers: 8,
  minHand: 3,
  defaultHand: 5,
  wildCards: 12,
  reservedDrawCards: 1,
  maxDrawsPerTurn: 1,
  lossPenalty: 4,
  nameMaxLength: 20,
  emptyRoomTtlMs: 30 * 60 * 1000,
  inactiveRoomTtlMs: 6 * 60 * 60 * 1000,
});

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const LETTERS = Object.freeze({
  letter: ALPHABET,
  wild: ALPHABET,
  vowel: 'AEIOU',
  consonant: 'BCDFGHJKLMNPQRSTVWXYZ',
  first: 'ABCDEFGHIJKLM',
  last: 'NOPQRSTUVWXYZ',
});
export const DECK_SIZE = RULES.wildCards + ALPHABET.length + 4;
export const maxInitialCards = (players) => Math.floor((DECK_SIZE - RULES.reservedDrawCards) / players);
