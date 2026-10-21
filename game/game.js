import { ALPHABET, CARD_TYPES, DECK_SIZE, PUBLIC_CONFIG, RULES, maxInitialCards } from './config.js';

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
  return Object.entries(CARD_TYPES).flatMap(([type, rule]) => Array.from({ length: rule.quantity }, (_, i) => {
    if (type !== 'letter') return { id: `${type}-${i}`, type };
    const letter = rule.letters[i % rule.letters.length];
    // IDs continuam únicos mesmo se a configuração passar a repetir letras fixas.
    return { id: `letra-${letter}${i >= rule.letters.length ? `-${i}` : ''}`, type, letter };
  }));
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
  return card.type === 'letter' ? card.letter : (CARD_TYPES[card.type]?.letters || '');
}

export function playableLetters(card, game) {
  const effect = CARD_TYPES[card.type]?.effect;
  if (!game || (effect === 'replace' && !game.word)) return '';
  return [...allowedLetters(card)].filter((letter) => letter !== game.blockedLetter
    && (effect !== 'replace' || letter !== game.word.at(-1))).join('');
}

export function isCardPlayable(card, game) {
  if (!game || !CARD_TYPES[card.type]) return false;
  return CARD_TYPES[card.type].effect === 'replay' ? game.lastPlayerId !== null : playableLetters(card, game).length > 0;
}

export function hasPlayableCard(player, game) {
  return player.hand.some((card) => isCardPlayable(card, game));
}

export function canLoseRound(room, id) {
  const player = room.players.find((p) => p.id === id && p.connected && !p.left);
  return Boolean(room.phase === 'playing' && player && (
    (room.game.canLose && room.game.lastPlayerId === id)
    || (room.game.turnPlayerId === id && !hasPlayableCard(player, room.game))
  ));
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
    if (room.game) room.game.version++;
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
    blockedLetter: null, extraTurns: [], version: 0,
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

function setTurn(room, id) {
  room.game.turnPlayerId = id;
  room.game.drawsThisTurn = 0;
  room.game.turnNumber++;
}

function advanceTurn(room) {
  const game = room.game;
  let anchor = game.turnPlayerId;
  // Pilha de retornos: cada 2x só termina depois do turno de quem o jogou.
  // Retornos desconectados são pulados e sua posição continua sendo a referência.
  while (game.extraTurns.length) {
    const id = game.extraTurns.pop();
    anchor = id;
    if (room.players.some((p) => p.id === id && p.connected && !p.left)) {
      setTurn(room, id);
      return;
    }
  }
  const index = room.players.findIndex((p) => p.id === anchor);
  for (let offset = 1; offset <= room.players.length; offset++) {
    const next = room.players[(index + offset) % room.players.length];
    if (next.connected && !next.left) {
      setTurn(room, next.id);
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
  room.game.version++;
  room.notice = `${player.name} comprou uma carta.`;
  return room;
}

export function playCard(original, id, cardId, choice, blockedChoice) {
  const room = clone(original);
  const player = requireTurn(room, id);
  const index = player.hand.findIndex((card) => card.id === cardId);
  requireRule(index >= 0, 'Essa carta não está na sua mão.');
  const card = player.hand[index];
  const effect = CARD_TYPES[card.type]?.effect;
  requireRule(isCardPlayable(card, room.game), 'Essa carta não pode ser jogada agora.');
  const letter = card.type === 'letter' ? card.letter : (typeof choice === 'string' ? choice.toUpperCase() : '');
  if (effect !== 'replay') requireRule(letter.length === 1 && playableLetters(card, room.game).includes(letter),
    'Escolha uma letra permitida por essa carta, diferente da letra bloqueada e da última letra ao usar Troca.');
  const blockedLetter = typeof blockedChoice === 'string' ? blockedChoice.toUpperCase() : '';
  if (effect === 'block') requireRule(blockedLetter.length === 1 && ALPHABET.includes(blockedLetter), 'Escolha uma letra de A a Z para bloquear.');
  const previousPlayerId = room.game.lastPlayerId;
  player.hand.splice(index, 1);
  room.game.discard.push(card);
  // Só uma jogada com letra consome a restrição já validada acima.
  // 2x preserva o bloqueio para todos; um novo Bloqueio substitui o anterior.
  if (effect !== 'replay') room.game.blockedLetter = effect === 'block' ? blockedLetter : null;
  if (effect === 'replace') {
    const previous = room.game.word.at(-1);
    room.game.word = room.game.word.slice(0, -1) + letter;
    room.notice = `${player.name} jogou Troca: ${previous} virou ${letter}.`;
  } else if (effect === 'replay') {
    const previous = room.players.find((p) => p.id === previousPlayerId);
    room.notice = previous.connected && !previous.left
      ? `${player.name} jogou 2x: ${previous.name} joga de novo; depois a vez volta para ${player.name}.`
      : `${player.name} jogou 2x: ${previous.name} está desconectado; ${player.name} recebe um novo turno.`;
  } else {
    room.game.word += letter;
    room.notice = effect === 'block' ? `${player.name} jogou Bloqueio: adicionou ${letter} e bloqueou ${blockedLetter} até a próxima jogada com letra.`
      : `${player.name} jogou a letra ${letter}.`;
  }
  room.game.lastPlayerId = id;
  room.game.canLose = true;
  room.game.version++;
  if (!player.hand.length) {
    room.phase = 'finished';
    room.game.winnerId = id;
    room.game.canLose = false;
    room.game.extraTurns = [];
    room.notice += ` ${player.name} esvaziou a mão e venceu!`;
  } else if (effect === 'replay') {
    room.game.extraTurns.push(id);
    if (room.players.some((p) => p.id === previousPlayerId && p.connected && !p.left)) setTurn(room, previousPlayerId);
    else advanceTurn(room);
  } else {
    advanceTurn(room);
  }
  return room;
}

export function loseRound(original, id, random, expectedVersion = original.game?.version) {
  const room = clone(original);
  requireRule(room.phase === 'playing', 'Não há partida em andamento.');
  const player = playerById(room, id);
  requireRule(Number.isInteger(expectedVersion) && expectedVersion === room.game.version, 'A mesa mudou. Confira o estado e tente novamente.');
  requireRule(canLoseRound(room, id), 'Só quem baixou a última carta ou está na vez sem carta jogável pode dizer PERDI.');
  const previousBlock = room.game.blockedLetter;
  const cards = takeCards(room.game, RULES.lossPenalty, random);
  player.hand.push(...cards);
  room.game.word = '';
  room.game.blockedLetter = null;
  room.game.canLose = false;
  // Histórico real permanece: 2x continua válido após PERDI, mesmo com o visor vazio.
  room.game.version++;
  room.notice = `${player.name} disse PERDI e comprou ${cards.length} carta${cards.length === 1 ? '' : 's'}. A palavra recomeçou!`;
  if (previousBlock) room.notice += ` O bloqueio da letra ${previousBlock} foi cancelado.`;
  const current = room.players.find((p) => p.id === room.game.turnPlayerId);
  if (!hasPlayableCard(current, room.game) && !room.game.deck.length && !room.game.discard.length) {
    advanceTurn(room);
    room.notice += ' Sem carta jogável nem cartas para comprar: a vez passou.';
  }
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
  if (room.game) room.game.version++;
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
    deckSize: DECK_SIZE, config: PUBLIC_CONFIG, notice: room.notice,
    players: room.players.filter((p) => !p.left || room.phase !== 'lobby').map((p) => ({
      id: p.id, name: p.name, connected: p.connected, left: p.left, cardCount: p.hand.length,
    })),
    hand: structuredClone(viewer.hand),
    game: game ? {
      word: game.word, turnPlayerId: game.turnPlayerId, lastPlayerId: game.lastPlayerId,
      winnerId: game.winnerId, turnNumber: game.turnNumber, drawsThisTurn: game.drawsThisTurn,
      version: game.version, blockedLetter: game.blockedLetter, extraTurns: [...game.extraTurns],
      playableCardIds: viewer.hand.filter((card) => isCardPlayable(card, game)).map((card) => card.id),
      allowedLettersByCard: Object.fromEntries(viewer.hand.map((card) => [card.id, playableLetters(card, game)])),
      deckCount: game.deck.length, discardCount: game.discard.length, availableCount: available,
      paused: connected(room).length < RULES.minPlayers,
      canDraw: myTurn && game.drawsThisTurn < RULES.maxDrawsPerTurn && available > 0,
      canPlay: myTurn,
      canLose: canLoseRound(room, viewerId),
      noPlayableCards: !hasPlayableCard(viewer, game),
    } : null,
  };
}
