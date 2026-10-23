import { CONFIGURABLE_CARD_TYPES, DEFAULT_DECK_COMPOSITION, DECK_RULES, RULES, deckSize, maxInitialCards } from './config.js';
import { GameError } from './errors.js';

// Apenas dados JSON. Salas antigas, sem composição salva, usam o padrão atual.
export const roomComposition = (room) => room.settings.deckComposition ?? DEFAULT_DECK_COMPOSITION;

export function validateComposition(composition) {
  if (!composition || typeof composition !== 'object' || Array.isArray(composition)
    || Object.keys(composition).length !== CONFIGURABLE_CARD_TYPES.length
    || Object.keys(composition).some((type) => !CONFIGURABLE_CARD_TYPES.includes(type))) {
    throw new GameError('Informe apenas todos os tipos configuráveis do baralho.');
  }
  for (const type of CONFIGURABLE_CARD_TYPES) {
    const quantity = composition[type];
    if (!Number.isInteger(quantity) || quantity < DECK_RULES.minQuantity || quantity > DECK_RULES.maxQuantity) {
      throw new GameError(`Use quantidades inteiras de ${DECK_RULES.minQuantity} a ${DECK_RULES.maxQuantity} por tipo.`);
    }
  }
  if (deckSize(composition) > DECK_RULES.maxTotal) throw new GameError(`O baralho pode ter no máximo ${DECK_RULES.maxTotal} cartas.`);
}

export function deckStartIssue(room) {
  const composition = roomComposition(room);
  try { validateComposition(composition); } catch (error) { return error.message; }
  if (!Number.isInteger(room.settings.initialCards) || room.settings.initialCards < RULES.minHand
    || room.settings.initialCards > maxInitialCards(room.settings.playerCount, composition)) {
    return 'Cartas insuficientes para a mão inicial e a reserva de compra. Ajuste a configuração.';
  }
  return null;
}
