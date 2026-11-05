import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { io as client } from 'socket.io-client';
import { createApp } from '../server.js';
import { MemoryStorage } from '../storage/memory.js';
import { createDictionary } from '../bots/dictionary.js';
const wait=async fn=>{for(let n=0;n<300;n++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Prazo de teste excedido');};
test('rede serializa desconexão, compras automáticas, reconexão e restauração de prazo',async t=>{
  let now=100000;const storage=new MemoryStorage();
  const {server,io}=createApp({roomStorage:storage,nowSource:()=>now,randomSource:()=>.375,challengeIntervalMs:10,dictionaryProvider:()=>createDictionary(['CASA'])});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
  const sockets=[];t.after(async()=>{sockets.forEach(s=>s.disconnect());await new Promise(r=>io.close(r));});
  async function connect(sessionId=randomUUID()) {const s=client(url,{transports:['websocket'],reconnection:false});s.sessionId=sessionId;s.on('room:state',v=>s.view=v);sockets.push(s);await once(s,'connect');return s;}
  const a=await connect();assert.equal((await a.timeout(3000).emitWithAck('room:create',{sessionId:a.sessionId,name:'Ana'})).ok,true);
  const code=a.view.code,b=await connect();await b.timeout(3000).emitWithAck('room:join',{code,sessionId:b.sessionId,name:'Bia'});
  await a.timeout(3000).emitWithAck('room:settings',{maxDrawsPerTurn:2});await a.timeout(3000).emitWithAck('game:start',{});await wait(()=>b.view?.phase==='playing');
  const id=a.view.meId,hand=a.view.hand.length;a.disconnect();
  await wait(()=>b.view.game.offlineTurn?.playerId===id);assert.equal(b.view.game.turnPlayerId,id);assert.equal(b.view.game.offlineTurn.deadline,121000);
  now=121000;await wait(()=>b.view.game.drawsThisTurn===1);assert.match(b.view.notice,/comprou uma carta automaticamente/);
  const resumed=await connect(a.sessionId);await resumed.timeout(3000).emitWithAck('room:join',{code,sessionId:resumed.sessionId,name:'Ana'});
  await wait(()=>!b.view.game.offlineTurn);assert.equal(resumed.view.hand.length,hand+1);assert.equal(resumed.view.game.drawsRemaining,1);
  resumed.disconnect();await wait(()=>b.view.game.offlineTurn?.deadline===142000);
  now=142000;await wait(()=>b.view.game.drawsThisTurn===2);
  now=147000;await wait(()=>b.view.game.turnPlayerId===b.view.meId || b.view.game.pendingVictory);assert.match(b.view.notice,/jogada automática/);
  const saved=await storage.getRoom(code);assert.equal(saved.players.find(p=>p.id===id).connected,false);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)),saved);
});
