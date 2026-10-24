import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, waitFor } from './helpers.js';

for (const [card,dialog] of [['wild-0','#letter-dialog'],['block-0','#letter-dialog'],['multi-0','#multi-dialog']]) {
  test(`espada interrompe ${card}: fecha modal, preserva carta/compra e mantém indicador da vez`, async (t) => {
    const { a,b,seed,current } = await setup(t,{players:3});
    const before = await seed([[card,'letra-A'],['sword-0','sword-1','letra-B'],['letra-C','letra-D']],{debt:0,word:'CA',blockedLetter:'S',drawsThisTurn:1});
    assert.equal(await b.locator('[data-card=sword-0]').isEnabled(),true);
    await a.locator(`[data-card="${card}"]`).click(); await a.locator(dialog).waitFor();
    await b.locator('[data-card=sword-0]').click(); await b.locator('#letter-dialog').waitFor();
    assert.equal(await b.locator('[data-letter=S]').isDisabled(),true);
    await b.locator('[data-letter=A]').click();
    await a.locator(dialog).waitFor({state:'hidden'});
    await a.locator('#toast').filter({hasText:'A mesa mudou'}).waitFor();
    for (const page of [a,b]) {
      await page.locator('.word-display').filter({hasText:'CAA'}).waitFor();
      assert.equal(await page.locator('.word-turn-label').textContent(),'É a vez de: Ana');
      assert.match(await page.locator('.table-notice').innerText(),/Bia jogou na vez de Ana ⚔️/);
    }
    const after = await current();
    assert.deepEqual(after.players[0].hand,before.players[0].hand);
    assert.equal(after.game.drawsThisTurn,1);
    assert.equal(after.game.turnPlayerId,before.game.turnPlayerId);
    assert.equal(await b.locator('[data-card=sword-1]').isDisabled(),true);
    assert.equal(await a.locator('[data-action=draw]').isDisabled(),true);
  });
}

test('espada: SVG original, contraste e legenda cabem no celular/desktop; modal antigo também é cancelado', async (t) => {
  const { a,b,seed } = await setup(t,{players:3});
  await seed([['letra-A','letra-B'],['sword-0','pass-0','letra-C'],['letra-D','letra-E']],{debt:0,word:'CA',blockedLetter:null});
  for (const [width,height] of [[375,667],[1440,900]]) {
    await b.setViewportSize({width,height});
    const sword = b.locator('[data-card=sword-0]'), pass = b.locator('[data-card=pass-0]');
    assert.equal(await sword.locator('.card-sword-art').count(),1);
    assert.equal(await sword.locator('linearGradient').count(),1);
    assert.equal(await pass.locator('.card-sword-art').count(),0);
    assert.equal(await sword.locator('.card-corner').innerText(),'+');
    assert.equal(await sword.locator('.card-bottom').innerText(),'jogue na vez do outro');
    const card = await sword.boundingBox(), caption = await sword.locator('.card-bottom').boundingBox();
    assert.ok(caption.x >= card.x && caption.x + caption.width <= card.x + card.width);
    assert.ok(caption.y + caption.height <= card.y + card.height);
    assert.equal(await sword.evaluate((node) => getComputedStyle(node).backgroundColor),'rgb(20, 21, 29)');
    assert.ok(await b.evaluate(() => document.documentElement.scrollHeight <= innerHeight));
    await b.screenshot({path:`/tmp/capiletras-sword-${width}x${height}.png`});
  }
  await b.locator('[data-card=sword-0]').click(); await b.locator('#letter-dialog').waitFor();
  await a.locator('[data-card=letra-A]').click();
  await b.locator('#letter-dialog').waitFor({state:'hidden'});
  assert.equal(await b.locator('[data-card=sword-0]').isDisabled(),true,'Agora é a vez de Bia; a espada continua na mão.');
});

test('espada única mostra dica ao toque, sem modal nem vitória; com duas cartas pode jogar fora da vez', async (t) => {
  const {a,b,seed,current} = await setup(t,{players:3});
  await seed([['letra-A','letra-B'],['sword-0'],['letra-C','letra-D']],{debt:0,word:'CAS',blockedLetter:null});
  assert.equal(await b.locator('[data-card=sword-0]').isDisabled(),true);
  await b.locator('[data-restricted-card=sword-0]').click();
  await b.locator('#toast').filter({hasText:'Compre uma carta para poder jogar esta'}).waitFor();
  assert.equal(await b.locator('#letter-dialog').isVisible(),false);
  assert.equal((await current()).game.pendingVictory,null);
  await seed([['letra-A','letra-B'],['sword-0','letra-E'],['letra-C','letra-D']],{debt:0,word:'CAS',blockedLetter:null});
  await b.locator('[data-card=sword-0]').click(); await b.locator('[data-letter=A]').click();
  await a.locator('.word-display').filter({hasText:'CASA'}).waitFor();
  assert.equal((await current()).game.pendingVictory,null);
  assert.equal((await current()).game.turnPlayerId,(await current()).players[0].id);
});
