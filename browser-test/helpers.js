import { compositionForHands } from '../test/helpers/composition.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { MemoryStorage } from '../storage/memory.js';
import { createDeck, roomView } from '../game/game.js';

export async function waitFor(predicate) {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('A alteração esperada não chegou ao navegador/armazenamento.');
}

// Cenários determinísticos no armazenamento do servidor; as ações passam pela UI
// e pelo Socket.IO reais. Nenhuma rota de teste é adicionada ao aplicativo.
export async function setup(t, { players = 2, ...options } = {}) {
  const storage = new MemoryStorage();
  const { server, io } = createApp({ roomStorage: storage, randomSource: () => 0.375, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(async () => { await browser.close(); await new Promise((resolve) => io.close(resolve)); });
  const errors = [];
  const pages = [];
  for (let i = 0; i < players; i++) {
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
  if (players > 2) {
    await a.locator('#player-count').selectOption(String(players));
    await a.locator('#settings-form button').click();
  }
  for (let i = 1; i < players; i++) {
    await pages[i].goto(`${url}/?sala=${code}`);
    await pages[i].locator('#player-name').fill(['Ana', 'Bia', 'Caio'][i]);
    await pages[i].locator('#join-form button').click();
  }
  await a.locator('[data-action="start"]').click();
  await a.locator('.hand-cards').waitFor();
  for (const page of pages.slice(1)) await page.locator('.hand-cards').waitFor();

  async function seed(hands, { debt = 2, word = 'X', blockedLetter = 'K', last = false, lastLetter = 0, ...game } = {}) {
    const room = await storage.getRoom(code);
    room.settings.deckComposition = compositionForHands(hands);
    const deck = createDeck(room.settings.deckComposition), used = new Set(hands.flat());
    room.players.forEach((p, i) => { p.hand = hands[i].map((id) => deck.find((card) => card.id === id)); });
    Object.assign(room.game, { deck: deck.filter((card) => !used.has(card.id)), discard: [], word, blockedLetter,
      turnPlayerId: room.players[0].id, letterDebt: { count: debt, playerId: debt ? room.players[0].id : null },
      lastPlayerId: last ? room.players[1].id : null, protectedPlayerId: null, extraTurns: [], drawsThisTurn: 0,
      version: room.game.version + 1, lastLetterPlayerId: room.players[lastLetter]?.id ?? null, challenge: null, challengeResult: null, pendingVictory: null, ...game });
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
  return { a, b, c: pages[2], seed, current, pay, storage, io, code, url };
}
