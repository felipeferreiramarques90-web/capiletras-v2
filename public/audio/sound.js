import { AUDIO } from './config.js';
const safeStorage = () => { try { return globalThis.localStorage; } catch { return null; } };

// Síntese original local. O único contexto nasce após um gesto; nada vai ao servidor.
export function createSound({ AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext,
  storage = safeStorage(), clock = () => Date.now(),
  repeat = (fn, ms) => setInterval(fn, ms), cancelRepeat = clearInterval } = {}) {
  let prefs = { muted: false, volume: AUDIO.master };
  try { const saved = JSON.parse(storage?.getItem(AUDIO.storageKey));
    if (saved) prefs = { muted: saved.muted === true, volume: Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : AUDIO.master };
  } catch { /* Preferências opcionais. */ }
  let ctx, master, noiseBuffer, mood = null, music = null, timer, hidden = false, view = null;
  let previous = null, pendingWhistle = false;
  const effects = new Set();
  const save = () => { try { storage?.setItem(AUDIO.storageKey, JSON.stringify(prefs)); } catch {} };
  const ready = () => ctx && !hidden && !prefs.muted && ctx.state === 'running';
  const ramp = (param, value, seconds = AUDIO.fadeSeconds) => {
    param.cancelScheduledValues(ctx.currentTime); param.setValueAtTime(param.value, ctx.currentTime);
    param.linearRampToValueAtTime(value, ctx.currentTime + seconds);
  };
  function noise() {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * AUDIO.noiseSeconds), ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      // Costura suave do ruído cíclico, sem ataque perceptível na repetição.
      for (let i = 0; i < AUDIO.seamSamples; i++) { const mix = i / (AUDIO.seamSamples - 1);
        data[data.length - AUDIO.seamSamples + i] = data[data.length - AUDIO.seamSamples + i] * (1 - mix) + data[0] * mix;
      }
    }
    const node = ctx.createBufferSource(); node.buffer = noiseBuffer; return node;
  }
  function effect(kind, scale = 1) {
    if (!ready()) return;
    try {
      const duration = ({ whistle: AUDIO.whistleSeconds, card: AUDIO.cardSeconds, draw: AUDIO.drawSeconds,
        open: AUDIO.modalSeconds, close: AUDIO.modalSeconds, click: AUDIO.clickSeconds })[kind];
      const gain = ctx.createGain(), filter = ctx.createBiquadFilter();
      const noisy = ['whistle','card','draw'].includes(kind), source = noisy ? noise() : ctx.createOscillator();
      filter.type = noisy ? 'bandpass' : 'lowpass';
      filter.frequency.value = ({ whistle: 2600, card: 600, draw: 1800 })[kind] || 1200;
      filter.Q.value = kind === 'whistle' ? 22 : .7;
      if (!noisy) { source.type = 'sine'; source.frequency.setValueAtTime(kind === 'click' ? 600 : kind === 'open' ? 350 : 500, ctx.currentTime);
        source.frequency.linearRampToValueAtTime(kind === 'open' ? 650 : 200, ctx.currentTime + duration); }
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(AUDIO.effect * scale, ctx.currentTime + AUDIO.attackSeconds);
      gain.gain.exponentialRampToValueAtTime(AUDIO.floor, ctx.currentTime + duration);
      source.connect(filter); filter.connect(gain); gain.connect(master);
      effects.add(source); source.onended = () => { effects.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start(); source.stop(ctx.currentTime + duration);
    } catch { /* Navegadores sem síntese não interrompem a partida. */ }
  }
  function stopMusic() {
    if (timer) cancelRepeat(timer); timer = null;
    if (!music || !ctx) return;
    const old = music; music = null;
    ramp(old.gain.gain, 0);
    for (const source of old.sources) { try { source.stop(ctx.currentTime + AUDIO.fadeSeconds); } catch {} }
    old.sources[0].onended = () => old.nodes.forEach((node) => { try { node.disconnect(); } catch {} });
  }
  function syncMusic() {
    if (!ready() || !mood) { stopMusic(); return; }
    if (music?.mood === mood) return;
    stopMusic();
    try {
      const gain = ctx.createGain(), sources = [], nodes = [gain]; gain.gain.value = 0; gain.connect(master);
      const add = (source, filter) => { source.connect(filter); filter.connect(gain); sources.push(source); nodes.push(source, filter); source.start(); };
      if (mood === 'ambient') {
        const crowd = noise(), filter = ctx.createBiquadFilter(); crowd.loop = true;
        filter.type = 'lowpass'; filter.frequency.value = 500; add(crowd, filter);
        const pad = ctx.createOscillator(), padGain = ctx.createGain(); pad.frequency.value = 65; padGain.gain.value = AUDIO.padLevel; add(pad, padGain);
        const wave = ctx.createOscillator(), depth = ctx.createGain(); wave.frequency.value = AUDIO.ambientWaveHz; depth.gain.value = AUDIO.ambient * AUDIO.waveDepth;
        wave.connect(depth); depth.connect(gain.gain); wave.start(); sources.push(wave); nodes.push(wave, depth);
      } else {
        for (const frequency of [55, 58.3]) { const note = ctx.createOscillator(), level = ctx.createGain();
          note.type = 'sine'; note.frequency.value = frequency; level.gain.value = AUDIO.tensionNoteLevel; add(note, level); }
      }
      music = { mood, gain, sources, nodes }; ramp(gain.gain, mood === 'ambient' ? AUDIO.ambient : AUDIO.tension);
      if (mood === 'tension') {
        const pulse = () => {
          if (!ready() || music?.mood !== 'tension') return;
          const ch = view?.game?.challenge;
          const deadline = ch?.phase === 'votando' ? ch.voteDeadline : ch?.completionDeadline;
          const urgent = deadline && deadline - clock() <= AUDIO.urgentSeconds * 1000;
          const time = ctx.currentTime, step = urgent ? AUDIO.urgentPulseSeconds : AUDIO.pulseSeconds;
          music.sources.forEach((note, i) => note.frequency?.setTargetAtTime((urgent ? 76 : 60) + i * 3.3, time, AUDIO.riseSeconds));
          gain.gain.cancelScheduledValues(time); gain.gain.setValueAtTime(AUDIO.tension * (urgent ? AUDIO.urgentGain : 1), time);
          gain.gain.exponentialRampToValueAtTime(AUDIO.tension * AUDIO.pulseFloor, time + step * AUDIO.pulseDecay);
        };
        pulse(); timer = repeat(pulse, AUDIO.tickMs);
      }
    } catch { stopMusic(); }
  }
  function whistleIfNeeded() {
    if (pendingWhistle && ready() && view?.phase === 'playing' && view.game.turnPlayerId === view.meId) {
      effect('whistle'); pendingWhistle = false;
    }
  }
  async function gesture() {
    try {
      if (!ctx && AudioContext) { ctx = new AudioContext(); master = ctx.createGain(); master.connect(ctx.destination); master.gain.value = prefs.muted ? 0 : prefs.volume; }
      if (ctx?.state === 'suspended' && !hidden) await ctx.resume();
      syncMusic(); whistleIfNeeded();
    } catch { /* Áudio indisponível: jogo continua. */ }
  }
  function update(next) {
    const old = previous, game = next?.game;
    view = next;
    const playing = next?.phase === 'playing';
    const cards = next?.players?.reduce((sum, player) => sum + (player.cardCount || 0), 0) || 0;
    if (!playing || game.turnPlayerId !== next.meId) pendingWhistle = false;
    else if (!old || old.code !== next.code || old.phase !== 'playing' || old.turn !== game.turnPlayerId) pendingWhistle = true;
    if (old && next && old.code === next.code && old.phase === 'playing' && playing) {
      if (game.playNumber > old.play) effect('card', game.lastPlayerId === next.meId ? 1 : AUDIO.remoteCard);
      else if (cards > old.cards || (game.turnNumber === old.turnNumber && game.drawsThisTurn > old.draws)) effect('draw');
    }
    previous = next ? { code: next.code, phase: next.phase, turn: game?.turnPlayerId, play: game?.playNumber,
      turnNumber: game?.turnNumber, draws: game?.drawsThisTurn, cards } : null;
    const wanted = playing ? game.challenge ? 'tension' : 'ambient' : null;
    if (wanted !== mood) { mood = wanted; syncMusic(); }
    whistleIfNeeded();
  }
  function setMuted(value) { prefs.muted = Boolean(value); save(); if (ctx) ramp(master.gain, prefs.muted ? 0 : prefs.volume); syncMusic(); }
  function setVolume(value) { if (!Number.isFinite(Number(value))) return; prefs.volume = Math.max(0,Math.min(1,Number(value))); save(); if (ctx) ramp(master.gain,prefs.muted ? 0 : prefs.volume); }
  async function visibility(value) {
    hidden = value;
    try { if (hidden) { stopMusic(); for (const node of effects) { try { node.stop(); } catch {} } await ctx?.suspend(); }
      else { if (ctx) await ctx.resume(); syncMusic(); whistleIfNeeded(); } } catch {}
  }
  return { gesture, update, effect, setMuted, setVolume, visibility,
    preferences: () => ({ ...prefs }), status: () => ({ started: Boolean(ctx), mood, hidden }),
    dispose() { stopMusic(); void ctx?.close()?.catch(() => {}); } };
}
