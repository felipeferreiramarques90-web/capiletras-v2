import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { MemoryStorage } from '../storage/memory.js';
import { createDictionary } from '../bots/dictionary.js';
import { createDeck, roomView } from '../game/game.js';

test('um humano adiciona/remove três bots no celular, joga e confirma a vitória de um bot',async t=>{
 const storage=new MemoryStorage();
 const app=createApp({roomStorage:storage,challengeIntervalMs:5,botOptions:{dictionary:createDictionary(['CASA']),rng:()=>.99,
  timings:{actionMinMs:30,actionMaxMs:50,responseMinMs:20,responseMaxMs:30}}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})});
 t.after(async()=>{await browser.close();await new Promise(r=>app.io.close(r));});
 const page=await browser.newPage({viewport:{width:375,height:667},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${app.server.address().port}`);
 await page.locator('#player-name').fill('Ana');await page.locator('[data-action="create"]').click();
 for(let i=0;i<3;i++){await page.locator('[data-action="add-bot"]').click();await page.locator('.player-list .bot-icon').nth(i).waitFor();}
 assert.equal(await page.locator('[data-remove-bot]').count(),3);
 await page.locator('[data-remove-bot]').first().click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-remove-bot]').length===2);
 await page.locator('[data-action="add-bot"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-remove-bot]').length===3);
 assert.match(await page.locator('.lobby-bot-notice').textContent(),/entrou na sala/);
 await page.locator('[data-action="start"]').click();await page.locator('.hand-cards').waitFor();
 assert.equal(app.io.sockets.sockets.size,1,'só o humano possui socket');
 assert.equal(await page.locator('.opponent .bot-avatar').count(),3);
 const [room]=await storage.listRooms();const cards=createDeck();const hands=[['letra-X','letra-Z'],['letra-A'],['letra-B','letra-C'],['letra-D','letra-E']];
 room.players.forEach((p,i)=>p.hand=hands[i].map(id=>cards.find(c=>c.id===id)));
 Object.assign(room.game,{word:'CAS',lastPlayerId:room.players[0].id,lastLetterPlayerId:room.players[0].id,letterPlayNumber:1,
  turnPlayerId:room.players[1].id,deck:cards.filter(c=>!hands.flat().includes(c.id)),discard:[],version:room.game.version+1});
 await storage.saveRoom(room);
 for(const socket of app.io.sockets.sockets.values())socket.emit('room:state',roomView(room,socket.data.playerId));
 await page.locator('.pending-victory').waitFor();
 assert.match(await page.locator('.word-turn-name').textContent(),/Bot/);
 await page.locator('[data-action="accept-victory"]').click();await page.locator('.victory-panel').waitFor();
 assert.match(await page.locator('.victory-panel h1').textContent(),/Bot.*venceu/);
 assert.equal(await page.locator('.final-word > strong').textContent(),'CASA');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
});
