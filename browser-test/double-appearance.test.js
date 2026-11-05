import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, waitFor } from './helpers.js';

test('2x mantém miniatura curta no lobby e informa indisponibilidade ao toque ou teclado', async t => {
  const { a, seed, current } = await setup(t, { players: 3, start: false });
  await a.locator('.deck-settings summary').click();
  const miniature = a.locator('.theme-double');
  assert.equal(await miniature.innerText(), '2x');
  await waitFor(async () => await miniature.evaluate(n => getComputedStyle(n).backgroundColor) === 'rgb(21, 19, 32)');
  assert.equal(await miniature.locator('.double-message').count(), 0);
  assert.match(await a.locator('label[for=deck-double]').innerText(), /2x/);
  await a.locator('[data-action=start]').click();
  await a.locator('.hand-cards').waitFor();
  const before = await seed([['double-0', 'letra-A'], ['letra-B', 'letra-C'], ['letra-D', 'letra-E']],
    { debt: 0, word: '', blockedLetter: null, last: false });
  const card = a.locator('[data-card=double-0]');
  assert.equal(await card.isDisabled(), true);
  assert.equal(await card.locator('.card-bottom, .card-corner').count(), 0);
  assert.equal(await card.innerText(), 'MANDEI JOGAR DE NOVO');
  const hint = a.locator('[data-card-hint="Sem jogada anterior"]');
  await hint.click();
  await a.locator('#toast').filter({ hasText: 'Sem jogada anterior' }).waitFor();
  await hint.focus(); await hint.press('Enter');
  assert.equal((await current()).game.version, before.game.version);
  assert.deepEqual((await current()).players[0].hand, before.players[0].hand);
  await seed([['double-0', 'letra-A'], ['letra-B', 'letra-C'], ['letra-D', 'letra-E']],
    { debt: 0, word: 'CA', blockedLetter: null, last: true, turnPlayerId: before.players[1].id });
  await a.locator('[data-card-hint="Não é a sua vez."]').click();
  await a.locator('#toast').filter({ hasText: 'Não é a sua vez.' }).waitFor();
});
