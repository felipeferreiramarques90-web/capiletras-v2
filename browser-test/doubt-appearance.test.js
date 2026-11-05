import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { createDictionary } from '../bots/dictionary.js';

test('DUVIDAR tem centro transparente, fita contínua e estados sem mover a mesa', async t => {
  const { a, seed } = await setup(t, { players: 3, dictionaryProvider: () => createDictionary(['CASA']) });
  const hands = [['double-0', 'letra-A'], ['letra-B', 'letra-C'], ['letra-D', 'letra-E']];
  const button = a.locator('[data-action=challenge]');
  for (const [width, height] of [[320,667], [375,667], [1440,900]]) {
    await a.setViewportSize({ width, height });
    await seed(hands, { debt: 0, word: 'CA', blockedLetter: null, last: true });
    assert.equal(await button.isEnabled(), true);
    assert.equal(await button.innerText(), 'DUVIDAR');
    assert.doesNotMatch(await button.textContent(), /Duvidar da palavra|\?/);
    assert.equal(await button.locator('span').count(), 0);
    const styles = await button.evaluate(n => {
      const s = getComputedStyle(n), border = getComputedStyle(n, '::before');
      const range = document.createRange(); range.selectNodeContents(n);
      return { background: s.backgroundColor, color: s.color, font: s.fontFamily,
        opacity: s.opacity, filter: s.filter, stripe: border.backgroundImage,
        band: border.paddingTop, mask: border.maskComposite, textWidth: range.getBoundingClientRect().width };
    });
    assert.equal(styles.background, 'rgba(0, 0, 0, 0)');
    assert.equal(styles.color, 'rgb(255, 255, 255)');
    assert.match(styles.font, /Rye/);
    assert.match(styles.stripe, /repeating-linear-gradient\(45deg/);
    assert.match(styles.stripe, /rgb\(255, 224, 75\)/);
    assert.match(styles.stripe, /rgb\(21, 21, 21\)/);
    assert.equal(styles.band, '7px'); assert.ok(styles.mask.split(',').every(mode => mode.trim() === 'exclude'));
    const before = await button.boundingBox(), draw = await a.locator('[data-action=draw]').boundingBox();
    assert.ok(before.height >= 44); assert.ok(styles.textWidth < before.width - 16);
    assert.ok(draw.x + draw.width < before.x, 'Baralho fica à esquerda do botão');
    await a.evaluate(async () => { await document.fonts.load('400 14px Rye', 'DUVIDAR'); });
    assert.equal(await a.evaluate(() => document.fonts.check('400 14px Rye', 'DUVIDAR')), true);
    await a.screenshot({ path: `/tmp/duvidar-enabled-${width}.png` });
    await seed(hands, { debt: 2, word: 'CA', blockedLetter: null, last: true });
    assert.equal(await button.isDisabled(), true);
    const after = await button.boundingBox();
    assert.deepEqual(after, before, 'Habilitação não muda tamanho nem posição');
    assert.ok(Number(await button.evaluate(n => getComputedStyle(n).opacity)) < 1);
    assert.match(await button.evaluate(n => getComputedStyle(n).filter), /saturate\(0.25\)/);
    assert.equal(await button.innerText(), 'DUVIDAR');
    await a.screenshot({ path: `/tmp/duvidar-disabled-${width}.png` });
  }
});
