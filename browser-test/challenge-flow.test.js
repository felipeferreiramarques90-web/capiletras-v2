import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, waitFor } from './helpers.js';

test('débito desabilita Duvidar para todos; pagamento libera o botão e o desafio', async (t) => {
  const { a, b, seed, current, pay } = await setup(t);
  await seed([['letra-A', 'letra-B'], ['letra-C', 'letra-D']], { word: 'CA', debt: 2 });
  for (const page of [a, b]) {
    assert.equal(await page.locator('[data-action="challenge"]').isDisabled(), true);
    assert.equal(await page.locator('#challenge-help-debt').innerText(), 'Há letras acumuladas pendentes.');
  }
  await pay('letra-A', 'AB');
  for (const page of [a, b]) {
    await waitFor(() => page.locator('[data-action="challenge"]').isEnabled());
    assert.equal(await page.locator('#challenge-help-debt').isHidden(), true);
  }
  assert.equal((await current()).game.letterDebt.count, 0);
  await b.locator('[data-action="challenge"]').click();
  await a.locator('#challenge-dialog').waitFor();
  assert.equal((await current()).game.challenge.challengedId, (await current()).players[0].id);
});

test('2x mantém Duvidar desabilitado até o jogador forçado pagar o débito', async (t) => {
  const { a, b, seed, current } = await setup(t);
  await seed([['double-0', 'letra-A'], ['letra-C', 'letra-D']], { word: 'CA', debt: 2, last: true });
  await a.locator('[data-card="double-0"]').click();
  for (const page of [a, b]) {
    await page.locator('.debt-badge').filter({ hasText: 'Bia deve 2 letras' }).waitFor();
    assert.equal(await page.locator('[data-action="challenge"]').isDisabled(), true);
    assert.equal(await page.locator('#challenge-help-debt').isVisible(), true);
  }
  assert.equal(await a.locator('[data-action="skip"]').isDisabled(), true);
  assert.equal(await b.locator('[data-action="skip"]').isDisabled(), true);
  await b.locator('[data-card="letra-C"]').click();
  await b.locator('#debt-input').fill('AB');
  await b.locator('#confirm-debt').click();
  for (const page of [a, b]) await waitFor(() => page.locator('[data-action="challenge"]').isEnabled());
  assert.equal((await current()).game.letterDebt.count, 0);
  await a.locator('[data-action="challenge"]').click();
  await b.locator('#challenge-dialog').waitFor();
  assert.equal((await current()).game.challenge.challengedId, (await current()).players[1].id);
});

test('desafio cancela a escolha de carta, transmite a prévia e revela os votos só no resultado', async (t) => {
  const { a, b, c, seed, current } = await setup(t, { players: 3 });
  const before = await seed([['wild-1', 'letra-B'], ['wild-0', 'letra-C'], ['letra-D', 'letra-E']], { word: 'CA', last: true, debt: 0 });
  // Abrimos a escolha de Ana antes do desafio de Caio.
  await a.locator('[data-card="wild-1"]').click();
  await a.locator('#letter-dialog').waitFor();
  await c.locator('[data-action="challenge"]').click();
  await a.locator('#letter-dialog').waitFor({ state: 'hidden' });
  for (const page of [a, b, c]) await page.locator('#challenge-dialog').waitFor();
  assert.deepEqual((await current()).players.map((p) => p.hand), before.players.map((p) => p.hand));
  assert.equal(await b.locator('#challenge-input').evaluate((input) => input.readOnly), true);
  assert.equal(await a.locator('[data-action="draw"]').isDisabled(), true);
  assert.equal(await a.locator('[data-action="skip"]').isDisabled(), true);
  await a.locator('#challenge-input').fill('t1óo');
  assert.equal(await a.locator('#challenge-input').inputValue(), 'TO');
  await b.locator('#challenge-word').filter({ hasText: 'CATO' }).waitFor();
  assert.equal((await current()).game.blockedLetter, 'K');
  assert.equal((await current()).game.letterDebt.count, 0);
  await a.setViewportSize({ width: 375, height: 400 });
  // A alteração do visualViewport e o reposicionamento do modal ocorrem em eventos assíncronos.
  await waitFor(async () => {
    const button = await a.locator('#challenge-ok').boundingBox();
    return button && button.y >= 0 && button.y + button.height <= 400;
  });
  const ok = await a.locator('#challenge-ok').boundingBox();
  assert.ok(ok.y >= 0 && ok.y + ok.height <= 400, 'OK deve ficar acima do teclado');
  await a.locator('#challenge-ok').click();
  await b.locator('[data-vote="nao"]').waitFor();
  assert.equal(await a.locator('#challenge-vote-actions').isHidden(), true);
  assert.match(await a.locator('#challenge-description').innerText(), /não vota/);
  await b.locator('[data-vote="nao"]').click();
  await c.locator('#challenge-progress').filter({ hasText: '1/2' }).waitFor();
  assert.equal(await c.locator('#challenge-votes').innerText(), '');
  await c.locator('[data-vote="sim"]').click();
  await a.locator('#challenge-title').filter({ hasText: 'Palavra recusada' }).waitFor();
  assert.match(await a.locator('#challenge-votes').innerText(), /1 Sim \/ 1 Não/);
  assert.equal(await a.locator('#challenge-ok').isHidden(), true);
  await a.locator('#challenge-loss').click();
  for (const page of [a, b, c]) await page.locator('#challenge-dialog').waitFor({ state: 'hidden' });
  const after = await current();
  assert.equal(after.game.word, '');
  assert.equal(after.game.blockedLetter, null);
  assert.equal(after.game.letterDebt.count, 0);
  assert.equal(after.game.turnPlayerId, before.game.turnPlayerId);
  assert.equal(after.players[0].hand.length, before.players[0].hand.length + 4);

  await c.locator('[data-action="challenge"]').click();
  await c.locator('#toast').filter({ hasText: 'palavra está vazia' }).waitFor();
  assert.deepEqual(await current(), after);
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('OK sem letras e fechar a votação conta como Sim, penalizando o desafiante', async (t) => {
  const { a, b, seed, current } = await setup(t);
  const before = await seed([['letra-A', 'letra-B'], ['letra-C', 'letra-D']], { word: 'CA', debt: 0 });
  await b.locator('[data-action="challenge"]').click();
  await a.locator('#challenge-ok').click();
  await b.locator('#challenge-title').filter({ hasText: 'Aceitar palavra?' }).waitFor();
  await b.keyboard.press('Escape');
  await waitFor(async () => !(await current()).game.challenge);
  const after = await current();
  assert.equal(after.game.challengeResult.word, 'CA');
  assert.equal(after.game.challengeResult.tally.yes, 1);
  assert.equal(after.players[1].hand.length, before.players[1].hand.length + 4);
  await a.locator('.challenge-result').filter({ hasText: 'Palavra aceita' }).waitFor();
  assert.match(await a.locator('.table-notice').innerText(), /Bia comprou 4/);
  assert.equal(after.game.word, '');
  assert.equal(after.game.lastLetterPlayerId, null);
});

test('prazos no navegador: OK expira, PERDI automático e ausência de voto conta como Sim', async (t) => {
  let clock = Date.now();
  const { a, b, seed, current } = await setup(t, { nowSource: () => clock, challengeIntervalMs: 5 });
  const before = await seed([['letra-A', 'letra-B'], ['letra-C', 'letra-D']], { word: 'CA', debt: 0 });
  await b.locator('[data-action="challenge"]').click();
  await a.locator('#challenge-input').fill('TO');
  clock += 30_000;
  await a.locator('#challenge-title').filter({ hasText: 'O tempo acabou' }).waitFor();
  assert.equal(await a.locator('#challenge-ok').isHidden(), true);
  assert.equal(await a.locator('#challenge-loss').isEnabled(), true);
  clock += 10_000;
  await a.locator('#challenge-dialog').waitFor({ state: 'hidden' });
  assert.equal((await current()).players[0].hand.length, before.players[0].hand.length + 4);
  assert.equal((await current()).game.challengeResult.automatic, true);
  const next = await seed([['letra-A', 'letra-B'], ['letra-C', 'letra-D']], { word: 'CA', debt: 0 });
  await b.locator('[data-action="challenge"]').click();
  await a.locator('#challenge-ok').click();
  await b.locator('#challenge-title').filter({ hasText: 'Aceitar palavra?' }).waitFor();
  clock += 15_000;
  await a.locator('#challenge-dialog').waitFor({ state: 'hidden' });
  const after = await current();
  assert.equal(after.game.challengeResult.tally.yes, 1);
  assert.equal(after.players[1].hand.length, next.players[1].hand.length + 4);
  assert.equal(after.game.word, '');
});
