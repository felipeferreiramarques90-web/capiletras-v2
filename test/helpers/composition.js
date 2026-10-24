import { CONFIGURABLE_CARD_TYPES, DEFAULT_DECK_COMPOSITION } from '../../game/config.js';

// Cenários de regras podem pedir uma carta ausente no padrão (como Vida).
// Inclua-a explicitamente no baralho de teste, sem alterar o padrão da aplicação.
export function compositionForHands(hands) {
  const composition = { ...DEFAULT_DECK_COMPOSITION };
  for (const id of hands.flat()) {
    const [type, index] = id.split('-');
    if (CONFIGURABLE_CARD_TYPES.includes(type)) composition[type] = Math.max(composition[type], Number(index) + 1);
  }
  return composition;
}
