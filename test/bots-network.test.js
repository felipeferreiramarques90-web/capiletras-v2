import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { io as client } from 'socket.io-client';
import { createApp } from '../server.js';
import { MemoryStorage } from '../storage/memory.js';
import { createDictionary } from '../bots/dictionary.js';
import { BOT_RULES } from '../bots/config.js';
import { decideBotAction } from '../bots/brain.js';
import { createDeck, roomView, createRoom, startGame } from '../game/game.js';
import { addBot } from '../bots/players.js';

const dictionary=createDictionary(['CASA','CASAS','BOLA','BOLAS','CAPIVARA','CANTO']);
const timing={actionMinMs:5,actionMaxMs:8,responseMinMs:5,responseMaxMs:8};
async function waitFor(predicate){for(let i=0;i<400;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Bot não concluiu a ação esperada.');}
const emit=(s,event,data={})=>s.timeout(3000).emitWithAck(event,data);
async function setup(t,botOptions={}){
 const storage=new MemoryStorage();
 const {server,io}=createApp({roomStorage:storage,challengeIntervalMs:5,botOptions:{dictionary,rng:()=>.99,timings:timing,...botOptions}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const url=`http://127.0.0.1:${server.address().port}`;
 const sockets=[];
 t.after(async()=>{for(const s of sockets)s.disconnect();await new Promise(r=>io.close(r));});
 async function connect(sessionId=randomUUID()){
  const s=client(url,{transports:['websocket'],forceNew:true,reconnection:false,autoConnect:false});s.sessionId=sessionId;s.on('room:state',v=>s.view=v);sockets.push(s);s.connect();await once(s,'connect');return s;
 }
 const human=await connect();assert.equal((await emit(human,'room:create',{sessionId:human.sessionId,name:'Ana'})).ok,true);
 const code=human.view.code;
 async function start(count=3){for(let i=0;i<count;i++)assert.equal((await emit(human,'room:bot:add')).ok,true);assert.equal((await emit(human,'game:start')).ok,true);}
 async function seed(hands,game={}){
  const room=await storage.getRoom(code),deck=createDeck(),used=new Set(hands.flat());
  room.players.forEach((p,i)=>p.hand=hands[i].map(id=>deck.find(c=>c.id===id)));
  Object.assign(room.game,{deck:deck.filter(c=>!used.has(c.id)),discard:[],word:'CA',letterPlayNumber:1,
   lastPlayerId:room.players[0].id,lastLetterPlayerId:room.players[0].id,turnPlayerId:room.players[1].id,botDecisions:{},...game});
  await storage.saveRoom(room);
  await emit(human,'room:join',{code,sessionId:human.sessionId,name:'Ana'});
  return room;
 }
 return {human,code,storage,connect,start,seed,io};
}

test('rede: anfitrião adiciona/remove bots com nomes únicos; não anfitrião não gerencia',async t=>{
 const f=await setup(t),{human,code,connect}=f;
 const other=await connect();assert.equal((await emit(other,'room:join',{code,sessionId:other.sessionId,name:'Bia'})).ok,true);
 assert.equal((await emit(other,'room:bot:add')).ok,false);
 for(let i=0;i<6;i++)assert.equal((await emit(human,'room:bot:add')).ok,true);
 assert.equal(human.view.players.length,8);assert.equal(new Set(human.view.players.map(p=>p.name)).size,8);
 assert.equal((await emit(human,'room:bot:add')).ok,false);
 const bot=human.view.players.find(p=>p.isBot);
 assert.equal(bot.connected,true);assert.ok(!('sessionId' in bot));assert.ok(!('hand' in bot));
 assert.equal((await emit(other,'room:bot:remove',{playerId:bot.id})).ok,false);
 assert.equal((await emit(human,'room:bot:remove',{playerId:bot.id})).ok,true);
 assert.equal(human.view.players.length,7);
});

test('rede: três bots independentes jogam por funções normais e salvam cada ação, mantendo mãos privadas',async t=>{
 const f=await setup(t);await f.start();
 const room=await f.seed([['letra-Z','letra-X'],['letra-S','letra-Y'],['letra-A','letra-W'],['pass-0','letra-V']]);
 await waitFor(async()=>{const r=await f.storage.getRoom(f.code);return r.game.turnPlayerId===room.players[0].id&&r.game.turnNumber>=4;});
 const saved=await f.storage.getRoom(f.code);
 assert.equal(saved.game.word,'CASA');assert.equal(saved.game.letterDebt.count,1);
 assert.equal(saved.players[1].hand.length,1);assert.equal(saved.players[2].hand.length,1);assert.equal(saved.players[3].hand.length,1,'Passar letra preserva o prefixo sem precisar comprar');
 assert.ok(f.human.view.players.every(p=>!p.hand&&!p.sessionId));
 assert.deepEqual(saved,JSON.parse(JSON.stringify(saved)));
});

test('rede: sala preserva queda de conexão, pausa bots e retoma a vaga; sair remove mesmo com bots',async t=>{
 const f=await setup(t);await f.start();
 const ids=f.human.view.players.filter(p=>p.isBot).map(p=>p.id);
 f.human.disconnect();
 await waitFor(async()=>!(await f.storage.getRoom(f.code)).players[0].connected);
 assert.ok((await f.storage.getRoom(f.code)).players.filter(p=>p.isBot).every(p=>p.connected));
 const back=await f.connect(f.human.sessionId);
 assert.equal((await emit(back,'room:join',{code:f.code,sessionId:back.sessionId,name:'Ana'})).ok,true);
 assert.deepEqual(back.view.players.filter(p=>p.isBot).map(p=>p.id),ids);
 assert.equal((await emit(back,'room:leave')).ok,true);
 assert.equal(await f.storage.getRoom(f.code),null);
});

test('rede: estado velho cancela a ação agendada antes de consultar o cérebro',async t=>{
 let calls=0;
 const f=await setup(t,{timings:{actionMinMs:60,actionMaxMs:60},chooseAction:(...args)=>{calls++;return decideBotAction(...args);}});await f.start(1);
 const seeded=await f.seed([['letra-X','letra-Z'],['letra-S','letra-A']]);
 const changed=await f.storage.getRoom(f.code);changed.game.turnPlayerId=changed.players[0].id;changed.game.version++;
 await f.storage.saveRoom(changed);
 await new Promise(r=>setTimeout(r,100));
 assert.equal(calls,0);assert.equal((await f.storage.getRoom(f.code)).players[1].hand.length,seeded.players[1].hand.length);
});

test('rede: após limite de ações inválidas, bot usa segurança sem mudar estado por ações rejeitadas',async t=>{
 let failures=0;
 const f=await setup(t,{chooseAction:()=>{failures++;return {type:'play',cardId:'carta-inexistente'};}});await f.start(1);
 const seeded=await f.seed([['letra-X','letra-Z'],['letra-S','letra-A']]);
 await waitFor(async()=>(await f.storage.getRoom(f.code)).game.turnPlayerId===seeded.players[0].id);
 const saved=await f.storage.getRoom(f.code);
 assert.equal(failures,BOT_RULES.maxAttemptsPerTurn);assert.equal(saved.players[1].hand.length,1);
 assert.equal(saved.game.word,'CAS');
});

test('rede: restauração refaz agendamento de bots sem timers ou dicionário no JSON',async t=>{
 const storage=new MemoryStorage();let room=createRoom({code:'ABC234',playerId:'h',sessionId:randomUUID(),name:'Ana',now:Date.now()});
 room=addBot(room,'h','bot');room=startGame(room,'h',()=>.375);
 const deck=createDeck();room.players[0].hand=[deck.find(c=>c.id==='letra-Z')];room.players[1].hand=[deck.find(c=>c.id==='letra-S'),deck.find(c=>c.id==='letra-A')];
 Object.assign(room.game,{word:'CA',lastLetterPlayerId:'h',lastPlayerId:'h',letterPlayNumber:1,turnPlayerId:'bot',deck:deck.filter(c=>!['letra-Z','letra-S','letra-A'].includes(c.id))});
 await storage.saveRoom(JSON.parse(JSON.stringify(room)));
 const app=createApp({roomStorage:storage,challengeIntervalMs:5,botOptions:{dictionary,rng:()=>.99,timings:timing}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>new Promise(r=>app.io.close(r)));
 await waitFor(async()=>(await storage.getRoom('ABC234')).game.turnPlayerId==='h');
 const saved=await storage.getRoom('ABC234');assert.equal(saved.game.word,'CAS');assert.equal(saved.players[1].hand.length,1);
 assert.ok(!JSON.stringify(saved).includes('dictionary'));
});

test('rede: sorteios independentes persistem e não se repetem em broadcasts ou restauração',async t=>{
 let calls=0;
 const chooseAction=(...args)=>{calls++;return decideBotAction(...args);};
 const f=await setup(t,{chooseAction});await f.start();
 await f.seed([['letra-A','letra-B'],['wild-0','letra-Z'],['wild-1','letra-X'],['wild-2','letra-Y']],{word:'ZZZ',turnPlayerId:f.human.view.meId});
 await waitFor(async()=>Object.keys((await f.storage.getRoom(f.code)).game.botDecisions).length===3);
 assert.equal(calls,3);
 await emit(f.human,'room:join',{code:f.code,sessionId:f.human.sessionId,name:'Ana'});
 const saved=await f.storage.getRoom(f.code),restored=new MemoryStorage();
 await restored.saveRoom(JSON.parse(JSON.stringify(saved)));
 const app=createApp({roomStorage:restored,challengeIntervalMs:5,botOptions:{dictionary,rng:()=>.99,timings:timing,chooseAction}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>new Promise(r=>app.io.close(r)));
 await new Promise(r=>setTimeout(r,80));
 assert.equal(calls,3);
 assert.equal(f.human.view.game.botDecisionPlay,null);
 assert.deepEqual((await restored.getRoom(f.code)).game.botDecisions,saved.game.botDecisions);
});

test('rede: bot usa espada fora da vez pelo mesmo reducer, preservando turno e compra',async t=>{
 const f=await setup(t,{rng:()=>.1});await f.start(1);
 const seeded=await f.seed([['letra-X','letra-Z'],['sword-0','letra-S']],{
  turnPlayerId:f.human.view.meId,lastLetterPlayerId:null,drawsThisTurn:1,playNumber:7,botSwordDecisions:{},
 });
 const botId=seeded.players[1].id;
 await waitFor(async()=>{const r=await f.storage.getRoom(f.code);return r.game.lastPlayerId===botId;});
 const saved=await f.storage.getRoom(f.code);
 assert.ok(dictionary.hasPrefix(saved.game.word));assert.equal(saved.game.word.length,3);assert.equal(saved.game.turnPlayerId,f.human.view.meId);
 assert.equal(saved.game.drawsThisTurn,1);assert.equal(saved.game.playNumber,8);
 assert.equal(saved.game.botSwordDecisions[botId],7);
 assert.equal(saved.players[1].hand.length,1);assert.equal(saved.game.discard[0].type,'sword');
 assert.deepEqual(saved,JSON.parse(JSON.stringify(saved)));
});

test('rede: decisão negativa da espada não é sorteada outra vez ao reconectar ou restaurar',async t=>{
 let calls=0;
 const chooseAction=(...args)=>{calls++;return decideBotAction(...args);};
 const f=await setup(t,{chooseAction});await f.start(1);
 await f.seed([['letra-X','letra-Z'],['sword-0','letra-S']],{
  turnPlayerId:f.human.view.meId,lastLetterPlayerId:null,playNumber:11,botSwordDecisions:{},
 });
 const botId=f.human.view.players.find(p=>p.isBot).id;
 await waitFor(async()=>(await f.storage.getRoom(f.code)).game.botSwordDecisions[botId]===11);
 const baseline=calls;
 await emit(f.human,'room:join',{code:f.code,sessionId:f.human.sessionId,name:'Ana'});
 const restored=new MemoryStorage();await restored.saveRoom(JSON.parse(JSON.stringify(await f.storage.getRoom(f.code))));
 const app=createApp({roomStorage:restored,challengeIntervalMs:5,botOptions:{dictionary,rng:()=>0,timings:timing,chooseAction}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>new Promise(r=>app.io.close(r)));
 await new Promise(r=>setTimeout(r,50));
 assert.equal(calls,baseline);
 assert.equal((await restored.getRoom(f.code)).game.word,'CA');
});
