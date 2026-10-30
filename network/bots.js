import { roomView, GameError } from '../game/game.js';
import { BOT_RULES } from '../bots/config.js';
import { botTask, decideBotAction } from '../bots/brain.js';
import { applyBotAction } from '../bots/actions.js';

// Escolha pura do atraso, com RNG e relógio injetáveis para os testes.
export function botDelayMs(task, game, rng, timing = BOT_RULES, now = 0) {
  const response = task.kind === 'vote' || task.kind === 'accept';
  const finalDoubt = task.kind === 'doubt' && Boolean(game.pendingVictory);
  const min = response ? timing.responseMinMs : finalDoubt ? timing.finalDoubtMinMs : timing.actionMinMs;
  const max = response ? timing.responseMaxMs : finalDoubt ? timing.finalDoubtMaxMs : timing.actionMaxMs;
  const delay = min + Math.floor(rng() * (max - min + 1));
  const deadline = task.kind === 'complete' ? game.challenge?.completionDeadline
    : task.kind === 'vote' ? game.challenge?.voteDeadline : (finalDoubt || task.kind === 'accept') ? game.pendingVictory?.deadline : null;
  return deadline ? Math.max(0, Math.min(delay, deadline - now - timing.deadlineMarginMs)) : delay;
}

// Timers e tentativas ficam só na camada de execução. Cada sala usa a mesma fila
// de leitura/validação/salvamento que as ações humanas; nunca há duas escritas paralelas.
export function createBotScheduler({ storage, locked, settle, save, dictionary, commonDictionary = dictionary, validateWord, rng, nowSource,
  timings = {}, chooseAction = decideBotAction }) {
  const timers = new Map(), attempts = new Map();
  const timing = { ...BOT_RULES, ...timings };
  let stopped = false;
  const keyFor = (code, id) => `${code}:${id}`;
  const humanOnline = (room) => room.players.some((p) => !p.isBot && !p.left && p.connected);
  function forget(code) {
    for (const [key, item] of timers) if (item.code === code) { clearTimeout(item.timer); timers.delete(key); }
    for (const key of attempts.keys()) if (key.startsWith(`${code}:`)) attempts.delete(key);
  }
  function schedule(room) {
    if (stopped) return;
    if (room.phase !== 'playing' || !humanOnline(room)) { forget(room.code); return; }
    const wanted = new Set();
    for (const bot of room.players.filter((p) => p.isBot && !p.left)) {
      const view = roomView(room, bot.id), task = botTask(view, dictionary);
      const key = keyFor(room.code, bot.id);
      if (!task) continue;
      wanted.add(key);
      const existing = timers.get(key);
      if (existing?.version === room.game.version && existing.task === task.key) continue;
      if (existing) clearTimeout(existing.timer);
      const item = { code: room.code, version: room.game.version, task: task.key };
      item.timer = setTimeout(() => {
        if (timers.get(key) !== item || stopped) return;
        timers.delete(key);
        void locked(room.code, async () => {
          let current = await storage.getRoom(room.code);
          if (!current || current.phase !== 'playing' || !humanOnline(current)) return;
          const resolved = settle(current);
          if (resolved !== current) { await save(resolved); current = resolved; }
          if (current.phase !== 'playing' || !current.players.some((p) => p.id === bot.id && p.isBot && !p.left)) return;
          const currentView = roomView(current, bot.id), currentTask = botTask(currentView, dictionary);
          if (current.game.version !== item.version || currentTask?.key !== item.task) { schedule(current); return; }
          const previous = attempts.get(key);
          const failures = previous?.turn === current.game.turnNumber ? previous.count : 0;
          const safety = failures >= BOT_RULES.maxAttemptsPerTurn;
          // No modo de segurança, usamos o cérebro padrão, mesmo se um adaptador falhou.
          try {
            const action = (safety ? decideBotAction : chooseAction)(currentView, dictionary, rng, { safety, commonDictionary });
            if (!action) throw new GameError('O bot não escolheu uma ação disponível.');
            const next = applyBotAction(current, bot.id, action, { version: item.version, now: nowSource(), rng, validateWord });
            await save(settle(next));
          } catch (error) {
            if (!(error instanceof GameError)) console.error('Falha no cérebro; bot tentará a ação de segurança:', error);
            attempts.set(key, { turn: current.game.turnNumber, count: failures + 1 });
            schedule(current);
          }
        }).catch((error) => console.error('Falha ao executar bot:', error));
      }, botDelayMs(task, room.game, rng, timing, nowSource()));
      item.timer.unref();
      timers.set(key, item);
    }
    for (const [key, item] of timers) if (item.code === room.code && !wanted.has(key)) { clearTimeout(item.timer); timers.delete(key); }
  }
  return { schedule, forget, stop() { stopped = true; for (const item of timers.values()) clearTimeout(item.timer); timers.clear(); attempts.clear(); } };
}
