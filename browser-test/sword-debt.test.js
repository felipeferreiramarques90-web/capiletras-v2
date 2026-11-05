import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { createDictionary } from '../bots/dictionary.js';

for(const card of ['wild-0','multi-0']) test(`espada com débito cancela modal de ${card} e preserva pagamento e compra`,async t=>{
  const {a,b,seed,current,pay}=await setup(t,{players:3});
  const before=await seed([[card,'letra-A'],['sword-0','letra-B'],['letra-C','letra-D']],{debt:2,word:'CA',blockedLetter:'S',drawsThisTurn:1});
  assert.equal(await a.locator('[data-action=challenge]').isDisabled(),true);
  await a.locator(`[data-card=${card}]`).click();
  await a.locator('#debt-input').fill('AB');
  if(card==='multi-0') {
    await a.locator('#confirm-debt').click();
    await a.locator('#multi-dialog').waitFor();
  }
  assert.equal(await b.locator('[data-card=sword-0]').isEnabled(),true);
  await b.locator('[data-card=sword-0]').click();
  await b.locator('#letter-dialog').waitFor();
  assert.equal(await b.locator('#debt-dialog').isVisible(),false);
  assert.equal(await b.locator('[data-letter=S]').isDisabled(),true);
  await b.locator('[data-letter=N]').click();
  await a.locator('#debt-dialog').waitFor({state:'hidden'});
  await a.locator('#multi-dialog').waitFor({state:'hidden'});
  await a.locator('#toast').filter({hasText:'A mesa mudou'}).waitFor();
  await a.locator('.word-display').filter({hasText:'CAN'}).waitFor();
  assert.equal(await a.locator('[data-action=challenge]').isEnabled(),true);
  assert.deepEqual((await current()).game.letterDebt,before.game.letterDebt);
  assert.deepEqual((await current()).players[0].hand,before.players[0].hand);
  assert.equal((await current()).game.drawsThisTurn,1);
  assert.match(await a.locator('.debt-state').innerText(),/Ana deve 2 letras/);
  await a.screenshot({path:`/tmp/sword-debt-${card}-mobile.png`});
  await a.locator('#toast').waitFor({state:'hidden',timeout:8000});
  await pay(card,'SS');
  if(card==='wild-0') await a.locator('[data-letter=A]').click();
  else {await a.locator('#multi-input').fill('AA');await a.locator('#confirm-multi').click();}
  const expected=card==='wild-0'?'CANSSA':'CANSSAA';
  await a.locator('.word-display').filter({hasText:expected}).waitFor();
  assert.equal((await current()).game.letterDebt.count,0);
  assert.equal((await current()).game.lastLetterWasSword,false);
});

test('desafio da espada com débito: Y correto, palavra validada e mesa resetada',async t=>{
  const {a,b,c,seed,current}=await setup(t,{players:3,automaticValidation:true,dictionaryProvider:()=>createDictionary(['CANA'])});
  await seed([['wild-0','pass-0','double-0'],['sword-0','letra-B'],['letra-C','letra-D']],{debt:2,word:'CA',blockedLetter:'K'});
  await b.locator('[data-card=sword-0]').click();await b.locator('[data-letter=N]').click();
  await c.locator('.word-display').filter({hasText:'CAN'}).waitFor();
  assert.equal(await c.locator('[data-action=challenge]').isEnabled(),true);
  await c.locator('[data-action=challenge]').click();
  await b.locator('#challenge-dialog').waitFor();
  assert.equal((await current()).game.challenge.challengedId,(await current()).players[1].id);
  await b.locator('#challenge-input').pressSequentially('A');
  await b.locator('#challenge-ok').click();
  await a.locator('#challenge-dialog').waitFor({state:'hidden'});
  const after=await current();
  assert.equal(after.game.challengeResult.reason,'aceita');
  assert.equal(after.game.word,'');assert.equal(after.game.letterDebt.count,0);
  assert.equal(after.game.lastLetterWasSword,false);
  assert.equal(after.players[2].hand.length,6);
});
