import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,waitFor} from './helpers.js';

for(const [automatic,word,letters,outcome] of [[true,'CA','SA','aceita'],[true,'ZZZ','','recusada'],[false,'CA','SA','aceita']])test(`desafio ${automatic?'automático':'por votação'}: ${outcome}`,async t=>{
 const {a,b,seed,current}=await setup(t,{automaticValidation:automatic});await seed([['letra-A','letra-B'],['letra-C','letra-D']],{debt:0,word,blockedLetter:null});
 await b.locator('[data-action="challenge"]').click();await a.locator('#challenge-input').waitFor();if(letters)await a.locator('#challenge-input').pressSequentially(letters);
 const seen=[];await a.exposeFunction('sawVote',()=>seen.push(true));await a.evaluate(()=>new MutationObserver(()=>{if(document.querySelector('#challenge-dialog')?.classList.contains('voting-dialog'))void window.sawVote();}).observe(document.querySelector('#challenge-dialog'),{attributes:true,subtree:true}));
 await a.locator('#challenge-ok').click();
 if(!automatic){await b.locator('[data-vote="sim"]').waitFor();await b.locator('[data-vote="sim"]').click();}
 await waitFor(async()=>Boolean((await current()).game.challengeResult));assert.equal((await current()).game.challengeResult.reason,outcome);
 for(const p of [a,b]){await p.locator('#challenge-dialog').waitFor({state:'hidden'});assert.equal(await p.locator('.table-notice').innerText(),automatic?`${word+letters}: palavra ${outcome}`:`Palavra ${outcome}`);}
 if(automatic)assert.deepEqual(seen,[]);
});

test('lobby: interruptor padrão ligado, só host edita, demais acompanham e reset religa',async t=>{
 const {a,b,storage,code}=await setup(t,{automaticValidation:true,start:false});
 assert.equal(await a.locator('#automatic-validation').isChecked(),true);assert.equal(await b.locator('#automatic-validation').isDisabled(),true);
 await a.locator('#automatic-validation').uncheck();await waitFor(async()=>(await storage.getRoom(code)).settings.automaticValidation===false);await b.waitForFunction(()=>!document.querySelector('#automatic-validation').checked);
 await a.locator('.deck-settings summary').click();await a.locator('[data-action="reset-deck"]').click();await b.waitForFunction(()=>document.querySelector('#automatic-validation').checked);
 await a.locator('#automatic-validation').scrollIntoViewIfNeeded();await a.screenshot({path:'/tmp/automatic-validation-lobby.png'});await a.locator('[data-action="start"]').click();await a.locator('.hand-cards').waitFor();assert.equal(await a.locator('#automatic-validation').count(),0);
});
test('falha do dicionário mostra aviso no modal de votação e permite responder',async t=>{
 const {a,b,seed,current}=await setup(t,{automaticValidation:true,dictionaryProvider:()=>{throw Error('offline');}});
 await seed([['letra-A','letra-B'],['letra-C','letra-D']],{debt:0,word:'CA'});await b.locator('[data-action="challenge"]').click();await a.locator('#challenge-input').pressSequentially('SA');await a.locator('#challenge-ok').click();
 await b.locator('#challenge-description').filter({hasText:'Validação automática indisponível, a mesa vota'}).waitFor();await b.locator('[data-vote="sim"]').click();await waitFor(async()=>Boolean((await current()).game.challengeResult));
});
for(const accepted of [true,false])test(`vitória pendente automática: ${accepted?'vence':'compra e continua'}`,async t=>{
 const {a,b,seed,current}=await setup(t,{automaticValidation:true});await seed([['letra-A'],['letra-B','letra-C']],{debt:0,blockedLetter:null,word:accepted?'CAS':'ZZ'});await a.locator('[data-card="letra-A"]').click();await b.locator('.pending-victory').waitFor();await b.locator('[data-action="challenge"]').click();await a.locator('#challenge-ok').click();
 if(accepted){await a.locator('.victory-panel').waitFor();assert.equal(await a.locator('.final-word > strong').innerText(),'CASA');assert.equal(await b.locator('.victory-challenge-result').innerText(),'CASA: palavra aceita');}
 else{await waitFor(async()=>!(await current()).game.pendingVictory);assert.equal((await current()).players[0].hand.length,4);assert.equal((await current()).game.turnPlayerId,(await current()).players[1].id);await a.locator('.table-notice').filter({hasText:'ZZA: palavra recusada'}).waitFor();}
});
