import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { io as connectClient } from 'socket.io-client';
import { createApp } from '../server.js';
import { MemoryStorage } from '../storage/memory.js';
import { createDeck } from '../game/game.js';
import { clientView } from '../network/client-view.js';
import { waitFor } from './helpers.js';

async function setup(t, count = 2) {
  const storage = new MemoryStorage();
  const { server, io } = createApp({ roomStorage: storage, randomSource: () => .375 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [], clients = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(async () => { for (const socket of clients) socket.disconnect(); await browser.close(); await new Promise((r) => io.close(r)); assert.deepEqual(errors, []); });
  await page.goto(url); await page.locator('#player-name').fill('Ana'); await page.locator('[data-action=create]').click();
  await page.locator('[data-action=start]').waitFor();
  const [{ code }] = await storage.listRooms();
  await page.locator('#player-count').selectOption(String(count));
  await page.locator('#settings-form button').click();
  for (let i = 1; i < count; i++) {
    const socket = connectClient(url, { transports: ['websocket'], forceNew: true }); clients.push(socket);
    await once(socket, 'connect');
    socket.on('room:state', (view) => { socket.view = view; });
    const joined = await socket.emitWithAck('room:join', { code, sessionId: `layout-test-session-long-${i}`, name: `Jogador ${i}` });
    assert.equal(joined.ok, true, joined.error);
  }
  async function publish(room) {
    await storage.saveRoom(room);
    for (const socket of io.sockets.sockets.values()) socket.emit('room:state', clientView(room, socket.data.playerId));
  }
  return { page, context, browser, storage, code, io, clients, publish, url };
}

for (const count of [2, 8]) test(`mesa com ${count} jogadores: controles lado a lado e mão estável no celular/desktop`, async (t) => {
  const { page, storage, code, publish } = await setup(t, count);
  await page.locator('[data-action=start]').click(); await page.locator('.hand-cards').waitFor();
  const baseline = await storage.getRoom(code);
  assert.equal(baseline.settings.initialCards, 7);
  assert.ok(baseline.players.every((p) => p.hand.length === 7));
  assert.equal(await page.locator('.hand-heading h2').innerText(), 'Sua mão 7 cartas');
  assert.equal(await page.locator('.turn-bar, .turn-number, .hand-note, .hand-heading .eyebrow, .hand-heading > p').count(), 0);
  assert.equal(await page.locator('.site-footer').isVisible(), false);
  assert.doesNotMatch(await page.locator('body').innerText(), /SUAS POSSIBILIDADES|Compre até|Clique em uma carta para jogar|FEITO PARA JUNTAR|Infinitas possibilidades|TURNO \d/);
  for (const [width, height] of [[375,667],[1440,900]]) {
    await page.setViewportSize({ width, height });
    const hand = await page.locator('.hand-cards').boundingBox();
    assert.ok(hand.y + hand.height <= height);
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight));
    await page.screenshot({ path: `/tmp/capiletras-clean-table-${count}-${width}x${height}.png` });
  }
  const deck = createDeck(baseline.settings.deckComposition);
  const used = ['letra-K', 'swap-0', 'double-0'];
  baseline.players[0].hand = used.map((id) => deck.find((c) => c.id === id));
  Object.assign(baseline.game, { word: '', blockedLetter: 'K', lastPlayerId: null, drawsThisTurn: 0,
    deck: deck.filter((c) => !used.includes(c.id)), discard: [], letterDebt: { count: 0, playerId: null } });
  for (const [width, height] of [[320,568],[375,667],[390,844],[844,390],[667,375],[1440,900]]) {
    await page.setViewportSize({ width, height });
    const room = structuredClone(baseline); room.game.version++;
    await publish(room);
    await page.locator('[data-card=letra-K]').waitFor();
    assert.equal(await page.locator('[data-action=skip]').count(), 0);
    const before = await page.evaluate(() => {
      const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      return { scroll: document.documentElement.scrollHeight, viewport: innerHeight, hand: box('.hand-cards'), word: box('.word-display'), table: box('.table-felt'), draw: box('.draw-pile'), challenge: box('.challenge-button'), card: box('.playing-card') };
    });
    assert.ok(before.scroll <= height + 1, `${width}x${height}: página rolou: ${JSON.stringify(before)}`);
    assert.ok(before.hand.y >= 0 && before.hand.bottom <= height, `Mão deve caber: ${JSON.stringify(before)}`);
    assert.ok(before.draw.x + before.draw.width <= before.challenge.x + 1);
    assert.ok(before.challenge.height >= 44);
    assert.ok(before.draw.height >= 44);
    assert.ok(before.draw.y >= before.table.y && before.draw.bottom <= before.table.bottom, `${width}x${height}: compra cortada: ${JSON.stringify(before)}`);
    assert.ok(before.challenge.y >= before.table.y && before.challenge.bottom <= before.table.bottom, `${width}x${height}: dúvida cortada: ${JSON.stringify(before)}`);
    assert.ok(before.table.bottom <= before.hand.y, 'Mesa e mão não podem se sobrepor');
    assert.equal(Math.round(before.card.height), width <= 650 ? 100 : 127);
    room.game.drawsThisTurn = 1; room.game.version++; await publish(room);
    await page.locator('[data-action=skip]').waitFor();
    const after = await page.evaluate(() => Object.fromEntries(['.hand-cards','.word-display','.table-felt'].map((selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return [selector, [r.x, r.y, r.width, r.height]]; })));
    assert.deepEqual(after['.hand-cards'], [before.hand.x,before.hand.y,before.hand.width,before.hand.height], `${width}x${height}: mão pulou`);
    assert.deepEqual(after['.word-display'], [before.word.x,before.word.y,before.word.width,before.word.height], `${width}x${height}: visor pulou`);
    assert.deepEqual(after['.table-felt'], [before.table.x,before.table.y,before.table.width,before.table.height], `${width}x${height}: mesa pulou`);
    const skip = await page.locator('[data-action=skip]').boundingBox();
    assert.ok(skip.y + skip.height <= before.hand.y, 'Botão não pode cobrir cartas');
    await page.screenshot({ path: `/tmp/capiletras-table-${count}-${width}x${height}.png` });
  }
});

test('lobby: composição editável só pelo anfitrião, total ao vivo, limites, reset e mão ajustada', async (t) => {
  const { page, context, storage, code, clients, url } = await setup(t);
  await page.locator('.deck-settings summary').click();
  await page.locator('#deck-wild').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#deck-total').innerText(), '76 cartas');
  assert.equal(await page.locator('#initial-cards').inputValue(), '7');
  assert.equal(await page.locator('#deck-life').inputValue(), '0');
  for (const [width, height] of [[375,667],[1440,900]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `/tmp/capiletras-default-lobby-${width}x${height}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 667 });
  await page.locator('[data-deck-type=life][data-deck-step="1"]').click();
  await waitFor(async () => (await storage.getRoom(code)).settings.deckComposition.life === 1);
  await page.locator('[data-action=reset-deck]').click();
  await waitFor(async () => (await page.locator('#deck-life').inputValue()) === '0');
  assert.equal((await storage.getRoom(code)).settings.initialCards, 7);

  await page.locator('[data-deck-type=wild][data-deck-step="1"]').click();
  await waitFor(async () => (await storage.getRoom(code)).settings.deckComposition.wild === 13);
  await page.locator('#deck-total').filter({ hasText: '77 cartas' }).waitFor();
  await waitFor(() => clients[0].view?.deckSize === 77);
  assert.equal(clients[0].view.settings.deckComposition.wild, 13);
  await page.locator('#deck-wild').fill('31'); await page.locator('#deck-wild').blur();
  assert.equal(await page.locator('[data-action=start]').isDisabled(), true);
  assert.match(await page.locator('#start-help').innerText(), /inteiras/);
  assert.equal((await storage.getRoom(code)).settings.deckComposition.wild, 13);
  await page.locator('[data-action=reset-deck]').click();
  await page.locator('#deck-wild').filter({ visible: true }).waitFor();
  await waitFor(async () => (await page.locator('#deck-wild').inputValue()) === '12');
  await page.locator('#initial-cards').fill('38');
  assert.equal(await page.locator('[data-action=start]').isDisabled(), true);
  assert.match(await page.locator('#start-help').innerText(), /reservar cartas/);
  await page.locator('#initial-cards').fill('7');
  // Mesmo dentro do limite individual, uma soma acima do máximo não é salva.
  for (const type of ['wild', 'life', 'pass', 'swap']) {
    await page.locator(`#deck-${type}`).fill('30'); await page.locator(`#deck-${type}`).blur();
  }
  assert.equal(await page.locator('[data-action=start]').isDisabled(), true);
  assert.match(await page.locator('#start-help').innerText(), /no máximo 150/);
  assert.ok((await storage.getRoom(code)).settings.deckComposition.swap < 30);
  await page.locator('[data-action=reset-deck]').click();
  await waitFor(async () => (await page.locator('#deck-wild').inputValue()) === '12');
  const viewer = await context.browser().newContext({ viewport: { width: 375, height: 667 } });
  const other = await viewer.newPage();
  // Retoma a identidade do segundo participante para verificar leitura no navegador.
  await other.addInitScript(({ code }) => { localStorage.setItem('capiletras:player', 'layout-test-session-long-1'); localStorage.setItem('capiletras:room', code); localStorage.setItem('capiletras:name', 'Jogador 1'); }, { code });
  await other.goto(url); await other.locator('.deck-settings summary').click();
  assert.equal(await other.locator('input[data-deck-type]').count(), 0);
  assert.equal(await other.locator('[data-action=reset-deck]').count(), 0);
  await page.locator('#initial-cards').fill('37'); await page.locator('#settings-form button').click();
  for (const type of clients[0].view.config.configurableCardTypes) {
    await page.locator(`#deck-${type}`).fill('0'); await page.locator(`#deck-${type}`).blur();
    await waitFor(async () => (await storage.getRoom(code)).settings.deckComposition[type] === 0);
    await waitFor(async () => !(await page.locator(`#deck-${type}`).isDisabled()));
  }
  await waitFor(async () => (await page.locator('#initial-cards').inputValue()) === '14');
  await other.locator('#deck-total').filter({ hasText: '30 cartas' }).waitFor();
  assert.equal(await page.locator('#initial-cards').getAttribute('max'), '14');
  for (const [width, height] of [[375,667],[1440,900]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    for (const button of await page.locator('[data-deck-step]').all()) assert.ok((await button.boundingBox()).height >= 44);
    await page.screenshot({ path: `/tmp/capiletras-lobby-${width}x${height}.png`, fullPage: true });
  }
  await viewer.close();
});
