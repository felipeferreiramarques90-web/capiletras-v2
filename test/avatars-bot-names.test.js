import test from 'node:test';
import assert from 'node:assert/strict';
import { initials, avatarColor, createAvatarPalette, botNumber } from '../public/avatars.js';
import { createRoom } from '../game/game.js';
import { addBot, removeBot } from '../bots/players.js';

test('Bot N usa menor número livre, inclusive após remoção e em sala antiga', () => {
 let r=createRoom({code:'ABC234',playerId:'h',sessionId:'s',name:'Ana',now:0});
 r=addBot(addBot(addBot(r,'h','b1'),'h','b2'),'h','b3');
 assert.deepEqual(r.players.slice(1).map(p=>p.name),['Bot 1','Bot 2','Bot 3']);
 r=addBot(removeBot(r,'h','b2'),'h','b4'); assert.equal(r.players.at(-1).name,'Bot 2');
 r.players[1].name='Bot Capivara'; r=addBot(r,'h','b5'); assert.equal(r.players.at(-1).name,'Bot 1');
 assert.equal(new Set(r.players.map(p=>p.name)).size,r.players.length);
 assert.deepEqual(JSON.parse(JSON.stringify(r)),r);
});

test('oito pastéis sem colisões, estáveis após mudanças de ordem e reconexão',()=>{
 const palette=createAvatarPalette(), ids=Array.from({length:8},(_,i)=>`player-${i*8}`);
 palette.sync(ids);const before=ids.map(palette);
 assert.equal(new Set(before).size,8);assert.ok(before.every(c=>/^var\(--avatar-pastel-[0-7]\)$/.test(c)));
 palette.sync([...ids].reverse());assert.deepEqual(ids.map(palette),before);
 const restored=createAvatarPalette(palette.snapshot());restored.sync(ids);assert.deepEqual(ids.map(restored),before);
 for(let i=0;i<20;i++){ids[7]=`new-${i}`;palette.sync(ids);assert.equal(new Set(ids.map(palette)).size,8);}
 assert.equal(botNumber('Bot 1'),'1');assert.equal(botNumber('Bot 12'),'12');assert.equal(botNumber('Bot Capivara'),'');
});
test('nome humano que já usa Bot N também reserva o número',()=>{
 const r=addBot(createRoom({code:'ABC234',playerId:'h',sessionId:'s',name:'Bot 1',now:0}),'h','b');
 assert.equal(r.players[1].name,'Bot 2');
});
test('iniciais e cor são estáveis por identidade, sem depender da posição ou tamanho do nome',()=>{
 assert.equal(initials('  ana de souza '),'AS'); assert.equal(initials('João'),'J'); assert.equal(initials('éva çosta'),'ÉÇ');
 assert.equal(avatarColor('p1'),avatarColor('p1')); assert.notEqual(avatarColor('p1'),avatarColor('p2'));
 assert.equal(new Set(Array.from({length:8},(_,i)=>avatarColor(`p${i}`))).size,8);
});
