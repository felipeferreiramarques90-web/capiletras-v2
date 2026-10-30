import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, waitFor } from './helpers.js';

test('caixinhas pastéis, contador SVG e menu de som no cabeçalho',async t=>{
 const {a,b,seed}=await setup(t);await seed([['letra-A','letra-B'],['letra-C','letra-D']],{debt:0,blockedLetter:null});
 const header=a.locator('.site-header');assert.equal(await header.isVisible(),true);
 assert.equal(await header.locator('#sound-toggle').count(),1);assert.equal(await header.locator('.sound-controls details').count(),1);
 const color=await a.locator('.opponent .avatar').evaluate(el=>getComputedStyle(el).backgroundColor);
 assert.ok(await a.locator('.count-cards-icon').isVisible());assert.equal(await b.locator('.opponent.active').count(),1);
 await a.locator('[data-action="draw"]').click();await a.waitForFunction(color=>{const el=document.querySelector('.opponent .avatar');return el && getComputedStyle(el).backgroundColor===color;},color);
 await a.locator('.sound-controls summary').click();assert.equal(await a.locator('#sound-volume').isVisible(),true);
 const volume=await a.locator('#sound-volume').boundingBox(),head=await header.boundingBox(),hand=await a.locator('.hand-section').boundingBox();
 assert.ok(volume.y>=head.y+head.height);assert.ok(volume.y+volume.height<hand.y);
 await a.locator('.word-display').click();assert.equal(await a.locator('#sound-volume').isVisible(),false);
});

test('Passar letra e Bloqueio ficam no texto sob o visor, persistem e desaparecem sem mover a mesa',async t=>{
 const {a,b,seed,current,pay}=await setup(t);
 const hands=[['pass-0','block-0','letra-A'],['pass-1','letra-B','letra-C']];
 await seed(hands,{debt:0,blockedLetter:null,word:'CA'});
 const before=await a.locator('.table-controls').boundingBox();
 await a.locator('[data-card="pass-0"]').click();await b.locator('.debt-state').filter({hasText:'Bia deve 1 letra'}).waitFor();
 await b.locator('[data-card="pass-1"]').click();await a.locator('.debt-state').filter({hasText:'Ana deve 2 letras'}).waitFor();
 await a.locator('[data-action="draw"]').click();await waitFor(async()=> (await current()).game.drawsThisTurn===1);
 assert.match(await a.locator('.table-state').innerText(),/Ana deve 2 letras/);
 await a.locator('.table-notice').filter({hasText:'comprou'}).waitFor();
 await pay('block-0','AB');await a.locator('[data-letter="C"]').click();await a.locator('#confirm-block').click();await a.locator('[data-block="K"]').click();await a.locator('#confirm-block').click();
 await a.locator('.block-state').filter({hasText:'Letra bloqueada: K'}).waitFor();assert.equal(await a.locator('.debt-state').count(),0);
 assert.equal(await a.locator('.block-badge,.debt-badge,.challenge-debt-reason').count(),0);
 await b.locator('[data-card="letra-B"]').click();await a.locator('.block-state').waitFor({state:'hidden'});
 assert.equal(await a.locator('.table-state').innerText(),'');
 const after=await a.locator('.table-controls').boundingBox();assert.ok(Math.abs(before.y-after.y)<=1);
 await a.screenshot({path:'/tmp/pastel-debt-mobile.png'});
});
