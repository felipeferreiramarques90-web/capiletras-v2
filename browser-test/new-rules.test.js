import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, waitFor } from './helpers.js';

for(const card of ['life-0','pass-0','double-0'])test(`carta única ${card}: aviso ao toque e compra habilita a carta sem mover a mão`,async t=>{
 const {a,seed,current}=await setup(t,{players:3});
 await seed([[card],['letra-B','letra-C'],['letra-D','letra-E']],{debt:0,word:'',blockedLetter:null,last:true});
 const before=await a.locator('.hand-cards').boundingBox();
 assert.equal(await a.locator(`[data-card="${card}"]`).isDisabled(),true);
 await a.locator(`[data-restricted-card="${card}"]`).click();
 await a.locator('#toast').filter({hasText:'Compre uma carta para poder jogar esta'}).waitFor();
 assert.equal((await current()).game.winnerId,null);
 await a.locator('[data-action=draw]').click();
 await waitFor(()=>a.locator(`[data-card="${card}"]`).isEnabled());
 assert.equal(await a.locator('[data-action=skip]').count(),0);
 const after=await a.locator('.hand-cards').boundingBox();
 assert.equal(after.y,before.y);assert.equal(after.height,before.height);
});

test('2x preta usa texto serifado em gradiente próprio, sem ícones nos cantos e legível nas duas telas',async t=>{
 const {a,seed}=await setup(t,{players:3});
 await seed([['double-0','letra-A'],['letra-B','letra-C'],['letra-D','letra-E']],{debt:0,word:'CA',blockedLetter:null,last:true});
 for(const[width,height]of[[375,667],[1440,900]]){
  await a.setViewportSize({width,height});
  const card=a.locator('[data-card=double-0]');
  assert.equal(await card.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(21, 19, 32)');
  assert.equal(await card.locator('.card-double-art text').textContent(),'2x');
  assert.equal(await card.locator('.card-corner').isVisible(),false);
  assert.equal(await card.locator('.double-cyan').count(),1);
  assert.equal(await card.locator('.double-violet').count(),1);
  assert.equal(await card.locator('.double-pink').count(),1);
  assert.ok(await a.evaluate(()=>document.documentElement.scrollHeight<=innerHeight));
  await a.screenshot({path:`/tmp/capiletras-double-black-${width}x${height}.png`});
 }
});

test('duas espadas preservam modal da outra espada com visor atual; cancelam jogada da vez só uma vez e avisam em ordem',async t=>{
 const {a,b,c,seed,current}=await setup(t,{players:3});
 await seed([['wild-0','letra-A'],['sword-0','letra-B'],['sword-1','letra-C']],{debt:0,word:'CA',blockedLetter:null,drawsThisTurn:1});
 await a.evaluate(()=>{
  window.toastMessages=[];
  new MutationObserver(()=>{const text=document.querySelector('#toast').textContent;if(text)window.toastMessages.push(text);}).observe(document.querySelector('#toast'),{childList:true,subtree:true});
 });
 await a.locator('[data-card=wild-0]').click();
 await b.locator('[data-card=sword-0]').click();await c.locator('[data-card=sword-1]').click();
 await b.locator('[data-letter=S]').click();
 await a.locator('#letter-dialog').waitFor({state:'hidden'});
 await c.locator('#letter-live-preview').filter({hasText:'Visor agora: CAS'}).waitFor();
 assert.equal(await c.locator('#letter-dialog').isVisible(),true);
 await c.locator('[data-letter=A]').click();
 await a.locator('.word-display').filter({hasText:'CASA'}).waitFor();
 const saved=await current();assert.equal(saved.game.drawsThisTurn,1);
 assert.equal(saved.game.turnPlayerId,saved.players[0].id);assert.equal(saved.game.lastLetterPlayerId,saved.players[2].id);
 assert.equal(await a.evaluate(()=>window.toastMessages.filter(x=>x.includes('A mesa mudou')).length),1);
 await a.locator('.table-notice').filter({hasText:'Bia jogou na vez de Ana'}).waitFor();
 await a.locator('.table-notice').filter({hasText:'Caio jogou na vez de Ana'}).waitFor();
 assert.equal(await a.locator('.word-turn-label').textContent(),'É a vez de: Ana');
});

test('modal da espada reflete bloqueio e visor atuais sem fechar enquanto outra pessoa joga',async t=>{
 const {a,c,seed,current}=await setup(t,{players:3});
 await seed([['block-0','letra-A'],['letra-B','letra-C'],['sword-0','letra-D']],{debt:0,word:'CA',blockedLetter:null});
 await c.locator('[data-card=sword-0]').click();
 await a.locator('[data-card=block-0]').click();
 await a.locator('[data-letter=A]').click();await a.locator('#confirm-block').click();await a.locator('[data-block=X]').click();await a.locator('#confirm-block').click();
 await c.locator('#letter-live-preview').filter({hasText:'Visor agora: CAA'}).waitFor();
 assert.equal(await c.locator('[data-letter=X]').isDisabled(),true);
 await c.locator('[data-letter=Y]').click();
 await a.locator('.word-display').filter({hasText:'CAAY'}).waitFor();
 assert.equal((await current()).game.blockedLetter,null);
});
