import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

for (const [vote,outcome] of [['sim','aceita'],['nao','recusada']]) {
  test(`votação privada: reconexão preserva voto próprio e resultado mostra só palavra ${outcome}`,async t=>{
    const {a,b,c,seed}=await setup(t,{players:3});
    await seed([['letra-A','letra-B'],['wild-0','letra-C'],['letra-D','letra-E']],{word:'CA',debt:0,blockedLetter:null});
    await b.locator('[data-action="challenge"]').click();
    await a.locator('#challenge-input').fill('TO');
    await a.locator('#challenge-ok').click();
    await b.locator('#challenge-title').filter({hasText:'Aceitar palavra?'}).waitFor();
    await b.locator('[data-vote="sim"]').click();
    await b.locator('[data-vote="sim"][aria-pressed="true"]').waitFor();
    await b.reload();
    await b.locator('[data-vote="sim"][aria-pressed="true"]').waitFor();
    assert.equal(await b.locator('[data-vote="sim"]').isDisabled(),true);
    assert.equal(await b.locator('[data-vote="nao"]').getAttribute('aria-pressed'),'false');
    for(const page of [a,b,c]) {
      const text=await page.locator('#challenge-dialog').innerText();
      assert.doesNotMatch(text,/\d+\/\d+|responderam|registrado|ocultos até|antecipad|Ana|Bia|Caio/);
      assert.equal(await page.locator('#challenge-word').innerText(),'CATO');
      assert.equal(await page.locator('#challenge-progress').isVisible(),false);
    }
    await c.locator(`[data-vote="${vote}"]`).click();
    for(const page of [a,b,c]) {
      await page.locator('.table-notice').filter({hasText:`Palavra ${outcome}`}).waitFor();
      assert.equal(await page.locator('.table-notice').innerText(),`Palavra ${outcome}`);
      const visible=await page.locator('body').innerText();
      assert.doesNotMatch(visible,/\d+ Sim|\d+ Não|\d+\/\d+ responderam|antecipad|Resultado do desafio/);
      assert.equal(await page.locator('.challenge-vote-list').count(),0);
      assert.equal(await page.locator('#challenge-dialog').isVisible(),false);
    }
  });
}
