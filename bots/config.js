// Um único nível. Tempos são de execução; nenhum timer entra no JSON da sala.
export const CHANCE_BOT_DUVIDAR = 0.35;
export const CHANCE_BOT_DUVIDAR_ULTIMA_CARTA = 0.75;
export const CHANCE_BOT_ESPADA = 0.2;
export const CHANCE_BOT_ERUDITO = 0.10;
export const BOT_RULES = Object.freeze({
  actionMinMs: 5_000, actionMaxMs: 13_000,
  finalDoubtMinMs: 1_000, finalDoubtMaxMs: 8_000, deadlineMarginMs: 250,
  responseMinMs: 500, responseMaxMs: 1_500,
  challengeChance: CHANCE_BOT_DUVIDAR, finalChallengeChance: CHANCE_BOT_DUVIDAR_ULTIMA_CARTA,
  swordChance: CHANCE_BOT_ESPADA,
  eruditeChance: CHANCE_BOT_ERUDITO,
  commonMinFrequency: 1_000,
  maxAttemptsPerTurn: 3,
  maxContinuations: 48, maxSearchNodes: 20_000,
  minWordLength: 3,
  recentDrawBluffPenalty: 50,
});
export const BOT_NAMES = Object.freeze([
  'Bot Capivara', 'Bot Zagueiro', 'Bot Goleiro', 'Bot Artilheiro',
  'Bot Craque', 'Bot Lateral', 'Bot Volante', 'Bot Camisa Dez',
]);
