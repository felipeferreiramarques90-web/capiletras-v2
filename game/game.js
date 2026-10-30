import { ALPHABET, CARD_TYPES, CONFIGURABLE_CARD_TYPES, DEFAULT_DECK_COMPOSITION, PUBLIC_CONFIG, RULES, compositionForPlayers, deckSize, maxInitialCards } from './config.js';
import { deckStartIssue, roomComposition, lobbyComposition, effectiveRoomComposition, participantCount, roomHandLimit, validateComposition } from './deck.js';
import { GameError } from './errors.js';
import { beginPendingVictory } from './victory.js';

export { GameError } from './errors.js';
const requireRule = (condition, message) => { if (!condition) throw new GameError(message); };
const clone = (room) => structuredClone(room);
const connected = (room) => room.players.filter((p) => p.connected && !p.left);
const playerById = (room, id) => {
  const player = room.players.find((p) => p.id === id && !p.left);
  requireRule(player, 'Jogador não encontrado nesta sala.');
  return player;
};
const requireHost = (room, id) => requireRule(room.hostId === id && room.players.some((p) => p.id === id && !p.isBot), 'Só o anfitrião pode fazer isso.');
const cleanName = (value) => {
  requireRule(typeof value === 'string', 'Informe seu nome.');
  const name = value.trim().replace(/\s+/g, ' ');
  requireRule(name.length > 0 && name.length <= RULES.nameMaxLength, 'Use um nome de 1 a 20 caracteres.');
  return name;
};

// Não acessa relógio, rede ou armazenamento; aleatoriedade e horário são injetados.
export function createDeck(composition = DEFAULT_DECK_COMPOSITION, participants) {
  validateComposition(composition);
  composition = compositionForPlayers(composition, participants);
  return Object.entries(CARD_TYPES).flatMap(([type, rule]) => Array.from({ length: CONFIGURABLE_CARD_TYPES.includes(type) ? composition[type] : rule.quantity }, (_, i) => {
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

// Prévia compartilhada pelo cérebro e pela aplicação da jogada. A validação
// continua em playCard; este helper não autoriza nem modifica estado algum.
export function previewCardWord(word, card, choice = '', accumulatedLetters = '') {
  const base = word + accumulatedLetters, effect = CARD_TYPES[card.type]?.effect;
  if (effect === 'replace') return base.slice(0, -1) + choice;
  if (effect === 'pass' || effect === 'replay') return base;
  return base + (card.type === 'letter' ? card.letter : choice);
}

export function debtForPlayer(game, id = game?.turnPlayerId) {
  return game?.letterDebt && game.letterDebt.playerId === id ? game.letterDebt.count : 0;
}

function swordEligible(game, id) {
  return Boolean(game && id && game.turnPlayerId !== id && game.lastPlayerId !== id
    && !game.letterDebt.count && !game.challenge && !game.pendingVictory && !game.winnerId);
}

export function canPlaySword(room, id) {
  const player = room.players.find((p) => p.id === id && p.connected && !p.left);
  return Boolean(room.phase === 'playing' && player && connected(room).length >= RULES.minPlayers
    && swordEligible(room.game, id) && player.hand.some((card) => card.type === 'sword' && isCardPlayable(card, room.game, id, player.hand.length)));
}

export function playableLetters(card, game, id = game?.turnPlayerId) {
  const effect = CARD_TYPES[card.type]?.effect;
  const owesLetters = debtForPlayer(game, id) > 0;
  if (effect === 'interrupt' && !swordEligible(game, id)) return '';
  if (!game || (effect === 'replace' && !game.word && !owesLetters)) return '';
  // O pagamento precede a carta e consome o Bloqueio. Na Troca, a última letra
  // dependerá do texto acumulado; a validação definitiva acontece na jogada.
  return [...allowedLetters(card)].filter((letter) => (owesLetters || letter !== game.blockedLetter)
    && (effect !== 'replace' || owesLetters || letter !== game.word.at(-1))).join('');
}

export function isLastCardRestricted(card, handSize) {
  return Boolean(CARD_TYPES[card.type]?.cannotBeLast && handSize < RULES.minHandForRestrictedCards);
}

// O tamanho real da mão participa da validação, tanto para humanos quanto bots.
export function isCardPlayable(card, game, id = game?.turnPlayerId, handSize = 0) {
  if (!game || !CARD_TYPES[card.type] || isLastCardRestricted(card, handSize)) return false;
  const effect = CARD_TYPES[card.type].effect;
  if (effect === 'pass') return true;
  return effect === 'replay' ? game.lastPlayerId !== null : playableLetters(card, game, id).length > 0;
}

export function hasPlayableCard(player, game) {
  return player.hand.some((card) => isCardPlayable(card, game, player.id, player.hand.length));
}

export function canSkipTurn(room, id) {
  const player = room.players.find((p) => p.id === id && p.connected && !p.left);
  return Boolean(room.phase === 'playing' && !room.game.challenge && !room.game.pendingVictory && player
    && connected(room).length >= RULES.minPlayers && player.hand.length > 0
    && (room.game.drawsThisTurn > 0 || room.game.deck.length + room.game.discard.length === 0)
    && room.game.turnPlayerId === id && !hasPlayableCard(player, room.game));
}

export function createRoom({ code, playerId, sessionId, name, now }) {
  return {
    code, hostId: playerId, phase: 'lobby', createdAt: now, updatedAt: now,
    emptySince: null, settings: { playerCount: 2, initialCards: RULES.defaultHand, automaticValidation: RULES.defaultAutomaticValidation, deckComposition: { ...DEFAULT_DECK_COMPOSITION } },
    players: [{ id: playerId, sessionId, name: cleanName(name), connected: true, left: false, hand: [] }],
    game: null,
    notice: 'Sala criada. Convide seus amigos!',
  };
}

export function joinRoom(original, { playerId, sessionId, name }) {
  const room = clone(original);
  const existing = room.players.find((p) => !p.isBot && p.sessionId === sessionId && !p.left);
  if (existing) {
    existing.connected = true;
    room.emptySince = null;
    if (!room.players.some((p) => p.id === room.hostId && !p.isBot && p.connected && !p.left)) room.hostId = existing.id;
    resumeTurn(room);
    if (room.game) room.game.version++;
    return room;
  }
  requireRule(room.phase === 'lobby', 'Esta partida já começou. Só participantes podem reconectar.');
  requireRule(room.players.length < room.settings.playerCount, 'A sala está cheia.');
  room.players.push({ id: playerId, sessionId, name: cleanName(name), connected: true, left: false, hand: [] });
  room.emptySince = null;
  adjustLobbyHand(room);
  room.notice = `${room.players.at(-1).name} entrou na sala.`;
  return room;
}

export function updateSettings(original, id, settings) {
  const room = clone(original);
  requireHost(room, id);
  requireRule(room.phase === 'lobby', 'A partida já começou.');
  requireRule(settings && typeof settings === 'object' && !Array.isArray(settings), 'Configuração inválida.');
  requireRule(['playerCount', 'initialCards', 'automaticValidation'].some((key) => Object.hasOwn(settings, key)), 'Configuração inválida.');
  requireRule(!Object.hasOwn(settings, 'automaticValidation') || typeof settings.automaticValidation === 'boolean', 'Validação automática deve ser ligada ou desligada.');
  const { playerCount = room.settings.playerCount, initialCards = room.settings.initialCards,
    automaticValidation = room.settings.automaticValidation ?? RULES.defaultAutomaticValidation } = settings;
  requireRule(typeof automaticValidation === 'boolean', 'Validação automática deve ser ligada ou desligada.');
  requireRule(Number.isInteger(playerCount) && playerCount >= RULES.minPlayers && playerCount <= RULES.maxPlayers,
    'Escolha entre 2 e 8 jogadores.');
  requireRule(playerCount >= room.players.length, 'Há mais jogadores na sala do que o limite escolhido.');
  const maximum = roomHandLimit(room, playerCount);
  requireRule(Number.isInteger(initialCards) && initialCards >= RULES.minHand
    && (initialCards <= maximum || playerCount !== room.settings.playerCount),
    `Escolha de ${RULES.minHand} a ${maximum} cartas para essa quantidade de jogadores.`);
  room.settings = { ...room.settings, playerCount, initialCards: Math.min(initialCards, maximum), automaticValidation };
  recordHandAdjustment(room, initialCards > maximum);
  return room;
}

function recordHandAdjustment(room, adjusted) {
  room.settingsAdjustment = adjusted ? {
    revision: (room.settingsAdjustment?.revision ?? 0) + 1,
    message: `Cartas iniciais ajustadas para ${room.settings.initialCards}, o máximo para este baralho e esta turma.`,
  } : null;
}

// Recebe somente cópias locais já criadas pelos reducers de sala/bots.
export function adjustLobbyHand(room) {
  if (room.phase !== 'lobby') return room;
  const maximum = roomHandLimit(room);
  if (room.settings.initialCards > maximum) {
    room.settings.initialCards = maximum;
    recordHandAdjustment(room, true);
  }
  return room;
}

export function updateDeckComposition(original, id, composition) {
  requireHost(original, id);
  requireRule(original.phase === 'lobby', 'A partida já começou.');
  validateComposition(composition);
  const room = clone(original);
  room.settings.deckComposition = { ...composition };
  const maximum = roomHandLimit(room);
  const adjusted = room.settings.initialCards > maximum;
  room.settings.initialCards = Math.min(room.settings.initialCards, maximum);
  recordHandAdjustment(room, adjusted);
  return room;
}

export function restoreDefaultComposition(room, id) {
  const next = updateDeckComposition(room, id, DEFAULT_DECK_COMPOSITION);
  next.settings.automaticValidation = RULES.defaultAutomaticValidation;
  return next;
}

export function startGame(original, id, random) {
  const room = clone(original);
  room.settings.automaticValidation ??= RULES.defaultAutomaticValidation;
  requireHost(room, id);
  requireRule(room.phase === 'lobby' || room.phase === 'finished', 'A partida já começou.');
  const issue = deckStartIssue(room);
  requireRule(!issue, issue);
  room.players = room.players.filter((p) => !p.left);
  requireRule(room.players.some((p) => !p.isBot), 'A partida precisa de pelo menos um jogador humano.');
  requireRule(room.players.length === room.settings.playerCount && room.players.every((p) => p.connected),
    `Aguarde os ${room.settings.playerCount} jogadores ficarem conectados ou ajuste a sala.`);
  const deckComposition = lobbyComposition(room);
  const deck = shuffle(createDeck(deckComposition), random);
  for (const player of room.players) player.hand = deck.splice(0, room.settings.initialCards);
  room.phase = 'playing';
  room.game = {
    deck, deckComposition, discard: [], word: '', turnPlayerId: room.players[0].id, drawsThisTurn: 0,
    lastPlayerId: null, winnerId: null, pendingVictory: null, turnNumber: 1,
    blockedLetter: null, protectedPlayerId: null, extraTurns: [], version: 0,
    letterDebt: { count: 0, playerId: null },
    lastLetterPlayerId: null, challenge: null, challengeResult: null,
    letterPlayNumber: 0, botDecisions: {}, playNumber: 0, botSwordDecisions: {},
  };
  room.notice = 'A partida começou. Boa sorte!';
  return room;
}

function requireGameAction(room, id) {
  requireRule(room.phase === 'playing', 'Não há partida em andamento.');
  requireRule(!room.game.challenge, 'Aguarde o fim do desafio para continuar a partida.');
  requireRule(!room.game.pendingVictory, 'Aguarde a resolução da vitória pendente.');
  const player = playerById(room, id);
  requireRule(player.connected, 'Reconecte para continuar.');
  requireRule(connected(room).length >= RULES.minPlayers, 'Partida pausada. Aguardando outro jogador reconectar.');
  return player;
}

function requireTurn(room, id) {
  const player = requireGameAction(room, id);
  requireRule(room.game.turnPlayerId === id, 'Aguarde a sua vez.');
  return player;
}

function setTurn(room, id) {
  // Uma nova vez do autor encerra a proteção, inclusive se só houve passagens/desconexões.
  if (room.game.protectedPlayerId === id) room.game.protectedPlayerId = null;
  room.game.turnPlayerId = id;
  if (room.game.letterDebt.count > 0) room.game.letterDebt.playerId = id;
  room.game.drawsThisTurn = 0;
  room.game.turnNumber++;
}

export function advanceTurn(room) {
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
  if (room.phase !== 'playing' || room.game.challenge || room.game.pendingVictory) return;
  const current = room.players.find((p) => p.id === room.game.turnPlayerId);
  if (!current?.connected || current.left) advanceTurn(room);
}

// A mesma compra é usada na compra opcional e na penalidade; só a primeira conta no limite do turno.
export function takeCards(game, count, random) {
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

export function playCard(original, id, cardId, choice, blockedChoice, accumulatedLetters, expectedVersion = original.game?.version, now = 0) {
  const room = clone(original);
  const player = requireGameAction(room, id);
  const index = player.hand.findIndex((card) => card.id === cardId);
  requireRule(index >= 0, 'Essa carta não está na sua mão.');
  const card = player.hand[index];
  const effect = CARD_TYPES[card.type]?.effect;
  if (effect !== 'interrupt') {
    requireRule(Number.isInteger(expectedVersion) && expectedVersion === room.game.version, 'A mesa mudou. Escolha sua carta novamente.');
    requireRule(room.game.turnPlayerId === id, 'Aguarde a sua vez.');
  }
  requireRule(!isLastCardRestricted(card, player.hand.length), 'Compre uma carta para poder jogar esta');
  requireRule(isCardPlayable(card, room.game, id, player.hand.length), 'Essa carta não pode ser jogada agora.');
  const usesLetters = effect !== 'replay' && effect !== 'pass';
  const owed = debtForPlayer(room.game, id);
  let paidLetters = '';
  if (usesLetters && owed > 0) {
    requireRule(typeof accumulatedLetters === 'string' && accumulatedLetters.length === owed,
      `Digite exatamente ${owed} letras acumuladas.`);
    requireRule(!/[^A-Za-z]/.test(accumulatedLetters), 'As letras acumuladas devem ser de A a Z, sem espaços, números, acentos ou símbolos.');
    paidLetters = accumulatedLetters.toUpperCase();
    requireRule(paidLetters[0] !== room.game.blockedLetter, `A primeira letra acumulada não pode ser ${room.game.blockedLetter}.`);
    // Apenas a cópia local muda: pagamento e carta só serão salvos juntos após todas as validações.
    room.game.word += paidLetters;
    room.game.blockedLetter = null;
    room.game.letterDebt = { count: 0, playerId: null };
  } else {
    requireRule(accumulatedLetters === undefined || accumulatedLetters === '',
      usesLetters ? 'Não há letras acumuladas para pagar.' : 'Esta carta não paga letras acumuladas.');
  }
  const letter = card.type === 'letter' ? card.letter : (typeof choice === 'string' ? choice.toUpperCase() : '');
  if (effect === 'appendMany') {
    const rule = CARD_TYPES[card.type];
    // Valida o texto original antes de normalizar: Unicode como ß não pode virar SS.
    requireRule(typeof choice === 'string' && choice.length > 0 && !/[^A-Za-z]/.test(choice), 'Use somente letras de A a Z, sem espaços, números, acentos ou símbolos.');
    requireRule(letter.length >= rule.minLetters && letter.length <= rule.maxLetters,
      `A carta ${rule.label} exige de ${rule.minLetters} a ${rule.maxLetters} letras.`);
    requireRule(letter[0] !== room.game.blockedLetter, `A primeira letra não pode ser ${room.game.blockedLetter}.`);
  } else if (effect === 'interrupt') requireRule(typeof choice === 'string' && /^[A-Za-z]$/.test(choice) && playableLetters(card, room.game, id).includes(letter),
    'Escolha uma letra de A a Z diferente da letra bloqueada.');
  else if (usesLetters) requireRule(letter.length === 1 && playableLetters(card, room.game, id).includes(letter),
    'Escolha uma letra permitida por essa carta, diferente da letra bloqueada e da última letra ao usar Troca.');
  const blockedLetter = typeof blockedChoice === 'string' ? blockedChoice.toUpperCase() : '';
  if (effect === 'block') requireRule(blockedLetter.length === 1 && ALPHABET.includes(blockedLetter), 'Escolha uma letra de A a Z para bloquear.');
  const previousPlayerId = room.game.lastPlayerId;
  player.hand.splice(index, 1);
  const lastCard = player.hand.length === 0;
  room.game.discard.push(card);
  // Só uma jogada com letra consome a restrição já validada acima.
  // 2x e Passar letra preservam o bloqueio; um novo Bloqueio substitui o anterior.
  if (usesLetters) room.game.blockedLetter = effect === 'block' ? blockedLetter : null;
  // A Vida protege contra desafios até a próxima carta ou o retorno da vez.
  room.game.protectedPlayerId = CARD_TYPES[card.type].protectsFromChallenge ? id : null;
  if (effect === 'replace') {
    const previous = room.game.word.at(-1);
    room.game.word = previewCardWord(room.game.word, card, letter);
    room.notice = `${player.name} jogou Troca: ${previous} virou ${letter}.`;
  } else if (effect === 'replay') {
    const previous = room.players.find((p) => p.id === previousPlayerId);
    room.notice = lastCard ? `${player.name} jogou 2x.` : previous.connected && !previous.left
      ? `${player.name} jogou 2x: ${previous.name} joga de novo; depois a vez volta para ${player.name}.`
      : `${player.name} jogou 2x: ${previous.name} está desconectado; ${player.name} recebe um novo turno.`;
  } else if (effect === 'pass') {
    if (!lastCard) {
      room.game.letterDebt.count += CARD_TYPES[card.type].debtIncrement;
      room.game.letterDebt.playerId = id;
    }
    room.notice = `${player.name} jogou Passar letra →.`;
  } else {
    room.game.word = previewCardWord(room.game.word, card, letter);
    room.notice = effect === 'interrupt' ? `${player.name} jogou na vez de ${playerById(room, room.game.turnPlayerId).name} ⚔️.`
      : effect === 'block' ? `${player.name} jogou Bloqueio: adicionou ${letter} e bloqueou ${blockedLetter} até a próxima jogada com letra.`
      : effect === 'appendMany' ? `${player.name} jogou ${CARD_TYPES[card.type].label}: adicionou ${letter}.`
        : CARD_TYPES[card.type].protectsFromChallenge ? `${player.name} jogou Vida ${CARD_TYPES[card.type].symbol}: adicionou ${letter}.`
        : `${player.name} jogou a letra ${letter}.`;
  }
  room.game.lastPlayerId = id;
  room.game.playNumber = (room.game.playNumber || 0) + 1;
  if (usesLetters) {
    room.game.lastLetterPlayerId = id;
    room.game.letterPlayNumber = (room.game.letterPlayNumber || 0) + 1;
  }
  if (paidLetters) room.notice = `${player.name} pagou ${owed} letra${owed === 1 ? '' : 's'} acumulada${owed === 1 ? '' : 's'} (${paidLetters}). ${room.notice}`;
  room.game.version++;
  if (lastCard) {
    return beginPendingVictory(room, id, now);
  } else if (effect === 'replay') {
    room.game.extraTurns.push(id);
    if (room.players.some((p) => p.id === previousPlayerId && p.connected && !p.left)) setTurn(room, previousPlayerId);
    else advanceTurn(room);
  } else if (effect !== 'interrupt') {
    advanceTurn(room);
  }
  if (room.phase === 'playing' && effect === 'pass') {
    const next = room.players.find((p) => p.id === room.game.turnPlayerId);
    const count = room.game.letterDebt.count;
    room.notice += ` ${next.name} deve ${count} letra${count === 1 ? '' : 's'}.`;
  }
  return room;
}

export function skipTurn(original, id, random, expectedVersion = original.game?.version) {
  const room = clone(original);
  requireRule(room.phase === 'playing', 'Não há partida em andamento.');
  requireRule(!room.game.challenge, 'Use os botões do desafio enquanto ele estiver em andamento.');
  requireRule(!room.game.pendingVictory, 'Aguarde a resolução da vitória pendente.');
  const player = playerById(room, id);
  requireRule(Number.isInteger(expectedVersion) && expectedVersion === room.game.version, 'A mesa mudou. Confira o estado e tente novamente.');
  requireRule(room.game.turnPlayerId !== id || room.game.drawsThisTurn > 0 || room.game.deck.length + room.game.discard.length === 0,
    'Compre uma carta primeiro.');
  requireRule(canSkipTurn(room, id), 'Só o jogador da vez com cartas na mão e sem carta jogável pode dizer Não consigo jogar.');
  const previousBlock = room.game.blockedLetter;
  const previousDebt = room.game.letterDebt.count;
  const cards = takeCards(room.game, RULES.lossPenalty, random);
  player.hand.push(...cards);
  if (cards.length) {
    room.game.word = '';
    room.game.lastLetterPlayerId = null;
  }
  room.game.blockedLetter = null;
  room.game.letterDebt = { count: 0, playerId: null };
  room.game.protectedPlayerId = null;
  room.game.lastPlayerId = null;
  room.game.version++;
  room.notice = `${player.name} não conseguiu jogar, comprou ${cards.length} carta${cards.length === 1 ? '' : 's'} e perdeu a vez.`;
  if (previousBlock) room.notice += ` O bloqueio da letra ${previousBlock} foi cancelado.`;
  if (previousDebt) room.notice += ` O débito de ${previousDebt} letras acumuladas foi zerado.`;
  advanceTurn(room);
  return room;
}

export function disconnectPlayer(original, id, now, leave = false) {
  const room = clone(original);
  const player = playerById(room, id);
  requireRule(!player.isBot, 'Bots não possuem conexão para encerrar.');
  player.connected = false;
  player.left = leave;
  room.notice = `${player.name} ${leave ? 'saiu da sala' : 'desconectou; a vaga está reservada'}.`;
  if (leave && room.phase === 'lobby') room.players = room.players.filter((p) => p.id !== id);
  const active = connected(room);
  const humans = active.filter((p) => !p.isBot);
  if (id === room.hostId && humans.length) room.hostId = humans[0].id;
  if (!humans.length && room.emptySince === null) room.emptySince = now;
  adjustLobbyHand(room);
  resumeTurn(room);
  if (room.game) room.game.version++;
  return room;
}

export function returnToLobby(original, id) {
  const room = clone(original);
  requireHost(room, id);
  requireRule(!room.game?.challenge, 'Aguarde o fim do desafio para voltar à sala.');
  requireRule(!room.game?.pendingVictory, 'Aguarde a resolução da vitória pendente.');
  const currentOnline = room.players.some((p) => p.id === room.game?.turnPlayerId && p.connected && !p.left);
  requireRule(room.phase === 'finished' || (room.phase === 'playing' && (connected(room).length < RULES.minPlayers || !currentOnline)),
    'A partida ainda não terminou. Só é possível encerrar antecipadamente uma partida pausada.');
  room.phase = 'lobby';
  room.game = null;
  room.players = room.players.filter((p) => !p.left && p.connected);
  for (const player of room.players) player.hand = [];
  adjustLobbyHand(room);
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
  adjustLobbyHand(room);
  room.notice = `A vaga de ${player.name} foi liberada.`;
  return room;
}

export function shouldDeleteRoom(room, now) {
  return !room.players.some((p) => !p.isBot && !p.left) || (room.emptySince !== null && now - room.emptySince >= RULES.emptyRoomTtlMs)
    || now - room.updatedAt >= RULES.inactiveRoomTtlMs;
}

// Lista explícita dos campos públicos: nunca serialize a sala inteira para o Socket.IO.
export function roomView(room, viewerId) {
  const viewer = playerById(room, viewerId);
  const game = room.game;
  const available = game ? game.deck.length + game.discard.length : 0;
  const myTurn = room.phase === 'playing' && !game.challenge && !game.pendingVictory && game.turnPlayerId === viewerId && connected(room).length >= RULES.minPlayers;
  const challenge = game?.challenge;
  return {
    code: room.code, phase: room.phase, hostId: room.hostId, meId: viewerId,
    settings: { ...room.settings, automaticValidation: room.settings.automaticValidation ?? RULES.defaultAutomaticValidation, deckComposition: { ...roomComposition(room) }, maxInitialCards: room.phase === 'lobby' ? roomHandLimit(room) : maxInitialCards(room.settings.playerCount, effectiveRoomComposition(room), null) },
    settingsAdjustment: viewerId === room.hostId ? room.settingsAdjustment ?? null : null,
    startIssue: room.phase === 'playing' ? null : deckStartIssue(room),
    deckSize: deckSize(effectiveRoomComposition(room)), swordUnavailable: room.phase === 'lobby' && participantCount(room) === PUBLIC_CONFIG.deckRules.swordUnavailablePlayers, config: PUBLIC_CONFIG, notice: room.notice,
    players: room.players.filter((p) => !p.left || room.phase !== 'lobby').map((p) => ({
      id: p.id, name: p.name, isBot: Boolean(p.isBot), connected: p.connected, left: p.left, cardCount: p.hand.length,
    })),
    hand: structuredClone(viewer.hand),
    game: game ? {
      word: game.word, turnPlayerId: game.turnPlayerId, lastPlayerId: game.lastPlayerId,
      winnerId: game.winnerId, turnNumber: game.turnNumber, drawsThisTurn: game.drawsThisTurn,
      version: game.version, blockedLetter: game.blockedLetter, extraTurns: [...game.extraTurns],
      playNumber: game.playNumber || 0, botSwordDecisionPlay: game.botSwordDecisions?.[viewerId] ?? null,
      canPlaySword: canPlaySword(room, viewerId),
      letterPlayNumber: game.letterPlayNumber || 0, botDecisionPlay: game.botDecisions?.[viewerId] ?? null,
      protectedPlayerId: game.protectedPlayerId,
      pendingVictory: game.pendingVictory ? {
        playerId: game.pendingVictory.playerId, id: game.pendingVictory.id, deadline: game.pendingVictory.deadline,
        acceptedCount: game.pendingVictory.acceptedIds.length, voterCount: game.pendingVictory.voterIds.length,
        canAccept: !game.challenge && game.pendingVictory.voterIds.includes(viewerId) && !game.pendingVictory.acceptedIds.includes(viewerId),
      } : null,
      lastLetterPlayerId: game.lastLetterPlayerId,
      challenge: challenge ? {
        id: challenge.id, phase: challenge.phase, challengerId: challenge.challengerId,
        challengedId: challenge.challengedId, baseWord: challenge.baseWord, addedLetters: challenge.addedLetters,
        completionDeadline: challenge.completionDeadline, voteDeadline: challenge.voteDeadline,
        voterCount: challenge.voterIds.length, respondedCount: Object.keys(challenge.votes).length,
        hasVoted: Object.hasOwn(challenge.votes, viewerId),
        canVote: challenge.phase === 'votando' && challenge.voterIds.includes(viewerId) && !Object.hasOwn(challenge.votes, viewerId),
      } : null,
      challengeResult: game.challengeResult ? structuredClone(game.challengeResult) : null,
      letterDebt: structuredClone(game.letterDebt),
      playableCardIds: viewer.hand.filter((card) => isCardPlayable(card, game, viewerId, viewer.hand.length)).map((card) => card.id),
      allowedLettersByCard: Object.fromEntries(viewer.hand.map((card) => [card.id, playableLetters(card, game, viewerId)])),
      deckCount: game.deck.length, discardCount: game.discard.length, availableCount: available,
      paused: connected(room).length < RULES.minPlayers || !room.players.some((p) => p.id === game.turnPlayerId && p.connected && !p.left),
      canDraw: myTurn && game.drawsThisTurn < RULES.maxDrawsPerTurn && available > 0,
      canPlay: myTurn,
      canSkipTurn: canSkipTurn(room, viewerId),
      noPlayableCards: !hasPlayableCard(viewer, game),
    } : null,
  };
}
