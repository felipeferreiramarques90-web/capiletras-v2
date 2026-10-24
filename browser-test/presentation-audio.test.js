import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { MemoryStorage } from '../storage/memory.js';
import { createDictionary } from '../bots/dictionary.js';
import { roomView, createDeck } from '../game/game.js';

test('avatares cabem com 2 e 8 jogadores em 360px; áudio real inicia e acompanha desafio com bots',async t=>{
 const storage=new MemoryStorage(); const app=createApp({roomStorage:storage,botOptions:{dictionary:createDictionary(['CASA']),rng:()=>.99,
 timings:{actionMinMs:150,actionMaxMs:150,responseMinMs:100,responseMaxMs:100}}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'});
 t.after(async()=>{await browser.close();await new Promise(r=>app.io.close(r));});
 for(const total of [2,8]){
 const page=await browser.newPage({viewport:{width:360,height:740},isMobile:true,hasTouch:true}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const Native=window.AudioContext;window.audioContexts=[];if(Native)window.AudioContext=class extends Native{constructor(...args){super(...args);window.audioContexts.push(this);}};});
 await page.goto(`http://127.0.0.1:${app.server.address().port}`);
 await page.locator('#player-name').fill('Ana Maria');await page.locator('[data-action="create"]').click();
 for(let i=1;i<total;i++){await page.locator('[data-action="add-bot"]').click();await page.waitForFunction(n=>document.querySelectorAll('[data-remove-bot]').length===n,i);}
 await page.locator('[data-action="start"]').click();await page.locator('.opponent').first().waitFor();
 assert.equal(await page.locator('.opponent').count(),total-1);
 assert.equal(await page.locator('.opponent strong').count(),0);
 assert.ok(await page.locator('.opponent .avatar').first().evaluate(el=>el.getBoundingClientRect().width>=24));
 assert.notEqual(await page.locator('.opponent .avatar').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
 assert.equal(await page.evaluate(()=>{const r=document.querySelector('.opponents');return r.scrollWidth>r.clientWidth;}),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('.avatar-target').first().tap();assert.match(await page.locator('.avatar-tooltip').textContent(),/Bot 1/);
 assert.equal(await page.evaluate(()=>window.audioContexts.length),1);
 await page.screenshot({path:`/tmp/avatars-${total}-mobile.png`});
 if(total===2){
 const [room]= (await storage.listRooms()).filter(r=>r.players.length===2);const cards=createDeck();
 room.players[1].hand=[cards.find(c=>c.id==='letra-A'),cards.find(c=>c.id==='letra-Z')];
 Object.assign(room.game,{word:'CA',lastPlayerId:room.players[1].id,lastLetterPlayerId:room.players[1].id,letterPlayNumber:1});
 await storage.saveRoom(room);for(const socket of app.io.sockets.sockets.values())if(socket.data.code===room.code)socket.emit('room:state',roomView(room,socket.data.playerId));
 await page.locator('[data-action="challenge"]').click();await page.locator('#challenge-dialog').waitFor({state:'visible'});
 await page.locator('#challenge-vote-actions [data-vote="sim"]').waitFor({state:'visible'});
 await page.locator('#sound-toggle').click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('capiletras:audio')).muted),true);await page.locator('#sound-toggle').click();
 await page.locator('#challenge-vote-actions [data-vote="sim"]').click();
 await page.waitForFunction(()=>document.querySelector('.table-notice')?.textContent.includes('aceita'),null,{timeout:15000});
 assert.equal(await page.evaluate(()=>window.audioContexts[0].state),'running');
 }
 await page.setViewportSize({width:1440,height:900});await page.screenshot({path:`/tmp/avatars-${total}-desktop.png`});
 assert.deepEqual(errors,[]);await page.close();
 }
});
