import { syncOfflineTurn, resolveOfflineTurn } from './offline.js';
import { resolveChallenge } from './challenge.js';
import { resolvePendingVictory } from './victory.js';

// Suspende antes de resolver fases vencidas; assim o tempo gasto no desafio não
// é descontado da espera do desconectado ao restaurar uma sala salva.
export function settleRoom(room, now, rng) {
  return resolveOfflineTurn(resolvePendingVictory(resolveChallenge(syncOfflineTurn(room,now),now,rng),now),now,rng);
}
