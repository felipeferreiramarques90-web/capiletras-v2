import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, roomView } from '../game/game.js';
import { setup, waitFor } from './helpers.js';

test('compra obrigatória, botão ausente enquanto indisponível e nome atualizado ao passar a vez', async (t) => {
  const { a, b, seed, current } = await setup(t);
  const deck = createDeck().filter((c) => ['swap-1', 'swap-2', 'swap-3', 'swap-4', 'swap-5'].includes(c.id));
  await seed([['swap-0'], ['letra-B', 'letra-C']], { debt: 0, word: '', deck });
  assert.equal(await a.locator('[data-action="skip"]').count(), 0);
  assert.equal(await a.locator('#loss-help').count(), 0);
  await a.locator('[data-action="draw"]').click();
  await waitFor(() => a.locator('[data-action="skip"]').isEnabled());
  await a.locator('[data-action="skip"]').click();
  for (const page of [a, b]) await page.locator('.word-turn-label').filter({ hasText: 'É a vez de: Bia' }).waitFor();
  assert.equal(await a.locator('#loss-help').count(), 0);
  assert.equal(await b.locator('#loss-help').count(), 0);
  assert.equal((await current()).game.drawsThisTurn, 0);
  // Sem cartas disponíveis, não exige a compra antes de passar.
  await seed([['letra-K'], ['letra-B', 'letra-C']], { debt: 0, word: 'CA', deck: [] });
  assert.equal(await a.locator('[data-action="skip"]').isEnabled(), true);
  await a.locator('[data-action="skip"]').click();
  await b.locator('.word-turn-label').filter({ hasText: 'É a vez de: Bia' }).waitFor();
  assert.equal((await current()).game.word, 'CA');
  // Com uma carta jogável, o botão segue ausente antes e depois da compra.
  await seed([['letra-A', 'letra-D'], ['letra-B', 'letra-C']], { debt: 0, word: '' });
  assert.equal(await a.locator('#loss-help').count(), 0);
  await a.locator('[data-action="draw"]').click();
  await waitFor(async () => (await current()).game.drawsThisTurn === 1);
  assert.equal(await a.locator('[data-action="skip"]').count(), 0);
});

test('rótulo acompanha turno normal, forçado pelo 2x e retorno, com destaque próprio', async (t) => {
  const { a, b, seed } = await setup(t);
  await seed([['letra-A', 'letra-B', 'letra-D'], ['double-0', 'letra-C', 'letra-E']], { debt: 0, word: '' });
  async function check(name, own) {
    for (const page of [a, b]) await page.locator('.word-turn-label').filter({ hasText: `É a vez de: ${name}` }).waitFor();
    assert.equal(await own.locator('.own-turn-label .word-turn-name').innerText(), name);
    assert.equal(await (own === a ? b : a).locator('.own-turn-label').count(), 0);
  }
  await check('Ana', a);
  await a.locator('[data-card="letra-A"]').click();
  await check('Bia', b);
  await b.locator('[data-card="double-0"]').click();
  await check('Ana', a);
  assert.equal(await a.locator('#loss-help').count(), 0);
  await a.locator('[data-card="letra-B"]').click();
  await check('Bia', b);
  await b.locator('[data-card="letra-C"]').click();
  await check('Ana', a);
});

test('nome longo em destaque quebra linha sem alargar a mesa no celular', async (t) => {
  const { a, b, seed, current, storage, io } = await setup(t);
  await seed([['letra-A', 'letra-B'], ['letra-C', 'letra-D']], { debt: 0 });
  const room = await current(), name = 'WWWWWWWWWWWWWWWWWWWW';
  room.players[0].name = name;
  await storage.saveRoom(room);
  for (const socket of io.sockets.sockets.values()) socket.emit('room:state', roomView(room, socket.data.playerId));
  for (const page of [a, b]) {
    await page.setViewportSize({ width: 320, height: 667 });
    await page.locator('.word-turn-name').filter({ hasText: name }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.ok(Number(await page.locator('.word-turn-name').evaluate((node) => getComputedStyle(node).fontWeight)) >= 700);
  }
});
