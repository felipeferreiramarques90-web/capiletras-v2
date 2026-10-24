// Um único nível. Tempos são de execução; nenhum timer entra no JSON da sala.
export const CHANCE_BOT_DUVIDAR = 0.35;
export const CHANCE_BOT_DUVIDAR_ULTIMA_CARTA = 0.75;
export const CHANCE_BOT_ESPADA = 0.2;
export const BOT_RULES = Object.freeze({
  actionMinMs: 1_000, actionMaxMs: 3_000,
  responseMinMs: 500, responseMaxMs: 1_500,
  challengeChance: CHANCE_BOT_DUVIDAR, finalChallengeChance: CHANCE_BOT_DUVIDAR_ULTIMA_CARTA,
  swordChance: CHANCE_BOT_ESPADA,
  maxAttemptsPerTurn: 3,
  maxPaymentCandidates: 96, maxContinuations: 48, maxSearchNodes: 20_000,
  minWordLength: 3,
  recentDrawBluffPenalty: 50,
});
export const BOT_NAMES = Object.freeze([
  'Bot Capivara', 'Bot Zagueiro', 'Bot Goleiro', 'Bot Artilheiro',
  'Bot Craque', 'Bot Lateral', 'Bot Volante', 'Bot Camisa Dez',
]);
