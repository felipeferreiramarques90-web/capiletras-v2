import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, updateSettings, startGame, drawCard, roomView, restoreDefaultComposition, returnToLobby, skipTurn } from '../game/game.js';
import { addBot } from '../bots/players.js';
import { DRAW_RULES } from '../game/config.js';
import { drawIncreases, animateDraws, DRAW_UI } from '../public/draw-animation.js';
const rng=()=>.375;
const lobby=()=>joinRoom(createRoom({code:'ABC234',playerId:'a',sessionId:'a',name:'Ana',now:0}),{playerId:'b',sessionId:'b',name:'Bia'});
test('compras: padrão, inteiros 1..4, host, lobby, reset e persistência na revanche',()=>{
  let room=lobby();assert.equal(room.settings.maxDrawsPerTurn,DRAW_RULES.default);
  for(const value of [0,5,1.5,'2',undefined,null]) {
    const old=structuredClone(room);assert.throws(()=>updateSettings(room,'a',{maxDrawsPerTurn:value}),/1 a 4/);assert.deepEqual(room,old);
  }
  assert.throws(()=>updateSettings(room,'b',{maxDrawsPerTurn:2}),/anfitrião/);
  room=updateSettings(room,'a',{maxDrawsPerTurn:4});
  assert.equal(roomView(room,'b').settings.maxDrawsPerTurn,4);
  assert.equal(restoreDefaultComposition(room,'a').settings.maxDrawsPerTurn,1);
  room=startGame(room,'a',rng);assert.throws(()=>updateSettings(room,'a',{maxDrawsPerTurn:2}),/começou/);
  room.phase='finished';room=returnToLobby(room,'a');assert.equal(room.settings.maxDrawsPerTurn,4);
  assert.deepEqual(JSON.parse(JSON.stringify(room)),room);
});
for(const limit of [1,2,3,4]) test(`compra respeita limite ${limit} e mantém a vez`,()=>{
  let room=startGame(updateSettings(lobby(),'a',{maxDrawsPerTurn:limit}),'a',rng);
  assert.throws(()=>drawCard(room,'b',rng),/vez/);
  for(let n=1;n<=limit;n++){room=drawCard(room,'a',rng);assert.equal(room.game.drawsThisTurn,n);assert.equal(roomView(room,'a').game.drawsRemaining,limit-n);}
  const old=structuredClone(room);assert.throws(()=>drawCard(room,'a',rng),/comprou/);assert.deepEqual(room,old);
});
test('Não consigo jogar exige só uma compra mesmo com limite 4; bots continuam limitados a 1',()=>{
  let room=startGame(updateSettings(lobby(),'a',{maxDrawsPerTurn:4}),'a',rng);
  room.game.word='';room.players[0].hand=[{id:'swap-test',type:'swap'}];
  room.game.deck=[{id:'swap-draw',type:'swap'}];room.game.discard=[];
  room=drawCard(room,'a',rng);assert.equal(roomView(room,'a').game.canSkipTurn,true);
  room=skipTurn(room,'a',rng);assert.equal(room.game.turnPlayerId,'b');assert.equal(room.game.drawsThisTurn,0);
  let bots=createRoom({code:'ABC234',playerId:'a',sessionId:'a',name:'Ana',now:0});
  bots=addBot(bots,'a','bot');bots=startGame(updateSettings(bots,'a',{maxDrawsPerTurn:4}),'a',rng);
  bots.game.turnPlayerId='bot';bots=drawCard(bots,'bot',rng);
  assert.equal(roomView(bots,'bot').game.canDraw,false);assert.throws(()=>drawCard(bots,'bot',rng),/comprou/);
});
test('animação detecta compras próprias e penalidades, ignora distribuição e reduced-motion',()=>{
  const old={code:'ABC',phase:'playing',players:[{id:'a',cardCount:2},{id:'b',cardCount:3}]};
  const next={...old,game:{},players:[{id:'a',cardCount:3},{id:'b',cardCount:7}]};
  assert.deepEqual(drawIncreases(old,next),[{playerId:'a',count:1},{playerId:'b',count:4}]);
  assert.deepEqual(drawIncreases({...old,phase:'lobby'},next),[]);
  animateDraws(old,next,{reduced:true,document:{get hidden(){throw Error('não acessa DOM');}}});
  assert.equal(DRAW_UI.durationMs,500);assert.equal(DRAW_UI.staggerMs,120);
});

test('penalidade de 4 cartas anima em sequência de 120ms sem bloquear eventos',()=>{
  const calls=[],nodes=[],rect={x:0,y:0,width:40,height:50};
  const document={hidden:false,querySelector:selector=>selector==='.draw-pile .deck-back'?{getBoundingClientRect:()=>rect}:selector==='.hand-cards'?{getBoundingClientRect:()=>({...rect,y:300})}:nodes[0],
    querySelectorAll:()=>nodes,body:{append:n=>nodes.push(n)},createElement:()=>({style:{},setAttribute(){},remove(){},animate(frames,options){calls.push({frames,options});return{finished:Promise.resolve()};}})};
  const old={code:'ABC',phase:'playing',players:[{id:'a',cardCount:2}]};
  animateDraws(old,{...old,game:{},meId:'a',players:[{id:'a',cardCount:6}]},{document,reduced:false});
  assert.deepEqual(calls.map(c=>c.options.delay),[0,120,240,360]);assert.ok(calls.every(c=>c.options.duration===500));
});
