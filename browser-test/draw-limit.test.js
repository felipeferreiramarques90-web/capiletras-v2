import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, waitFor } from './helpers.js';
import { createDictionary } from '../bots/dictionary.js';
test('lobby configura compras; pilha mostra x N e anima sem deslocar a mão, com reduced-motion sem voo',async t=>{
  const {a,b,seed,current,storage,code}=await setup(t,{start:false,dictionaryProvider:()=>createDictionary(['CASA'])});
  assert.equal(await a.locator('#draw-limit').innerText(),'1');
  for(let i=2;i<=4;i++) {await a.locator('[data-draw-step="1"]').click();await waitFor(async()=>(await current()).settings.maxDrawsPerTurn===i);}
  await b.locator('#draw-limit').filter({hasText:'4'}).waitFor();assert.equal(await b.locator('[data-draw-step]').count(),0);
  await a.locator('[data-action=start]').click();await a.locator('.hand-cards').waitFor();
  await seed([['wild-0','letra-A'],['letra-B','letra-C']],{word:'CA',debt:0,blockedLetter:null});
  const bounds=await a.locator('.hand-cards').boundingBox();
  assert.equal(await a.locator('.draw-remaining').innerText(),'🂠 x 4');
  assert.doesNotMatch(await a.locator('.draw-pile').innerText(),/COMPRAR|na pilha|jogadas/);
  await a.locator('[data-action=draw]').click();
  await a.locator('.draw-remaining').filter({hasText:'x 3'}).waitFor();
  await a.locator('.draw-flight').first().waitFor();
  await b.locator('.draw-flight').first().waitFor();
  assert.equal((await a.locator('.hand-cards').boundingBox()).y,bounds.y);
  await a.waitForTimeout(650);
  await a.emulateMedia({reducedMotion:'reduce'});
  await a.locator('[data-action=draw]').click();await a.locator('.draw-remaining').filter({hasText:'x 2'}).waitFor();
  assert.equal(await a.locator('.draw-flight').count(),0);
  await a.locator('[data-action=draw]').click();await a.locator('.draw-remaining').filter({hasText:'x 1'}).waitFor();
  await a.locator('[data-action=draw]').click();await a.locator('.draw-remaining').filter({hasText:'x 0'}).waitFor();
  assert.equal(await a.locator('[data-action=draw]').isDisabled(),true);
  assert.match(await a.locator('.deck-count').innerText(),/^\d+$/);
  await a.screenshot({path:'/tmp/draw-limit-mobile.png'});
});
