import { ALPHABET, CARD_TYPES, OFFLINE_RULES } from './config.js';
import { drawCard, drawLimit, playCard, skipTurn, isCardPlayable, playableLetters, debtForPlayer } from './game.js';

// Relógio e RNG são argumentos; só dados JSON atravessam o armazenamento.
export function syncOfflineTurn(original, now) {
  const game = original.game;
  if (!game) return original;
  const player = original.players.find(p => p.id === game.turnPlayerId && !p.left);
  if (original.phase !== 'playing' || !player || player.connected || player.isBot) {
    if (!game.offlineTurn) return original;
    const room=structuredClone(original);room.game.offlineTurn=null;room.game.version++;return room;
  }
  const suspended=Boolean(game.challenge || game.pendingVictory), old=game.offlineTurn;
  let timer=old;
  if (!old || old.playerId !== player.id || old.turnNumber !== game.turnNumber) {
    timer={playerId:player.id,turnNumber:game.turnNumber,phase:'waiting',deadline:now+OFFLINE_RULES.reconnectMs,remainingMs:null};
  }
  if (suspended && timer.deadline !== null) timer={...timer,remainingMs:Math.max(0,timer.deadline-now),deadline:null};
  else if (!suspended && timer.deadline === null) timer={...timer,deadline:now+timer.remainingMs,remainingMs:null};
  if (timer===old) return original;
  const room=structuredClone(original);room.game.offlineTurn=timer;room.game.version++;return room;
}
const pick=(items,rng)=>items[Math.floor(rng()*items.length)];

// Escolha uniforme entre as mesmas cartas jogáveis de humanos/bots. Não consulta léxico.
export function randomOfflinePlay(room, rng) {
  const game=room.game, id=game.turnPlayerId, player=room.players.find(p=>p.id===id);
  const cards=player.hand.filter(card=>isCardPlayable(card,game,id,player.hand.length));
  if (!cards.length) return null;
  const card=pick(cards,rng), rule=CARD_TYPES[card.type];
  if (['pass','replay'].includes(rule.effect)) return {cardId:card.id,letter:'',accumulatedLetters:''};
  const owed=debtForPlayer(game,id);
  const accumulatedLetters=Array.from({length:owed},(_,i)=>pick([...ALPHABET].filter(l=>i>0 || l!==game.blockedLetter),rng)).join('');
  const paid=owed ? {...game,word:game.word+accumulatedLetters,blockedLetter:null,letterDebt:{count:0,playerId:null}} : game;
  const allowed=[...playableLetters(card,paid,id)];
  let letter=pick(allowed,rng);
  if (rule.effect==='appendMany') {
    const length=rule.minLetters+Math.floor(rng()*(rule.maxLetters-rule.minLetters+1));
    letter+=Array.from({length:length-1},()=>pick([...ALPHABET],rng)).join('');
  }
  return {cardId:card.id,letter,accumulatedLetters,blockedLetter:rule.effect==='block'?pick([...ALPHABET],rng):undefined};
}

export function resolveOfflineTurn(original, now, rng) {
  let room=syncOfflineTurn(original,now);
  const timer=room.game?.offlineTurn;
  if (!timer || timer.deadline===null || now<timer.deadline) return room;
  const id=timer.playerId, player=room.players.find(p=>p.id===id);
  if (room.game.drawsThisTurn<drawLimit(room,id)
    && room.game.deck.length+room.game.discard.length>0) {
    room=drawCard(room,id,rng,{offline:true});
    room.game.offlineTurn={...timer,phase:'between',deadline:now+OFFLINE_RULES.stepMs};
    room.notice=`${player.name} desconectado: comprou uma carta automaticamente`;
    return room;
  }
  // Sem pilha, dá os mesmos 5s finais antes de jogar/passar; sem inventar uma compra.
  if (timer.phase==='waiting' && room.game.drawsThisTurn<drawLimit(room,id)) {
    room=structuredClone(room);room.game.offlineTurn={...timer,phase:'acting',deadline:now+OFFLINE_RULES.stepMs};room.game.version++;return room;
  }
  const action=randomOfflinePlay(room,rng);
  const next=action ? playCard(room,id,action.cardId,action.letter,action.blockedLetter,action.accumulatedLetters,room.game.version,now,{offline:true})
    : skipTurn(room,id,rng,room.game.version,{offline:true});
  next.notice=`${player.name} desconectado: jogada automática. ${next.notice}`;
  return syncOfflineTurn(next,now);
}
