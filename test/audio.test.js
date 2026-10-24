import test from 'node:test';
import assert from 'node:assert/strict';
import { createSound } from '../public/audio/sound.js';
import { AUDIO } from '../public/audio/config.js';

function fixture(saved) {
 const map=new Map(saved ? [[AUDIO.storageKey,JSON.stringify(saved)]] : []), contexts=[];
 const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 class Context {
  constructor(){this.state='running';this.currentTime=0;this.sampleRate=1000;this.destination={};this.filters=[];this.sources=[];contexts.push(this);}
  param(){return {value:0,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){}};}
  node(){return {gain:this.param(),frequency:this.param(),Q:this.param(),connect(){},disconnect(){},start(){},stop(){}};}
  createGain(){return this.node();}
  createOscillator(){const n=this.node();this.sources.push(n);return n;}
  createBufferSource(){return this.createOscillator();}
  createBiquadFilter(){const n=this.node();this.filters.push(n);return n;}
  createBuffer(c,n){return {getChannelData:()=>new Float32Array(n)};}
  async resume(){this.state='running';} async suspend(){this.state='suspended';} async close(){this.state='closed';}
 }
 const sound=createSound({AudioContext:Context,storage,repeat:()=>1,cancelRepeat(){},clock:()=>1000});
 const whistles=()=>contexts.flatMap(c=>c.filters).filter(n=>n.frequency.value===2600).length;
 return {sound,contexts,storage,whistles};
}
const state=(turn='h',extra={})=>({code:'ABC234',phase:'playing',meId:'h',game:{turnPlayerId:turn,playNumber:0,turnNumber:1,drawsThisTurn:0,...extra}});
test('áudio só inicia após gesto, usa um contexto, persiste mute/volume e retoma suspensão',async()=>{
 const f=fixture(); f.sound.update(state()); assert.equal(f.contexts.length,0);
 await f.sound.gesture(); await f.sound.gesture(); assert.equal(f.contexts.length,1); assert.equal(f.whistles(),1);
 f.sound.setMuted(true); f.sound.setVolume(.24);
 const again=createSound({AudioContext:null,storage:f.storage}); assert.deepEqual(again.preferences(),{muted:true,volume:.24});
 f.contexts[0].state='suspended'; await f.sound.gesture();assert.equal(f.contexts[0].state,'running');
 f.sound.dispose();
});
test('ambiente → tensão → ambiente; vitória pendente mantém ambiente e fim para música',async()=>{
 const f=fixture();await f.sound.gesture();f.sound.update(state());assert.equal(f.sound.status().mood,'ambient');
 f.sound.update(state('h',{challenge:{phase:'completando',completionDeadline:31000}}));assert.equal(f.sound.status().mood,'tension');
 f.sound.update(state('h',{pendingVictory:{}}));assert.equal(f.sound.status().mood,'ambient');
 f.sound.update({...state(),phase:'finished'});assert.equal(f.sound.status().mood,null);f.sound.dispose();
});
test('apito somente ao local, sem repetição em compras, modais ou atualizações da mesma vez',async()=>{
 const f=fixture();await f.sound.gesture();f.sound.update(state('b'));assert.equal(f.whistles(),0);
 f.sound.update(state());assert.equal(f.whistles(),1);
 f.sound.update(state('h',{drawsThisTurn:1}));f.sound.update(state('h',{challenge:{}}));assert.equal(f.whistles(),1);
 f.sound.update(state('b'));f.sound.update(state('h',{turnNumber:4}));assert.equal(f.whistles(),2);f.sound.dispose();
});
test('segundo plano suspende tudo e apita ao voltar apenas se ainda for a vez local',async()=>{
 const f=fixture();await f.sound.gesture();f.sound.update(state('b'));await f.sound.visibility(true);
 assert.equal(f.contexts[0].state,'suspended');f.sound.update(state());assert.equal(f.whistles(),0);
 await f.sound.visibility(false);assert.equal(f.whistles(),1);
 f.sound.update(state('b'));await f.sound.visibility(true);f.sound.update(state());f.sound.update(state('b'));
 await f.sound.visibility(false);assert.equal(f.whistles(),1);f.sound.dispose();
});
test('sem AudioContext ou storage, áudio falha silenciosamente',async()=>{
 const sound=createSound({AudioContext:null,storage:null});sound.update(null);sound.update(null);await sound.gesture();sound.update(state());sound.effect('click');
 sound.setVolume(.3);sound.setMuted(true);await sound.visibility(true);await sound.visibility(false);sound.dispose();assert.equal(sound.status().started,false);
});
