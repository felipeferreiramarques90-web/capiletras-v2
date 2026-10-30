import test from 'node:test';import assert from 'node:assert/strict';import{once}from'node:events';import{randomUUID}from'node:crypto';import{io as client}from'socket.io-client';
import{createApp}from'../server.js';import{MemoryStorage}from'../storage/memory.js';import{createDictionary}from'../bots/dictionary.js';import{createDeck}from'../game/game.js';import{CHALLENGE_RULES}from'../game/config.js';
const dictionary=createDictionary(['CASA']),emit=(s,e,d={})=>s.timeout(3000).emitWithAck(e,d);
async function wait(fn){for(let i=0;i<500;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Ação não chegou.');}
async function setup(t,provider=()=>dictionary){const storage=new MemoryStorage(),app=createApp({roomStorage:storage,dictionaryProvider:provider,challengeIntervalMs:5,botOptions:{commonDictionary:dictionary,rng:()=>.5,timings:{actionMinMs:10,actionMaxMs:10,responseMinMs:5,responseMaxMs:5}}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const sockets=[];
 t.after(async()=>{sockets.forEach(s=>s.disconnect());await new Promise(r=>app.io.close(r));});const url=`http://127.0.0.1:${app.server.address().port}`;
 async function connect(name){const s=client(url,{transports:['websocket'],forceNew:true});s.sessionId=randomUUID();s.on('room:state',v=>s.view=v);sockets.push(s);await once(s,'connect');return s;}
 const a=await connect();await emit(a,'room:create',{sessionId:a.sessionId,name:'Ana'});const code=a.view.code;
 async function seed(word,y){const r=await storage.getRoom(code);const deck=createDeck();r.players.forEach((p,i)=>p.hand=deck.splice(0,3));Object.assign(r.game,{word,lastLetterPlayerId:y,lastPlayerId:y,turnPlayerId:r.players[0].id,deck,discard:[]});await storage.saveRoom(r);await emit(a,'room:join',{code,sessionId:a.sessionId,name:'Ana'});return r;}
 return{a,code,storage,connect,seed,io:app.io};}

test('rede: padrão, só host configura; validação automática resolve sem emitir votação',async t=>{
 const f=await setup(t),b=await f.connect();assert.equal(f.a.view.settings.automaticValidation,true);await emit(b,'room:join',{code:f.code,sessionId:b.sessionId,name:'Bia'});
 assert.equal((await emit(b,'room:settings',{automaticValidation:false})).ok,false);assert.equal((await emit(f.a,'room:settings',{automaticValidation:'false'})).ok,false);
 assert.equal((await emit(f.a,'room:settings',{automaticValidation:false})).ok,true);await wait(()=>b.view.settings.automaticValidation===false);await emit(f.a,'room:deck:reset');await wait(()=>b.view.settings.automaticValidation===true);
 await emit(f.a,'game:start');const before=await f.seed('CA',f.a.view.meId);const seen=[];for(const s of [f.a,b])s.on('room:state',v=>{if(v.game?.challenge?.phase==='votando')seen.push(v);});
 assert.equal((await emit(b,'challenge:start')).ok,true);assert.equal((await emit(f.a,'challenge:confirm',{challengeId:f.a.view.game.challenge.id,letters:'SA'})).ok,true);
 const r=await f.storage.getRoom(f.code);assert.equal(r.game.challenge,null);assert.equal(r.players[1].hand.length,before.players[1].hand.length+4);await wait(()=>b.view.notice==='CASA: palavra aceita');assert.deepEqual(seen,[]);assert.ok(!/dictionary|trie|isWord/.test(JSON.stringify(r)));
});
test('rede: falha na carga cai para votação, com aviso visível e sem travar',async t=>{
 const f=await setup(t,()=>{throw Error('sem arquivo');}),b=await f.connect();await emit(b,'room:join',{code:f.code,sessionId:b.sessionId,name:'Bia'});await emit(f.a,'game:start');await f.seed('CA',f.a.view.meId);
 await emit(b,'challenge:start');await emit(f.a,'challenge:confirm',{challengeId:f.a.view.game.challenge.id,letters:'SA'});await wait(()=>b.view.game?.challenge?.phase==='votando');assert.equal(b.view.notice,CHALLENGE_RULES.validationFallbackNotice);
 await emit(b,'challenge:vote',{challengeId:b.view.game.challenge.id,vote:'sim'});assert.equal((await f.storage.getRoom(f.code)).game.challenge,null);
});
test('rede: bot desafiado confirma pelo mesmo dicionário, sem votação para humanos ou bots',async t=>{
 const f=await setup(t);await emit(f.a,'room:bot:add');await emit(f.a,'room:bot:add');await emit(f.a,'game:start');const bot=f.a.view.players.find(p=>p.isBot);await f.seed('CA',bot.id);
 const phases=[];f.a.on('room:state',v=>{if(v.game?.challenge)phases.push(v.game.challenge.phase);});await emit(f.a,'challenge:start');
 await wait(async()=>Boolean((await f.storage.getRoom(f.code)).game.challengeResult));const r=await f.storage.getRoom(f.code);assert.equal(r.game.challengeResult.reason,'aceita');assert.equal(phases.includes('votando'),false);
});
