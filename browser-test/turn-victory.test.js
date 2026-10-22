import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, waitFor } from './helpers.js';

test('Não consigo jogar: nome, motivo, compra opcional e perda da vez no celular', async (t) => {
  const { a, b, seed, current } = await setup(t);
  await seed([['letra-K'], ['letra-B', 'letra-C']], { debt: 0, word: 'CA' });
  assert.match(await a.locator('[data-action="skip"]').innerText(), /Não consigo jogar/);
  assert.equal(await a.locator('[data-action="skip"]').isEnabled(), true);
  assert.equal(await b.locator('[data-action="skip"]').isDisabled(), true);
  await a.locator('[data-action="skip"]').click();
  await b.locator('.turn-bar').filter({ hasText: 'É a sua vez' }).waitFor();
  assert.equal((await current()).players[0].hand.length, 5);
  assert.equal((await current()).game.word, '');
  assert.match(await b.locator('#loss-help').innerText(), /Você tem carta jogável/);
  await a.locator('.table-notice').filter({ hasText: 'perdeu a vez' }).waitFor();
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await seed([['swap-0'], ['letra-C', 'letra-D']], { debt: 0, word: '' });
  await a.locator('[data-action="draw"]').click();
  await waitFor(() => a.locator('[data-action="skip"]').isDisabled());
  assert.match(await a.locator('#loss-help').innerText(), /Você tem carta jogável/);
});

test('Vida protege contra desafio, sem aviso de proteção no botão da mesa', async (t) => {
  const { a, b, seed } = await setup(t);
  await seed([['life-0', 'letra-B'], ['letra-C', 'letra-D']], { debt: 0 });
  await a.locator('[data-card="life-0"]').click();
  await a.locator('[data-letter="E"]').click();
  await b.locator('[data-action="challenge"]').click();
  await b.locator('#toast').filter({ hasText: 'Ana está protegido pela Vida' }).waitFor();
  assert.doesNotMatch(await a.locator('#loss-help').innerText(), /Protegido/);
  assert.equal(await a.locator('[data-action="skip"]').getAttribute('title'), null);
});

for (const outcome of ['prazo', 'aceite', 'aceita no desafio', 'recusada no desafio']) {
  test(`última carta: contador e ${outcome} na interface multiplayer`, async (t) => {
    let clock = Date.now();
    const { a, b, seed, current } = await setup(t, { nowSource: () => clock, challengeIntervalMs: 5 });
    await seed([['letra-A'], ['letra-B', 'letra-C']], { debt: 0, word: 'CA' });
    await a.locator('[data-card="letra-A"]').click();
    for (const page of [a, b]) {
      await page.locator('#victory-countdown').filter({ hasText: 'Ana baixou a última carta' }).waitFor();
      assert.equal(await page.locator('[data-action="skip"]').isDisabled(), true);
      assert.equal(await page.locator('[data-action="draw"]').isDisabled(), true);
    }
    assert.equal(await a.locator('[data-action="accept-victory"]').count(), 0);
    if (outcome === 'prazo') {
      clock += 10_000;
    } else if (outcome === 'aceite') {
      await b.locator('[data-action="accept-victory"]').click();
    } else {
      await b.locator('[data-action="challenge"]').click();
      await a.locator('#challenge-ok').click();
      await b.locator(`[data-vote="${outcome.startsWith('aceita') ? 'sim' : 'nao'}"]`).click();
      if (outcome.startsWith('recusada')) {
        await a.locator('#challenge-loss').click();
        await b.locator('.turn-bar').filter({ hasText: 'É a sua vez' }).waitFor();
        assert.equal((await current()).players[0].hand.length, 4);
        assert.equal((await current()).game.word, '');
        assert.equal((await current()).game.pendingVictory, null);
        assert.equal(await a.locator('.victory-panel').count(), 0);
        return;
      }
    }
    for (const page of [a, b]) {
      await page.locator('.victory-panel').waitFor();
      assert.equal(await page.locator('.final-word strong').innerText(), 'CAA');
    }
    assert.equal((await current()).game.winnerId, (await current()).players[0].id);
  });
}
