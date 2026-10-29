import test from 'node:test';
import assert from 'node:assert/strict';
import { createDictionary } from '../bots/dictionary.js';
import { commonWords, defaultDictionary, defaultCommonDictionary } from '../bots/load-dictionary.js';
import { BOT_RULES, CHANCE_BOT_ERUDITO } from '../bots/config.js';
import { chooseTurnAction, decideBotAction, botTask } from '../bots/brain.js';
import { applyBotAction } from '../bots/actions.js';
import { addBot } from '../bots/players.js';
import { createRoom, startGame, createDeck, roomView } from '../game/game.js';
import { startChallenge, confirmChallenge } from '../game/challenge.js';
import { DEFAULT_DECK_COMPOSITION } from '../game/config.js';
import { compositionForHands } from './helpers/composition.js';
import { simulateMatch } from './helpers/simulation.js';

const now = 100000;
function fixture(ids = ['wild-0', 'letra-Z'], game = {}) {
  let room = createRoom({ code: 'ABC234', playerId: 'h', sessionId: 's', name: 'Ana', now });
  room = addBot(addBot(room, 'h', 'b1'), 'h', 'b2');
  room = startGame(room, 'h', () => .375);
  const composition = compositionForHands([ids]);
  const cards = createDeck(composition), used = new Set(ids);
  const spare = cards.filter((c) => !used.has(c.id));
  room.players[1].hand = ids.map((id) => cards.find((c) => c.id === id));
  room.players[0].hand = spare.splice(0, 3); room.players[2].hand = spare.splice(0, 3);
  Object.assign(room.game, { word: 'CA', deck: spare, discard: [], turnPlayerId: 'b1',
    lastPlayerId: 'h', lastLetterPlayerId: 'h', letterPlayNumber: 1, ...game });
  return room;
}
function sequence(...values) {
  let calls = 0;
  const rng = () => { assert.ok(calls < values.length, 'Não deve refazer o sorteio de modo'); return values[calls++]; };
  rng.calls = () => calls;
  return rng;
}
const choose = (room, full, common, rng = () => .5) => chooseTurnAction(roomView(room, 'b1'), full, { rng, commonDictionary: common });
const decide = (room, full, common, rng = () => .5) => decideBotAction(roomView(room, 'b1'), full, rng, { commonDictionary: common });
const apply = (room, action) => applyBotAction(room, 'b1', action, { version: room.game.version, now, rng: () => .375 });

test('lista comum livre: limiar só filtra, normaliza, deduplica e intersecta o completo', () => {
  const full = createDictionary(['AÇÃO', 'CASA', 'JOGÁVAMOS', 'RARA']);
  const text = 'ação 1000\nAÇÃO 2000\ncasa 999\njogávamos 5000\nrara 1\nxyz 9000\neu 9000\ncom-hifen 9000\ncasa2 9000\n';
  assert.deepEqual(commonWords(text, full), ['ACAO', 'JOGAVAMOS']);
  assert.deepEqual(commonWords(text, full, 5000), ['JOGAVAMOS']);
  const common = defaultCommonDictionary(), complete = defaultDictionary();
  assert.ok(common.size > 10000 && common.size < complete.size);
  for (const word of ['CASA', 'BOLA', 'JOGAMOS', 'ACAO']) assert.ok(common.isWord(word), word);
  for (const suffix of common.allContinuations('')) assert.ok(complete.isWord(suffix));
});

test('busca exaustiva inclui todas as palavras, sem o corte das primeiras 48 ou preferência de inserção', () => {
  const words = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].flatMap((a) => [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((b) => `A${a}${b}`));
  const d = createDictionary(words);
  assert.equal(d.allContinuations('A').length, 676);
  assert.equal(d.allExtensions('A', 2).length, 676);
  assert.equal(d.allContinuations('A', { excludedFirst: 'A' }).length, 650);
  assert.ok(createDictionary([`A${'B'.repeat(17)}`]).allContinuations('A').length === 0);
});

test('modo erudito abaixo de 0,10; comum no limiar/acima; um único sorteio de modo', () => {
  assert.equal(CHANCE_BOT_ERUDITO, .10); assert.equal(BOT_RULES.eruditeChance, CHANCE_BOT_ERUDITO);
  const full = createDictionary(['CANTO', 'CASA']), common = createDictionary(['CASA']), room = fixture();
  const erudite = sequence(.099, 0);
  assert.equal(choose(room, full, common, erudite).letter, 'N'); assert.equal(erudite.calls(), 2);
  for (const value of [.1, .9]) {
    const rng = sequence(value);
    assert.equal(choose(room, full, common, rng).letter, 'S'); assert.equal(rng.calls(), 1);
  }
});

test('fallback comum → completo sem novo sorteio, e completo → compra/blefe sem opção', () => {
  const room = fixture(), full = createDictionary(['CASA']), common = createDictionary(['BOLA']);
  assert.equal(choose(room, full, common, sequence(.5)).letter, 'S');
  const neither = createDictionary(['BOLA']);
  assert.equal(choose(room, neither, common, sequence(.5)).type, 'draw');
  room.game.drawsThisTurn = 1;
  const action = choose(room, neither, common, () => .5);
  assert.equal(action.type, 'play'); assert.doesNotThrow(() => apply(room, action));
});

test('ação de segurança também mantém modo comum e sorteio de letras, sem mudar validações', () => {
  const room = fixture(), full = createDictionary(['CANTO','CASA']), common = createDictionary(['CASA']);
  const action = chooseTurnAction(roomView(room,'b1'),full,{ safety: true, rng: sequence(.5), commonDictionary: common });
  assert.equal(action.letter,'S'); assert.doesNotThrow(() => apply(room,action));
});

test('sorteio uniforme sem viés alfabético: AA e AB têm frequências próximas em milhares de decisões', () => {
  const full = createDictionary(['AAA', 'ABA']), common = createDictionary(['ABA', 'AAA']);
  const view = roomView(fixture(undefined, { word: 'A' }), 'b1'), counts = { AA: 0, AB: 0 };
  for (let i = 0; i < 8000; i++) {
    const action = chooseTurnAction(view, full, { rng: Math.random, commonDictionary: common });
    counts['A' + action.letter]++;
  }
  assert.ok(Math.abs(counts.AA - counts.AB) < 500, JSON.stringify(counts));
});

test('cada opção pode ser sorteada, inclusive a última; candidato único não sorteia índice', () => {
  const room = fixture(), full = createDictionary(['CANTO', 'CARRO', 'CASA']);
  const seen = new Set([0, .34, .999999].map((roll) => choose(room, full, full, sequence(.5, roll)).letter));
  assert.deepEqual(seen, new Set(['N', 'R', 'S']));
  assert.equal(choose(room, createDictionary(['CASA']), createDictionary(['CASA']), sequence(.5)).letter, 'S');
});

for (const [id, word, words, blocked] of [
  ['letra-S', 'CA', ['CASA'], 'A'], ['wild-0', 'CA', ['CANTO','CASA'], 'N'],
  ['vowel-0', 'CAS', ['CASA','CASTA'], 'E'], ['consonant-0', 'CA', ['CASA','CAUSA'], 'U'],
  ['first-0', 'CA', ['CANTO','CALMA'], null], ['last-0', 'CA', ['CANTO','CALMA'], null],
  ['life-0', 'CAS', ['CASA','CASTA'], 'E'], ['swap-0', 'CAX', ['CANTO','CASA'], 'N'],
  ['block-0', 'CA', ['CANTO','CASA'], 'N'], ['multi-0', 'CA', ['CANTO','CASA'], 'N'],
]) test(`${id}: modo comum, restrições e bloqueio filtrados antes do sorteio`, () => {
  const room = fixture([id, 'letra-Z'], { word, blockedLetter: blocked });
  const common = createDictionary(words), full = createDictionary([...words, 'CAVALO']);
  const action = choose(room, full, common);
  assert.equal(action.cardId, id);
  const next = apply(room, action);
  assert.ok(common.hasPrefix(next.game.word), next.game.word);
  if (id === 'multi-0') assert.ok(common.isWord(next.game.word));
  assert.equal(next.game.blockedLetter, id === 'block-0' ? action.blockedLetter : null);
});

test('2+* sorteia palavras completas uniformemente, sem acrescentar atalhos que são apenas prefixos', () => {
  const room = fixture(['multi-0','letra-Z']), full = createDictionary(['CASA','CASAMENTO']);
  const common = createDictionary(['CASA','CASAMENTO']);
  assert.equal(choose(room, full, common, sequence(.5, 0)).letter, 'SA');
  assert.equal(choose(room, full, common, sequence(.5, .999)).letter, 'SAMENTO');
});

test('débito: opções completas, primeira acumulada respeita bloqueio; a própria carta fica livre', () => {
  const room = fixture(['letra-K','letra-Z'], { blockedLetter: 'K', letterDebt: { count: 2, playerId: 'b1' } });
  const common = createDictionary(['CASKK','CATTK']), full = createDictionary(['CASKK','CATTK','CAXXK']);
  const action = choose(room, full, common, sequence(.5, 0));
  assert.equal(action.accumulatedLetters.length, 2); assert.notEqual(action.accumulatedLetters[0], 'K');
  assert.equal(action.letter, 'K'); assert.ok(common.isWord(apply(room, action).game.word));
  const invalid = fixture(['letra-K','letra-Z'], { blockedLetter: 'S', letterDebt: { count: 1, playerId: 'b1' } });
  assert.equal(choose(invalid, createDictionary(['CASK']), createDictionary(['CASK']), sequence(.5)).type, 'draw');
});

for (const [id, count] of [['wild-0',2],['vowel-0',2],['consonant-0',3],['first-0',2],['last-0',3],['life-0',2],['block-0',2],['multi-0',1]]) {
  test(`${id}: débito usa a lista comum e o mesmo sorteio de modo da carta`, () => {
    const room = fixture([id,'letra-Z'], { word: 'B', blockedLetter: 'A', letterDebt: { count, playerId: 'b1' } });
    const common = createDictionary(['BOLA','BOLAS']), full = createDictionary(['BOLA','BOLAS','BACANA']);
    const action = choose(room,full,common,() => .5);
    assert.equal(action.cardId,id); assert.equal(action.accumulatedLetters.length,count);
    assert.notEqual(action.accumulatedLetters[0],'A'); assert.ok(common.hasPrefix(apply(room,action).game.word));
  });
}

test('Troca com débito sorteia todas as substituições e pagamentos livres diferentes, sem primeira opção fixa', () => {
  const room = fixture(['swap-0','letra-Z'], { blockedLetter: 'A', letterDebt: { count: 1, playerId: 'b1' } });
  const d = createDictionary(['CASA','CANTO']);
  const actions = [0,.999].map((roll) => choose(room, d, d, sequence(.5, roll)));
  assert.notEqual(actions[0].accumulatedLetters, actions[1].accumulatedLetters);
  for (const action of actions) {
    assert.notEqual(action.accumulatedLetters, 'A'); assert.notEqual(action.accumulatedLetters, action.letter);
    assert.ok(d.hasPrefix(apply(room, action).game.word));
  }
});

test('espada mantém a chance existente e usa os mesmos modos/fallback e sorteio uniforme de letras', () => {
  const room = fixture(['sword-0','letra-Z'], { turnPlayerId: 'h', lastLetterPlayerId: null });
  const full = createDictionary(['CANTO','CASA']), common = createDictionary(['CASA']);
  assert.equal(decide(room, full, common, sequence(0,.5)).letter, 'S');
  assert.equal(decide(room, full, common, sequence(0,0,0)).letter, 'N');
  assert.equal(decide(room, full, createDictionary(['BOLA']), sequence(0,.5,.999)).letter, 'S');
  assert.equal(decide(room, full, common, sequence(BOT_RULES.swordChance)).type, 'sword-decision');
});

test('Y sorteia palavra comum/completa, aceita zero letras e confirma sem repetir o modo', () => {
  const full = createDictionary(['CASA','CANTO']), common = createDictionary(['CASA']);
  let room = startChallenge(fixture(undefined, { turnPlayerId: 'h', lastLetterPlayerId: 'b1' }), 'h', now);
  const action = decide(room, full, common, sequence(.5));
  assert.equal(action.type, 'preview'); assert.equal(action.letters, 'SA');
  room = apply(room, action);
  assert.equal(decide(room, full, common, sequence()).type, 'confirm');
  const complete = startChallenge(fixture(undefined, { word: 'CASA', turnPlayerId: 'h', lastLetterPlayerId: 'b1' }), 'h', now);
  assert.equal(decide(complete, full, common, sequence(.5)).type, 'confirm');
  const fallback = startChallenge(fixture(undefined, { word: 'CANT', turnPlayerId: 'h', lastLetterPlayerId: 'b1' }), 'h', now);
  assert.equal(decide(fallback, full, common, sequence(.5)).letters, 'O');
  const bluff = startChallenge(fixture(undefined, { word: 'ZZZ', turnPlayerId: 'h', lastLetterPlayerId: 'b1' }), 'h', now);
  assert.equal(decide(bluff, full, common, sequence(.5)).type, 'lose');
});

test('Y e 2+* têm sorteio uniforme entre palavras, não entre ramos da trie', () => {
  const d = createDictionary(['AAA','AAB','ABRACADABRA']);
  const room = startChallenge(fixture(undefined, { word: 'A', turnPlayerId: 'h', lastLetterPlayerId: 'b1' }), 'h', now);
  const seen = new Set([0,.34,.999].map((roll) => decide(room, d, d, sequence(.5,roll)).letters));
  assert.deepEqual(seen, new Set(['AA','AB','BRACADABRA']));
});

test('dúvida, aceitação e votação julgam só pelo completo, sem sorteio de modo nem consulta ao comum', () => {
  const full = createDictionary(['CASA','CANTO']);
  const common = new Proxy({}, { get() { throw Error('Dicionário comum não pode julgar'); } });
  let room = fixture(undefined, { word: 'CANT', turnPlayerId: 'h' });
  assert.equal(botTask(roomView(room,'b1'), full), null);
  assert.equal(decide(room, full, common, sequence()), null);
  room.game.word = 'ZZZ';
  assert.equal(decide(room, full, common, sequence(BOT_RULES.challengeChance - .001)).type, 'challenge');
  assert.equal(decide(room, full, common, sequence(BOT_RULES.challengeChance)).type, 'decision');
  for (const challenged of ['h','b2']) for (const word of ['CANTO','ZZZ']) {
    let voting = fixture(undefined, { word, turnPlayerId: 'h', lastLetterPlayerId: challenged });
    voting = startChallenge(voting,'b1',now);
    voting = confirmChallenge(voting,challenged,voting.game.challenge.id,'',now,() => .5);
    const action = decide(voting, full, common, sequence());
    assert.equal(action.vote, challenged === 'h' || word === 'CANTO' ? 'sim' : 'nao');
  }
  room.game.pendingVictory = { id: 1, playerId: 'h', deadline: now + 10000, voterIds: ['b1','b2'], acceptedIds: [] };
  assert.equal(decide(room, full, common, sequence(BOT_RULES.finalChallengeChance - .001)).type, 'challenge');
  room.game.word = 'CANTO';
  assert.equal(decide(room, full, common, sequence()).type, 'accept');
});

test('um modo para toda a mão e pagamento; decisões e dicionários não entram no estado JSON', () => {
  const room = fixture(['wild-0','block-0','multi-0','letra-Z'], { letterDebt: { count: 1, playerId: 'b1' } });
  const before = structuredClone(room), d = createDictionary(['CANTO','CASA']);
  const rng = sequence(.5,.5);
  const action = choose(room,d,d,rng);
  assert.equal(rng.calls(),2); assert.deepEqual(room,before);
  const next = apply(room,action);
  assert.deepEqual(JSON.parse(JSON.stringify(next)),next);
  assert.ok(!/dictionary|erudite|commonDictionary/.test(JSON.stringify(next)));
});

test('simulação longa com dicionários distintos termina sem travar e conserva as regras', () => {
  const full = createDictionary(['CASA','CASAS','CASCA','CANTO','CANTAMOS','CANTARAM','BOLA','BOLAS','BACANA','ABACATE','CAPIVARA','FUTEBOL','ZEBRA']);
  const common = createDictionary(['CASA','BOLA','CANTO']);
  for (let seed = 100; seed < 120; seed++) {
    assert.equal(simulateMatch(DEFAULT_DECK_COMPOSITION,seed,{full,common}).phase,'finished');
  }
});

test('partida com os dois corpora reais em memória chega ao fim sem serializar os léxicos', () => {
  const room = simulateMatch(DEFAULT_DECK_COMPOSITION,91,{ full: defaultDictionary(), common: defaultCommonDictionary() });
  assert.equal(room.phase,'finished');
  assert.ok(!JSON.stringify(room).includes('dictionary'));
});
