import { ALPHABET, DECK_SIZE, LETTERS, RULES, maxInitialCards } from './config.js';

export class GameError extends Error {}
const requireRule = (condition, message) => { if (!condition) throw new GameError(message); };
const clone = (room) => structuredClone(room);
const connected = (room) => room.players.filter((p) => p.connected && !p.left);
const playerById = (room, id) => {
  const player = room.players.find((p) => p.id === id && !p.left);
  requireRule(player, 'Jogador não encontrado nesta sala.');
  return player;
};
const requireHost = (room, id) => requireRule(room.hostId === id, 'Só o anfitrião pode fazer isso.');
const cleanName = (value) => {
  requireRule(typeof value === 'string', 'Informe seu nome.');
  const name = value.trim().replace(/\s+/g, ' ');
  requireRule(name.length > 0 && name.length <= RULES.nameMaxLength, 'Use um nome de 1 a 20 caracteres.');
  return name;
};

// Não acessa relógio, rede ou armazenamento; aleatoriedade e horário são injetados.
export function createDeck() {
  const deck = [...ALPHABET].map((letter) => ({ id: `letra-${letter}`, type: 'letter', letter }));
  for (let i = 0; i < RULES.wildCards; i++) deck.push({ id: `coringa-${i}`, type: 'wild' });
  for (const type of ['vowel', 'consonant', 'first', 'last']) deck.push({ id: type, type });
  return deck;
}

export function shuffle(cards, random) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function allowedLetters(card) {
  return card.type === 'letter' ? card.letter : (LETTERS[card.type] || '');
}

export function createRoom({ code, playerId, sessionId, name, now }) {
  return {
    code, hostId: playerId, phase: 'lobby', createdAt: now, updatedAt: now,
    emptySince: null, settings: { playerCount: 2, initialCards: RULES.defaultHand },
    players: [{ id: playerId, sessionId, name: cleanName(name), connected: true, left: false, hand: [] }],
    game: null,
    notice: 'Sala criada. Convide seus amigos!',
  };
}

export function joinRoom(original, { playerId, sessionId, name }) {
  const room = clone(original);
  const existing = room.players.find((p) => p.sessionId === sessionId && !p.left);
  if (existing) {
    existing.connected = true;
    room.emptySince = null;
    if (!room.players.some((p) => p.id === room.hostId && p.connected && !p.left)) room.hostId = existing.id;
    resumeTurn(room);
    return room;
  }
  requireRule(room.phase === 'lobby', 'Esta partida já começou. Só participantes podem reconectar.');
  requireRule(room.players.length < room.settings.playerCount, 'A sala está cheia.');
  room.players.push({ id: playerId, sessionId, name: cleanName(name), connected: true, left: false, hand: [] });
  room.emptySince = null;
  room.notice = `${room.players.at(-1).name} entrou na sala.`;
  return room;
}

export function updateSettings(original, id, settings) {
  const room = clone(original);
  requireHost(room, id);
  requireRule(room.phase === 'lobby', 'A partida já começou.');
  requireRule(settings && typeof settings === 'object', 'Configuração inválida.');
  const { playerCount, initialCards } = settings;
  requireRule(Number.isInteger(playerCount) && playerCount >= RULES.minPlayers && playerCount <= RULES.maxPlayers,
    'Escolha entre 2 e 8 jogadores.');
  requireRule(playerCount >= room.players.length, 'Há mais jogadores na sala do que o limite escolhido.');
  requireRule(Number.isInteger(initialCards) && initialCards >= RULES.minHand && initialCards <= maxInitialCards(playerCount),
    `Escolha de 3 a ${maxInitialCards(playerCount)} cartas para essa quantidade de jogadores.`);
  room.settings = { playerCount, initialCards };
  return room;
}

export function startGame(original, id, random) {
  const room = clone(original);
  requireHost(room, id);
  requireRule(room.phase === 'lobby' || room.phase === 'finished', 'A partida já começou.');
  room.players = room.players.filter((p) => !p.left);
  requireRule(room.players.length === room.settings.playerCount && room.players.every((p) => p.connected),
    `Aguarde os ${room.settings.playerCount} jogadores ficarem conectados ou ajuste a sala.`);
  const deck = shuffle(createDeck(), random);
  for (const player of room.players) player.hand = deck.splice(0, room.settings.initialCards);
  room.phase = 'playing';
  room.game = {
    deck, discard: [], word: '', turnPlayerId: room.players[0].id, drawsThisTurn: 0,
    lastPlayerId: null, canLose: false, winnerId: null, turnNumber: 1,
  };
  room.notice = 'A partida começou. Boa sorte!';
  return room;
}

function requireTurn(room, id) {
  requireRule(room.phase === 'playing', 'Não há partida em andamento.');
  const player = playerById(room, id);
  requireRule(player.connected, 'Reconecte para continuar.');
  requireRule(connected(room).length >= RULES.minPlayers, 'Partida pausada. Aguardando outro jogador reconectar.');
  requireRule(room.game.turnPlayerId === id, 'Aguarde a sua vez.');
  return player;
}

function advanceTurn(room) {
  const game = room.game;
  const index = room.players.findIndex((p) => p.id === game.turnPlayerId);
  for (let offset = 1; offset <= room.players.length; offset++) {
    const next = room.players[(index + offset) % room.players.length];
    if (next.connected && !next.left) {
      game.turnPlayerId = next.id;
      game.drawsThisTurn = 0;
      game.turnNumber++;
      return;
    }
  }
}

function resumeTurn(room) {
  if (room.phase !== 'playing') return;
  const current = room.players.find((p) => p.id === room.game.turnPlayerId);
  if (!current?.connected || current.left) advanceTurn(room);
}

// A mesma compra é usada na compra opcional e na penalidade; só a primeira conta no limite do turno.
function takeCards(game, count, random) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    if (!game.deck.length && game.discard.length) {
      game.deck = shuffle(game.discard, random);
      game.discard = [];
    }
    if (!game.deck.length) break;
    cards.push(game.deck.pop());
  }
  return cards;
}

export function drawCard(original, id, random) {
  const room = clone(original);
  const player = requireTurn(room, id);
  requireRule(room.game.drawsThisTurn < RULES.maxDrawsPerTurn, 'Você já comprou neste turno. Baixe uma carta.');
  const cards = takeCards(room.game, 1, random);
  requireRule(cards.length, 'Não há cartas disponíveis para compra.');
  player.hand.push(...cards);
  room.game.drawsThisTurn++;
  room.notice = `${player.name} comprou uma carta.`;
  return room;
}

export function playCard(original, id, cardId, choice) {
  const room = clone(original);
  const player = requireTurn(room, id);
  const index = player.hand.findIndex((card) => card.id === cardId);
  requireRule(index >= 0, 'Essa carta não está na sua mão.');
  const card = player.hand[index];
  const letter = card.type === 'letter' ? card.letter : (typeof choice === 'string' ? choice.toUpperCase() : '');
  requireRule(letter.length === 1 && allowedLetters(card).includes(letter), 'Escolha uma letra permitida por essa carta.');
  player.hand.splice(index, 1);
  room.game.discard.push(card);
  room.game.word += letter;
  room.game.lastPlayerId = id;
  room.game.canLose = true;
  room.notice = `${player.name} jogou a letra ${letter}.`;
  if (!player.hand.length) {
    room.phase = 'finished';
    room.game.winnerId = id;
    room.game.canLose = false;
    room.notice = `${player.name} esvaziou a mão e venceu!`;
  } else {
    advanceTurn(room);
  }
  return room;
}

export function loseRound(original, id, random) {
  const room = clone(original);
  requireRule(room.phase === 'playing', 'Não há partida em andamento.');
  const player = playerById(room, id);
  requireRule(player.connected && room.game.canLose && room.game.lastPlayerId === id,
    'Só quem baixou a última carta pode dizer PERDI, antes da próxima jogada.');
  const cards = takeCards(room.game, RULES.lossPenalty, random);
  player.hand.push(...cards);
  room.game.word = '';
  room.game.canLose = false;
  room.game.lastPlayerId = null;
  room.notice = `${player.name} disse PERDI e comprou ${cards.length} carta${cards.length === 1 ? '' : 's'}. A palavra recomeçou!`;
  return room;
}

export function disconnectPlayer(original, id, now, leave = false) {
  const room = clone(original);
  const player = playerById(room, id);
  player.connected = false;
  player.left = leave;
  room.notice = `${player.name} ${leave ? 'saiu da sala' : 'desconectou; a vaga está reservada'}.`;
  if (leave && room.phase === 'lobby') room.players = room.players.filter((p) => p.id !== id);
  const active = connected(room);
  if (id === room.hostId && active.length) room.hostId = active[0].id;
  if (!active.length && room.emptySince === null) room.emptySince = now;
  resumeTurn(room);
  return room;
}

export function returnToLobby(original, id) {
  const room = clone(original);
  requireHost(room, id);
  requireRule(room.phase === 'finished' || (room.phase === 'playing' && connected(room).length < RULES.minPlayers),
    'A partida ainda não terminou. Só é possível encerrar antecipadamente uma partida pausada.');
  room.phase = 'lobby';
  room.game = null;
  room.players = room.players.filter((p) => !p.left && p.connected);
  for (const player of room.players) player.hand = [];
  room.notice = 'De volta à sala. Prontos para outra?';
  return room;
}

export function removeFromLobby(original, hostId, playerId) {
  const room = clone(original);
  requireHost(room, hostId);
  requireRule(room.phase === 'lobby', 'Só é possível remover uma vaga na sala de espera.');
  const player = playerById(room, playerId);
  requireRule(!player.connected, 'Só é possível liberar a vaga de um jogador desconectado.');
  room.players = room.players.filter((p) => p.id !== playerId);
  room.notice = `A vaga de ${player.name} foi liberada.`;
  return room;
}

export function shouldDeleteRoom(room, now) {
  return !room.players.length || (room.emptySince !== null && now - room.emptySince >= RULES.emptyRoomTtlMs)
    || now - room.updatedAt >= RULES.inactiveRoomTtlMs;
}

// Lista explícita dos campos públicos: nunca serialize a sala inteira para o Socket.IO.
export function roomView(room, viewerId) {
  const viewer = playerById(room, viewerId);
  const game = room.game;
  const available = game ? game.deck.length + game.discard.length : 0;
  const myTurn = room.phase === 'playing' && game.turnPlayerId === viewerId && connected(room).length >= RULES.minPlayers;
  return {
    code: room.code, phase: room.phase, hostId: room.hostId, meId: viewerId,
    settings: { ...room.settings, maxInitialCards: maxInitialCards(room.settings.playerCount) },
    deckSize: DECK_SIZE, notice: room.notice,
    players: room.players.filter((p) => !p.left || room.phase !== 'lobby').map((p) => ({
      id: p.id, name: p.name, connected: p.connected, left: p.left, cardCount: p.hand.length,
    })),
    hand: structuredClone(viewer.hand),
    game: game ? {
      word: game.word, turnPlayerId: game.turnPlayerId, lastPlayerId: game.lastPlayerId,
      winnerId: game.winnerId, turnNumber: game.turnNumber, drawsThisTurn: game.drawsThisTurn,
      deckCount: game.deck.length, discardCount: game.discard.length, availableCount: available,
      paused: connected(room).length < RULES.minPlayers,
      canDraw: myTurn && game.drawsThisTurn < RULES.maxDrawsPerTurn && available > 0,
      canPlay: myTurn,
      canLose: room.phase === 'playing' && game.canLose && game.lastPlayerId === viewerId,
    } : null,
  };
}
