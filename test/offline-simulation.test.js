import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, updateSettings, startGame, roomView, disconnectPlayer, joinRoom, createDeck, drawCard, playCard, skipTurn } from '../game/game.js';
import { settleRoom } from '../game/settle.js';
import { addBot } from '../bots/players.js';
import { decideBotAction, chooseTurnAction } from '../bots/brain.js';
import { applyBotAction } from '../bots/actions.js';
import { confirmChallenge, loseChallenge } from '../game/challenge.js';
import { acceptVictory } from '../game/victory.js';
import { createDictionary } from '../bots/dictionary.js';
const dictionary=createDictionary(['CASA','CASAS','CANTO','CANTAMOS','BOLA','BOLAS','CAPIVARA','JOGAR']);
for(const seed of [3,29,99])test(`simulação longa com humanos reconectando e bots termina (semente ${seed})`,()=>{
  let state=seed,now=0,disconnects=0,automatics=0;
  const rng=()=>((state=(1664525*state+1013904223)>>>0)/2**32);
  let room=createRoom({code:'ABC234',playerId:'h',sessionId:'session',name:'Ana',now});
  room=addBot(addBot(addBot(room,'h','b1'),'h','b2'),'h','b3');
  room=updateSettings(room,'h',{maxDrawsPerTurn:4});room=startGame(room,'h',rng);
  for(let step=0;step<15000 && room.phase==='playing';step++) {
    now+=1000;
    if(room.players[0].connected && (step===0 || rng()<.04)) {room=disconnectPlayer(room,'h',now);disconnects++;}
    else if(!room.players[0].connected && rng()<.012)room=joinRoom(room,{playerId:'new',sessionId:'session',name:'Ana'});
    room=settleRoom(room,now,rng);
    if(room.notice.includes('desconectado: jogada automática'))automatics++;
    if(room.phase!=='playing')break;
    const ch=room.game.challenge;
    if(ch?.challengedId==='h') {
      const [letters]=dictionary.allContinuations(ch.baseWord,{minLetters:0,maxLetters:16});
      room=letters===undefined?loseChallenge(room,'h',ch.id,now,rng):confirmChallenge(room,'h',ch.id,letters,now,rng,w=>dictionary.isWord(w));
    } else if(!ch && room.game.pendingVictory?.voterIds.includes('h') && room.players[0].connected && !room.game.pendingVictory.acceptedIds.includes('h'))room=acceptVictory(room,'h',room.game.pendingVictory.id,now);
    else if(!ch && !room.game.pendingVictory && room.game.turnPlayerId==='h' && room.players[0].connected) {
      const action=chooseTurnAction(roomView(room,'h'),dictionary,{rng});
      if(action?.type==='draw')room=drawCard(room,'h',rng);
      else if(action?.type==='play')room=playCard(room,'h',action.cardId,action.letter,action.blockedLetter,action.accumulatedLetters,room.game.version,now);
      else if(action?.type==='skip')room=skipTurn(room,'h',rng);

    }
    for(const id of ['b1','b2','b3']) {
      if(room.phase!=='playing')break;
      const action=decideBotAction(roomView(room,id),dictionary,rng);
      if(action)room=applyBotAction(room,id,action,{version:room.game.version,now,rng,validateWord:w=>dictionary.isWord(w)});
    }
    room=settleRoom(room,now,rng);
    assert.equal(room.game.deck.length+room.game.discard.length+room.players.reduce((n,p)=>n+p.hand.length,0),createDeck().length);
    assert.deepEqual(JSON.parse(JSON.stringify(room)),room);
  }
  assert.equal(room.phase,'finished');assert.ok(disconnects>0);assert.ok(automatics>0);
});
