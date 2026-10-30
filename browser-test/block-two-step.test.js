import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,waitFor} from './helpers.js';

test('Bloqueio: teclado único, dois passos locais, confirmação atômica e X nos dois passos',async t=>{
 const {a,seed,current}=await setup(t);await seed([['block-0','letra-A'],['letra-B','letra-C']],{debt:0,blockedLetter:'K'});
 const before=await current();const card=a.locator('[data-card="block-0"]');await card.click();
 assert.equal(await a.locator('#letter-dialog .letter-grid').count(),1);assert.equal(await a.locator('#letter-title').innerText(),'Bloqueio');
 assert.equal(await a.locator('#block-step-title').innerText(),'Adicionar letra');assert.equal(await a.locator('#confirm-block').innerText(),'Adicionar');assert.ok(await a.locator('#confirm-block').isDisabled());
 assert.ok(await a.locator('[data-letter="K"]').isDisabled());
 assert.doesNotMatch(await a.locator('#letter-dialog').innerText(),/SUA CARTA|Letras permitidas|2\.|próxima jogada|Sua escolha|Voltar/);
 await a.locator('#close-letter').click();assert.deepEqual(await current(),before);
 await card.click();await a.locator('[data-letter="A"]').click();await a.locator('[data-letter="B"]').click();await a.locator('#confirm-block').click();
 assert.deepEqual(await current(),before);assert.equal(await a.locator('#block-step-title').innerText(),'Letra para bloquear');assert.equal(await a.locator('#confirm-block').innerText(),'Bloquear letra');assert.ok(await a.locator('#confirm-block').isDisabled());
 assert.equal(await a.locator('#block-add-chip').innerText(),'Adicionar: B');assert.equal(await a.locator('#block-add-chip').evaluate(el=>el.tagName),'SPAN');assert.equal(await a.locator('[data-block].selected').count(),0);
 assert.equal(await a.locator('#letter-dialog').evaluate(el=>el.scrollHeight>el.clientHeight),false);await a.screenshot({path:'/tmp/block-two-step-mobile.png'});
 await a.locator('#close-letter').click();assert.deepEqual(await current(),before);
 await card.click();await a.locator('[data-letter="A"]').click();await a.locator('#confirm-block').click();await a.locator('[data-block="K"]').click();await a.locator('#confirm-block').click();
 await waitFor(async()=>(await current()).game.version===before.game.version+1);const after=await current();assert.equal(after.game.word,'XA');assert.equal(after.game.blockedLetter,'K');assert.equal(after.players[0].hand.length,1);
});
