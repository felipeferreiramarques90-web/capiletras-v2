import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { MemoryStorage } from '../storage/memory.js';
import { createDeck, roomView } from '../game/game.js';

async function waitFor(predicate) {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('A alteração esperada não chegou ao navegador/armazenamento.');
}

// Cenários determinísticos no armazenamento do servidor; as ações passam pela UI
// e pelo Socket.IO reais. Nenhuma rota de teste é adicionada ao aplicativo.
async function setup(t) {
  const storage = new MemoryStorage();
  const { server, io } = createApp({ roomStorage: storage, randomSource: () => 0.375 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(async () => { await browser.close(); await new Promise((resolve) => io.close(resolve)); });
  const errors = [];
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on('pageerror', (error) => errors.push(error.message));
    pages.push(page);
  }
  const [a, b] = pages;
  const url = `http://127.0.0.1:${server.address().port}`;
  await a.goto(url);
  await a.locator('#player-name').fill('Ana');
  await a.locator('[data-action="create"]').click();
  await a.locator('[data-action="start"]').waitFor();
  const [{ code }] = await storage.listRooms();
  await b.goto(`${url}/?sala=${code}`);
  await b.locator('#player-name').fill('Bia');
  await b.locator('#join-form button').click();
  await a.locator('[data-action="start"]').click();
  await a.locator('.hand-cards').waitFor();
  await b.locator('.hand-cards').waitFor();

  async function seed(hands, { debt = 2, word = 'X', blockedLetter = 'K', last = false } = {}) {
    const room = await storage.getRoom(code);
    const deck = createDeck(), used = new Set(hands.flat());
    room.players.forEach((p, i) => { p.hand = hands[i].map((id) => deck.find((card) => card.id === id)); });
    Object.assign(room.game, { deck: deck.filter((card) => !used.has(card.id)), discard: [], word, blockedLetter,
      turnPlayerId: room.players[0].id, letterDebt: { count: debt, playerId: debt ? room.players[0].id : null },
      lastPlayerId: last ? room.players[1].id : null, canLose: last, protectedPlayerId: null, extraTurns: [], drawsThisTurn: 0,
      version: room.game.version + 1 });
    await storage.saveRoom(room);
    for (const socket of io.sockets.sockets.values()) socket.emit('room:state', roomView(room, socket.data.playerId));
    await a.locator(`[data-card="${hands[0][0]}"]`).waitFor();
    if (debt) {
      await a.locator('.debt-badge').filter({ hasText: `Ana deve ${debt} letras` }).waitFor();
      await b.locator('.debt-badge').filter({ hasText: `Ana deve ${debt} letras` }).waitFor();
    }
    return room;
  }
  const current = () => storage.getRoom(code);
  async function pay(card, letters = 'AK') {
    await a.locator(`[data-card="${card}"]`).click();
    await a.locator('#debt-input').fill(letters);
    const button = await a.locator('#confirm-debt').boundingBox();
    assert.ok(button.y >= 0 && button.y + button.height <= a.viewportSize().height + 1, 'Continuar deve caber na área visível');
    await a.locator('#confirm-debt').click();
  }
  t.after(() => assert.deepEqual(errors, [], 'A interface não deve gerar erros JavaScript.'));
  return { a, b, seed, current, pay };
}

test('modais no celular: cancelar qualquer etapa preserva a jogada; pagamento + carta têm uma confirmação', async (t) => {
  const { a, seed, current, pay } = await setup(t);
  const hands = [['wild-0', 'multi-0', 'block-0', 'swap-0', 'letra-K', 'letra-B'], ['letra-C', 'letra-D']];
  const before = await seed(hands);
  await a.locator('[data-card="wild-0"]').click();
  await a.locator('#debt-input').fill('kK');
  assert.equal(await a.locator('#confirm-debt').isDisabled(), true);
  assert.match(await a.locator('#debt-warning').innerText(), /primeira letra não pode ser K/);
  await a.locator('#debt-input').fill('á1a k!');
  assert.equal(await a.locator('#debt-input').inputValue(), 'AK');
  assert.equal(await a.locator('#debt-count').innerText(), '2/2');
  assert.equal(await a.locator('#debt-preview').innerText(), 'XAK');
  await a.locator('#close-debt').click();
  assert.deepEqual(await current(), before);

  await pay('wild-0');
  assert.equal(await a.locator('[data-letter="K"]').isEnabled(), true, 'Pagamento já consome a restrição na prévia');
  await a.locator('#close-letter').click();
  assert.deepEqual(await current(), before);
  await pay('multi-0');
  await a.locator('#multi-input').fill('KK');
  assert.equal(await a.locator('#multi-preview').innerText(), 'XAKKK');
  await a.keyboard.press('Escape');
  assert.deepEqual(await current(), before);
  await pay('block-0');
  await a.locator('[data-letter="K"]').click();
  await a.locator('[data-block="Z"]').click();
  await a.locator('#close-letter').click();
  assert.deepEqual(await current(), before);

  // O mesmo fluxo cabe quando o teclado reduz a área visível do celular.
  await a.setViewportSize({ width: 375, height: 400 });
  await pay('wild-0');
  await a.locator('[data-letter="K"]').click();
  await waitFor(async () => (await current()).game.word === 'XAKK');
  const after = await current();
  assert.equal(after.game.version, before.game.version + 1);
  assert.equal(after.players[0].hand.length, hands[0].length - 1);
  assert.equal(after.game.letterDebt.count, 0);
  assert.equal(after.game.blockedLetter, null);
  await a.locator('.debt-badge').waitFor({ state: 'hidden' });
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('Troca vazia, letra fixa bloqueada e PERDI durante escolha do débito', async (t) => {
  const { a, b, seed, current, pay } = await setup(t);
  await seed([['swap-0', 'letra-B'], ['letra-C', 'letra-D']], { word: '', debt: 2 });
  await pay('swap-0');
  assert.equal(await a.locator('[data-letter="K"]').isDisabled(), true, 'Troca não pode repetir a última acumulada');
  await a.locator('[data-letter="A"]').click();
  await waitFor(async () => (await current()).game.word === 'AA');

  await seed([['letra-K', 'letra-B'], ['letra-C', 'letra-D']]);
  await pay('letra-K');
  await waitFor(async () => (await current()).game.word === 'XAKK');

  const before = await seed([['wild-0', 'letra-B'], ['pass-0', 'letra-C']], { last: true });
  await a.locator('[data-card="wild-0"]').click();
  await b.locator('[data-action="lose"]').click();
  await a.locator('#debt-dialog').waitFor({ state: 'hidden' });
  assert.equal((await current()).game.letterDebt.count, 0);
  assert.equal((await current()).players[0].hand.length, before.players[0].hand.length);
  assert.match(await a.locator('.table-notice').innerText(), /débito.*zerado/);
});

test('Passar letra: seta em gradiente, cascata e débito visível para todos', async (t) => {
  const { a, b, seed, current } = await setup(t);
  await seed([['pass-0', 'letra-K', 'letra-B'], ['pass-1', 'letra-C', 'letra-D']], { debt: 0 });
  assert.equal(await a.locator('[data-card="pass-0"]').evaluate((card) => getComputedStyle(card).backgroundColor), 'rgb(25, 28, 35)');
  assert.match(await a.locator('[data-card="pass-0"] > strong').evaluate((arrow) => getComputedStyle(arrow).backgroundImage), /linear-gradient/);
  await a.locator('[data-card="pass-0"]').click();
  await b.locator('.debt-badge').filter({ hasText: 'Bia deve 1 letra' }).waitFor();
  await b.locator('[data-card="pass-1"]').click();
  await a.locator('.debt-badge').filter({ hasText: 'Ana deve 2 letras' }).waitFor();
  await b.locator('.debt-badge').filter({ hasText: 'Ana deve 2 letras' }).waitFor();
  assert.equal((await current()).game.blockedLetter, 'K');
  assert.equal((await current()).game.word, 'X');
  await a.locator('[data-card="letra-K"]').click();
  await a.locator('#debt-input').fill('AK');
  await a.locator('#confirm-debt').click();
  await waitFor(async () => (await current()).game.word === 'XAKK');
  await b.locator('.table-notice').filter({ hasText: 'pagou 2 letras acumuladas' }).waitFor();
});
