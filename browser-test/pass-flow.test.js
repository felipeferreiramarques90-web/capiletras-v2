import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, waitFor } from './helpers.js';

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
  await a.locator('#confirm-block').click();await a.locator('[data-block="Z"]').click();
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
  await a.locator('.debt-state').waitFor({ state: 'hidden' });
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('Troca vazia e letra fixa bloqueada tornam-se jogáveis com débito', async (t) => {
  const { a, b, seed, current, pay } = await setup(t);
  await seed([['swap-0', 'letra-B'], ['letra-C', 'letra-D']], { word: '', debt: 2 });
  await pay('swap-0');
  assert.equal(await a.locator('[data-letter="K"]').isDisabled(), true, 'Troca não pode repetir a última acumulada');
  await a.locator('[data-letter="A"]').click();
  await waitFor(async () => (await current()).game.word === 'AA');

  await seed([['letra-K', 'letra-B'], ['letra-C', 'letra-D']]);
  await pay('letra-K');
  await waitFor(async () => (await current()).game.word === 'XAKK');


});

test('Passar letra: seta em gradiente, cascata e débito visível para todos', async (t) => {
  const { a, b, seed, current } = await setup(t);
  await seed([['pass-0', 'letra-K', 'letra-B'], ['pass-1', 'letra-C', 'letra-D']], { debt: 0 });
  assert.equal(await a.locator('[data-card="pass-0"]').evaluate((card) => getComputedStyle(card).backgroundColor), 'rgb(25, 28, 35)');
  assert.match(await a.locator('[data-card="pass-0"] > strong').evaluate((arrow) => getComputedStyle(arrow).backgroundImage), /linear-gradient/);
  await a.locator('[data-card="pass-0"]').click();
  await b.locator('.debt-state').filter({ hasText: 'Bia deve 1 letra' }).waitFor();
  await b.locator('[data-card="pass-1"]').click();
  await a.locator('.debt-state').filter({ hasText: 'Ana deve 2 letras' }).waitFor();
  await b.locator('.debt-state').filter({ hasText: 'Ana deve 2 letras' }).waitFor();
  assert.equal((await current()).game.blockedLetter, 'K');
  assert.equal((await current()).game.word, 'X');
  await a.locator('[data-card="letra-K"]').click();
  await a.locator('#debt-input').fill('AK');
  await a.locator('#confirm-debt').click();
  await waitFor(async () => (await current()).game.word === 'XAKK');
  await b.locator('.table-notice').filter({ hasText: 'pagou 2 letras acumuladas' }).waitFor();
});
