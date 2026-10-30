import { protectChallengeField, CHALLENGE_UI } from './challenge-field.js';
import { initials, createAvatarPalette, botNumber, AVATAR_UI } from './avatars.js';
import { createSound } from './audio/sound.js';
/* O cliente apresenta a mesa e envia intenções. Todas as regras são validadas pelo servidor. */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const app = $('#app');
  const avatarPalettes = new Map();
  let colorFor = createAvatarPalette();
  const sound = createSound({ clock: () => Date.now() + serverClockOffset });
  const soundToggle = $('#sound-toggle'), soundVolume = $('#sound-volume');
  function soundControls() { const prefs = sound.preferences(); soundToggle.textContent = prefs.muted ? '🔇' : '🔊'; soundToggle.setAttribute('aria-label', prefs.muted ? 'Ativar som' : 'Silenciar som'); soundToggle.setAttribute('aria-pressed', String(prefs.muted)); soundVolume.value = prefs.volume; }
  soundControls();
  document.addEventListener('pointerdown', () => { void sound.gesture(); }, { capture: true });
  document.addEventListener('keydown', () => { void sound.gesture(); }, { capture: true });
  document.addEventListener('click', (event) => { if (event.target.closest('button')) sound.effect('click'); }, { capture: true });
  soundToggle.addEventListener('click', () => { sound.setMuted(!sound.preferences().muted); soundControls(); });
  soundVolume.addEventListener('input', () => sound.setVolume(Number(soundVolume.value)));
  document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.sound-controls')) $('.sound-controls details').open = false; });
  document.addEventListener('visibilitychange', () => { void sound.visibility(document.hidden); });
  const modalStates = new Map();
  new MutationObserver(() => { for (const dialog of document.querySelectorAll('dialog')) { const open = dialog.open; if (open !== (modalStates.get(dialog) || false)) sound.effect(open ? 'open' : 'close'); modalStates.set(dialog, open); } }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  const storage = {
    get(key) { try { return localStorage.getItem(`capiletras:${key}`); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(`capiletras:${key}`, value); } catch { /* Sessão atual continua funcionando. */ } },
    remove(key) { try { localStorage.removeItem(`capiletras:${key}`); } catch { /* Sem armazenamento local. */ } },
  };
  const sessionId = storage.get('player') || (crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, '0')).join(''));
  storage.set('player', sessionId);
  let name = storage.get('name') || '';
  let enteredCode = new URLSearchParams(location.search).get('sala')?.toUpperCase().slice(0, 6) || '';
  let room = null;
  let busy = false;
  let replacing = false;
  let selectedCard = null;
  let selectedLetter = null;
  let selectedBlock = null;
  let blockStep = 1;
  let pendingDebtLetters = '';
  let selectedPlayVersion = null;
  let challengeDialogId = null;
  let challengeHistoryGuard = null;
  let challengePreviewTimer;
  let serverClockOffset = 0;
  let deckInfo = null;
  let deckDraft = null;
  let deckExpanded = false;
  let lastAdjustment = null;
  let toastTimer;
  let noticeQueue = [], activeNotice = null, noticeTimer;
  const socket = io({ reconnection: true, reconnectionDelay: 800, reconnectionDelayMax: 5000 });
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const disabled = (condition) => condition ? 'disabled' : '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // Quantidades, rótulos e possibilidades vêm do servidor. A UI não decide jogadas.
  fetch('/api/config').then((response) => { if (!response.ok) throw new Error(); return response.json(); })
    .then((config) => { deckInfo = config; updateDeckSummary(); render(); })
    .catch(() => { /* A configuração também chega ao entrar em uma sala. */ });
  function updateDeckSummary() {
    if (deckInfo) $('#deck-summary').textContent = `${room?.deckSize ?? deckInfo.deckSize} cartas. Infinitas possibilidades.`;
  }
  const canAct = () => socket.connected && !busy;
  const isHost = () => room?.meId === room?.hostId;
  const playerName = (player) => `${player?.isBot ? '<span class="bot-icon" aria-label="Bot">🤖</span> ' : ''}${escape(player?.name)}`;
  const avatar = (player) => `<span class="avatar ${player.isBot ? 'bot-avatar' : ''}" data-avatar-color="${colorFor(player.id)}" aria-hidden="true">${player.isBot ? `<span class="robot-glyph">🤖</span><small class="bot-number">${botNumber(player.name)}</small>` : escape(initials(player.name))}</span>`;

  // Ilustração original, reutilizada apenas na apresentação dos versos.
  const capybaraSvg = () => `<svg class="capybara" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
    <circle class="capybara-medallion" cx="60" cy="60" r="49"/>
    <path class="capybara-ground" d="M22 92c20 6 56 6 77-1"/>
    <g class="capybara-body">
      <path d="M27 80c-5-7-7-18-1-27 6-9 20-12 34-8l13 10 4 29-7 9H59l-2-10H42l-2 10H29z"/>
      <path d="M58 57c-1-13 5-22 17-22 10 0 18 5 20 15l7 8v13c-6 7-17 8-30 4L62 88H51"/>
      <path d="M65 42c-5-7-1-14 4-13 5 1 7 6 5 11"/>
    </g>
    <path class="capybara-muzzle" d="M81 58c5-3 14-3 21 0v13c-6 5-14 5-20 2-4-3-4-11-1-15z"/>
    <g class="capybara-details"><path d="M94 66h4m-5 7 5-1M34 71l-2 9m32-44 4 3"/><circle cx="83" cy="49" r="2.5"/><circle cx="101" cy="60" r="2"/></g>
  </svg>`;
  const bombSvg = () => `<svg class="card-bomb" viewBox="0 0 80 80" aria-hidden="true" focusable="false"><circle cx="34" cy="49" r="23" fill="currentColor"/><path d="m46 28 5-9 8 4-5 9M56 20c-1-8 9-8 8-14m-9 1-2-4m17 10 5 1m-4-8 4-3" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M19 46c1-5 4-9 9-10" class="bomb-shine" fill="none" stroke-width="4" stroke-linecap="round"/></svg>`;

  // Espada original, apontada para cima; o gradiente pertence a cada carta.
  const swordSvg = (id) => {
    const gradientId = `espada-${id.replace(/[^A-Za-z0-9_-]/g, '')}`;
    return `<svg class="card-sword-art" viewBox="0 0 80 96" aria-hidden="true" focusable="false"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop class="sword-gold" offset="0"/><stop class="sword-orange" offset=".5"/><stop class="sword-magenta" offset="1"/></linearGradient></defs><g fill="none" stroke="url(#${gradientId})" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"><path d="M40 6 27 26v36l13 8 13-8V26zM40 9v58M21 64l-6 8 25-4 25 4-6-8M35 72v14h10V72M32 90h16"/></g></svg>`;
  };
  const canUseCard = (card) => Boolean(room?.game && card && canAct()
    && (room.game.canPlay || (card.type === 'sword' && room.game.canPlaySword))
    && room.game.playableCardIds.includes(card.id));

  const doubleSvg = (id) => {
    const gradientId = `duplo-${id.replace(/[^A-Za-z0-9_-]/g, '')}`;
    return `<svg class="card-double-art" viewBox="0 0 100 70" aria-hidden="true" focusable="false"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop class="double-cyan" offset="0"/><stop class="double-violet" offset=".5"/><stop class="double-pink" offset="1"/></linearGradient></defs><text x="50" y="50" text-anchor="middle" stroke="url(#${gradientId})">2x</text></svg>`;
  };
  const isCardAvailable = (card) => Boolean(room?.game && card
    && (room.game.canPlay || (card.type === 'sword' && room.game.canPlaySword))
    && room.game.playableCardIds.includes(card.id));
  function clearNotices() { clearTimeout(noticeTimer); noticeTimer = null; noticeQueue = []; activeNotice = null; }
  function advanceNotice() {
    activeNotice = noticeQueue.shift() || null;
    const element = $('.table-notice');
    if (element) element.textContent = activeNotice || room?.notice || '';
    noticeTimer = activeNotice ? setTimeout(advanceNotice, room.config.actionNoticeMs) : null;
  }
  function captureNotice(previous, state) {
    if (previous?.code !== state.code || state.phase !== 'playing' || state.game?.challenge) clearNotices();
    if (previous?.code === state.code && state.phase === 'playing' && !state.game.challenge
      && state.game.playNumber > (previous.game?.playNumber ?? -1) && state.notice.includes('⚔️')) {
      noticeQueue.push(state.notice);
      if (!noticeTimer) advanceNotice();
    }
  }

  // Identidade visual independente da configuração de regras recebida do servidor.
  function cardArtwork(card) {
    const faces = {
      letter: ['+', card.letter], wild: ['+', '*'], vowel: ['+', 'vogal'],
      consonant: ['+', 'consoante'], first: ['+', 'a-m'], last: ['+', 'n-z'],
      swap: ['🔄', '🔄'], block: ['+', '🚫'], double: ['', doubleSvg(card.id)],
      multi: ['2+*', bombSvg()], life: ['♥', '♥'], pass: ['→', '→'], sword: ['+', swordSvg(card.id)],
    };
    const [corner, center] = faces[card.type] || ['', ''];
    return { corner, center: ['multi', 'sword', 'double'].includes(card.type) ? center : escape(center) };
  }

  function toast(message) {
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500);
  }

  function connection() {
    const element = $('#connection');
    element.textContent = replacing ? 'Sessão em outra aba' : socket.connected ? 'Online' : 'Reconectando…';
    element.classList.toggle('online', socket.connected);
  }

  async function send(event, data = {}) {
    if (!canAct()) return false;
    busy = true;
    render();
    try {
      const response = await socket.timeout(10_000).emitWithAck(event, data);
      if (!response.ok) { toast(response.error); return false; }
      return true;
    } catch {
      toast('Não recebemos a confirmação. Aguarde a reconexão antes de tentar novamente.');
      // Nova conexão recupera o estado real, inclusive se a ação já tiver sido aplicada.
      socket.disconnect().connect();
      return false;
    } finally { busy = false; render(); }
  }

  socket.on('connect', async () => {
    connection();
    const code = room?.code || storage.get('room');
    if (code && !replacing) {
      busy = true;
      render();
      try {
        const result = await socket.timeout(10_000).emitWithAck('room:join', { code, name, sessionId });
        if (!result.ok) { room = null; storage.remove('room'); toast(result.error); }
      } catch { toast('Não foi possível retomar a sala. Tentaremos ao reconectar.'); }
      finally { busy = false; render(); }
    } else render();
  });
  socket.on('disconnect', () => { closeLetters(); connection(); render(); });
  socket.on('room:state', (state) => {
    if (room?.code !== state.code || room?.hostId !== state.hostId || state.phase !== 'lobby') {
      deckDraft = null;
      if (room?.code !== state.code) deckExpanded = false;
      lastAdjustment = null;
    }
    sound.update(state);
    captureNotice(room, state);
    room = state;
    if (state.swordUnavailable && deckDraft) deckDraft.sword = state.settings.deckComposition.sword;
    if (state.settingsAdjustment && JSON.stringify(state.settingsAdjustment) !== lastAdjustment) {
      lastAdjustment = JSON.stringify(state.settingsAdjustment);
      toast(state.settingsAdjustment.message);
    }
    if (!state.settingsAdjustment) lastAdjustment = null;
    if (Number.isFinite(state.serverNow)) serverClockOffset = state.serverNow - Date.now();
    deckInfo = state.config;
    updateDeckSummary();
    storage.set('room', state.code);
    if (selectedCard) {
      if (room.game?.challenge) { closeLetters(); }
      else if (selectedCard.type !== 'sword' && selectedPlayVersion !== null && room.game?.version !== selectedPlayVersion) {
        closeLetters();
        toast('A mesa mudou. Escolha sua carta novamente.');
      } else if (!isCardAvailable(selectedCard)) closeLetters();
      else if ($('#debt-dialog').open) refreshDebtOptions();
      else refreshLetterOptions();
    }
    render();
  });
  socket.on('session:replaced', () => {
    replacing = true;
    room = null;
    closeLetters();
    toast('Sua vaga foi retomada em outra aba. Continue o jogo por lá.');
    connection();
    render();
  });
  socket.on('room:expired', () => {
    room = null;
    storage.remove('room');
    closeLetters();
    toast('A sala expirou por inatividade. Você pode criar outra.');
    render();
  });

  function render() {
    sound.update(room);
    if (room) {
      if (!avatarPalettes.has(room.code)) {
        let seed; try { seed = JSON.parse(storage.get(`avatarPalette:${room.code}`)) || {}; } catch { seed = {}; }
        avatarPalettes.set(room.code, createAvatarPalette(seed));
      }
      colorFor = avatarPalettes.get(room.code);
      colorFor.sync(room.players.map((player) => player.id));
      storage.set(`avatarPalette:${room.code}`, JSON.stringify(colorFor.snapshot()));
    }
    if (!room || room.phase !== 'playing') clearNotices();
    updateDeckSummary();
    if (!room) app.innerHTML = home();
    else if (room.phase === 'lobby') app.innerHTML = lobby();
    else if (room.phase === 'finished') app.innerHTML = victory();
    else app.innerHTML = table();
    for (const item of app.querySelectorAll('[data-avatar-color]')) item.style.backgroundColor = item.dataset.avatarColor;
    const opponents = app.querySelector('.opponents');
    if (opponents) opponents.style.setProperty('--opponent-count', opponents.dataset.count);
    renderChallenge();
    updateVictoryClock();
  }

  function home() {
    return `<section class="home-layout">
      <div class="hero-copy"><span class="eyebrow"><span class="little-star">✳</span> UM JOGO PARA CONECTAR</span>
        <h1>Uma letra.<br>Mil <em>possibilidades.</em></h1>
        <p class="hero-description">Junte os amigos, puxe uma cadeira e deixe a palavra crescer. Quem ficar sem cartas primeiro, vence.</p>
        <div class="home-facts"><span>2–8 jogadores</span><span>Em tempo real</span><span>Sem cadastro</span></div>
        <div class="card-scene" aria-hidden="true"><div class="deco-card deco-a"><small>+</small><b>A</b><small>A</small></div><div class="deco-card deco-star"><small>+</small><b>*</b><span>CORINGA</span></div><div class="deco-card deco-z"><small>+</small><b>Z</b><small>Z</small></div><span class="scene-caption">A próxima letra é sua. →</span></div>
      </div>
      <section class="entry-panel"><span class="panel-number">01 / VAMOS COMEÇAR</span><h2>Sua próxima<br>boa companhia.</h2><p class="muted">Uma mesa, muitas ideias. Só falta você.</p>
        <label for="player-name">Como podemos te chamar?</label><input id="player-name" name="name" maxlength="20" autocomplete="nickname" placeholder="Seu nome" value="${escape(name)}" ${disabled(busy)}>
        <button class="button primary full" data-action="create" ${disabled(!canAct() || replacing)}>Criar uma sala <span>→</span></button>
        <div class="separator"><span>já tem uma turma esperando?</span></div>
        <form id="join-form"><label for="room-code">Código da sala</label><div class="join-row"><input id="room-code" name="code" maxlength="6" pattern="[A-Za-z2-9]{6}" autocomplete="off" autocapitalize="characters" placeholder="EX: ABC234" value="${escape(enteredCode)}" required ${disabled(busy)}><button class="button secondary" ${disabled(!canAct() || replacing)}>Entrar <span>→</span></button></div></form>
        <p class="entry-note">Grátis. Direto no navegador. Melhor com amigos.</p>
      </section>
    </section>`;
  }

  function roomBar(step) {
    return `<div class="room-bar"><div><span class="eyebrow">${step}</span><div class="room-code-row"><h1>Sala <span>${room.code}</span></h1><button class="icon-button copy-button" data-action="copy" aria-label="Copiar convite da sala" title="Copiar convite">⧉</button></div></div><button class="text-button leave-button" data-action="leave" ${disabled(!canAct())}>Sair da sala <span>→</span></button></div>`;
  }

  const chosenComposition = () => deckDraft || room.settings.deckComposition;
  function compositionTotal(composition, effective = true) {
    return Object.entries(room.config.cardTypes).reduce((total, [type, card]) => total
      + (room.config.configurableCardTypes.includes(type) ? (effective && room.swordUnavailable && type === 'sword' ? 0 : Number(composition[type])) : card.quantity), 0);
  }
  function compositionIssue(composition) {
    const limits = room.config.deckRules;
    if (Object.values(composition).some((n) => !Number.isInteger(n) || n < limits.minQuantity || n > limits.maxQuantity)) {
      return `Use quantidades inteiras de ${limits.minQuantity} a ${limits.maxQuantity} por tipo.`;
    }
    return compositionTotal(composition, false) > limits.maxTotal ? `O baralho pode ter no máximo ${limits.maxTotal} cartas.` : null;
  }
  const compositionTotalLabel = (composition) => Number.isFinite(compositionTotal(composition)) ? compositionTotal(composition) : '—';
  function deckEditor() {
    const composition = chosenComposition(), limits = room.config.deckRules;
    return `<details class="deck-settings" ${deckExpanded ? 'open' : ''}><summary>Baralho <span id="deck-total">${compositionTotalLabel(composition)} cartas</span></summary>
      <p class="field-hint">26 letras e 4 restritivas fixas. De ${limits.minQuantity} a ${limits.maxQuantity} por tipo; até ${limits.maxTotal} no total.</p>
      <div class="deck-quantities">${room.config.configurableCardTypes.map((type) => {
        const rule = room.config.cardTypes[type];
        const unavailable = type === 'sword' && room.swordUnavailable;
        return `<div class="deck-quantity"><label for="deck-${type}"><span class="deck-card-symbol theme-${type}" aria-hidden="true">${type === 'double' ? doubleSvg('lobby') : escape(rule.symbol)}</span> ${escape(rule.label)}${unavailable ? '<small class="deck-unavailable">Indisponível em partidas de 2 jogadores</small>' : ''}</label>${isHost() ? `<div class="quantity-controls"><button type="button" class="icon-button" data-deck-step="-1" data-deck-type="${type}" aria-label="Diminuir ${escape(rule.label)}" ${disabled(!canAct() || unavailable || composition[type] <= limits.minQuantity)}>−</button><input id="deck-${type}" data-deck-type="${type}" type="number" inputmode="numeric" min="${limits.minQuantity}" max="${limits.maxQuantity}" step="1" aria-label="Quantidade de ${escape(rule.label)}" value="${Number.isFinite(composition[type]) ? composition[type] : ''}" ${disabled(!canAct() || unavailable)}><button type="button" class="icon-button" data-deck-step="1" data-deck-type="${type}" aria-label="Aumentar ${escape(rule.label)}" ${disabled(!canAct() || unavailable || composition[type] >= limits.maxQuantity)}>+</button></div>` : `<output id="deck-${type}">${composition[type]}</output>`}</div>`;
      }).join('')}</div><p id="deck-error" class="deck-error" role="status">${escape(compositionIssue(composition) || '')}</p>
      ${isHost() ? `<button class="text-button" data-action="reset-deck" ${disabled(!canAct())}>Restaurar padrão</button>` : '<p class="field-hint">Só o anfitrião pode editar.</p>'}</details>`;
  }
  async function saveComposition(composition) {
    deckDraft = composition;
    if (compositionIssue(composition)) { render(); return; }
    if (await send('room:deck', { composition })) deckDraft = null;
    render();
  }

  function refreshLobbyStart() {
    if (!isHost() || room.phase !== 'lobby') return;
    const count = Number($('#player-count').value), hand = Number($('#initial-cards').value);
    const maximum = Math.floor((compositionTotal(chosenComposition()) - room.config.reservedDrawCards) / count);
    const issue = compositionIssue(chosenComposition()) || (!Number.isInteger(hand) || hand < room.config.minHand || hand > maximum
      ? `Escolha de ${room.config.minHand} a ${maximum} cartas: é preciso reservar cartas para compra.` : null)
      || (count !== room.settings.playerCount || hand !== room.settings.initialCards ? 'Salve a configuração de jogadores e cartas iniciais.' : null);
    const ready = room.players.length === room.settings.playerCount && room.players.every((p) => p.connected);
    $('[data-action="start"]').disabled = Boolean(issue) || !ready || !canAct();
    $('#start-help').textContent = issue || (ready ? 'Todo mundo chegou. Pode começar!' : `Aguardando os ${room.settings.playerCount} jogadores ficarem conectados.`);
  }

  function lobby() {
    const ready = room.players.length === room.settings.playerCount && room.players.every((p) => p.connected);
    const startIssue = compositionIssue(chosenComposition()) || room.startIssue;
    return `<section class="room-layout">${roomBar('AQUELE MOMENTO ANTES DA PRIMEIRA CARTA')}
      <div class="lobby-layout"><section class="panel settings-panel"><span class="eyebrow">DO SEU JEITO</span><h2>Prepare a mesa.</h2><p class="muted">${isHost() ? 'Você é o anfitrião. Escolha o tamanho da roda.' : 'O anfitrião está preparando a partida.'}</p>
        <form id="settings-form"><fieldset ${disabled(!isHost() || !canAct())}><label for="player-count">Número de jogadores <span>2 a 8</span></label><select id="player-count" name="playerCount">${Array.from({ length: 7 }, (_, i) => i + 2).map((n) => `<option value="${n}" ${n === room.settings.playerCount ? 'selected' : ''}>${n} jogadores</option>`).join('')}</select>
        <label for="initial-cards">Cartas por pessoa <span id="max-cards">3 a ${room.settings.maxInitialCards}</span></label><input id="initial-cards" name="initialCards" type="number" min="3" max="${room.settings.maxInitialCards}" value="${room.settings.initialCards}" required><p class="field-hint">${room.deckSize} cartas no total. Sempre sobra pelo menos uma para comprar.</p>
        ${isHost() ? '<button class="button secondary full">Salvar configuração <span>✓</span></button>' : ''}</fieldset></form>
        ${deckEditor()}
        <div class="lobby-tip"><span aria-hidden="true">✳</span><p>Não precisa saber a palavra inteira.<br>Só a próxima letra.</p></div>
      </section>
      <section class="panel players-panel"><div class="section-top"><div><span class="eyebrow">A TURMA</span><h2>Quem está na roda</h2></div><span class="count-badge">${room.players.filter((p) => p.connected).length}/${room.settings.playerCount}</span></div>
        <ul class="player-list">${room.players.map((p, i) => `<li>${avatar(p, i)}<div class="player-info"><strong>${playerName(p)}${p.id === room.meId ? ' <span class="you-label">(você)</span>' : ''}</strong><small>${p.id === room.hostId ? 'Anfitrião' : 'Na turma'} · ${p.connected ? 'Conectado' : 'Aguardando reconexão'}</small></div><span class="status-dot ${p.connected ? 'connected' : ''}" aria-label="${p.connected ? 'Conectado' : 'Desconectado'}"></span>${isHost() && p.isBot ? `<button class="icon-button remove-bot" data-remove-bot="${p.id}" aria-label="Remover ${escape(p.name)}" ${disabled(!canAct())}>×</button>` : ''}${isHost() && !p.connected ? `<button class="text-button" data-remove="${p.id}" ${disabled(!canAct())}>Liberar vaga</button>` : ''}</li>`).join('')}${Array.from({ length: Math.max(0, room.settings.playerCount - room.players.length) }, () => '<li class="empty-seat"><span class="avatar">+</span><div class="player-info"><strong>Uma cadeira livre</strong><small>Compartilhe o código da sala</small></div></li>').join('')}</ul>
        <div class="bot-controls">${isHost() ? `<button class="button secondary full" data-action="add-bot" ${disabled(!canAct() || room.players.length >= room.config.maxPlayers)}>Adicionar bot <span aria-hidden="true">🤖 +</span></button>` : ''}</div><p class="lobby-bot-notice" role="status">${escape(room.notice)}</p>
        <div class="start-area">${isHost() ? `<button class="button primary full" data-action="start" ${disabled(!ready || Boolean(startIssue) || !canAct())}>Iniciar partida <span>→</span></button><p id="start-help" class="field-hint">${startIssue ? escape(startIssue) : ready ? 'Todo mundo chegou. Pode começar!' : `Aguardando os ${room.settings.playerCount} jogadores ficarem conectados.`}</p>` : '<div class="waiting"><span class="status-dot connected"></span> Aguardando o anfitrião iniciar a partida…</div>'}</div>
      </section></div><p class="room-note">Caiu a conexão? Volte pelo mesmo navegador para retomar sua vaga. O anfitrião pode liberar vagas desconectadas no lobby.</p></section>`;
  }

  function wordHeading(player, finished = false) {
    const ownTurn = !finished && player?.id === room.meId;
    return `<div class="word-turn-label ${ownTurn ? 'own-turn-label' : ''}" role="status">${finished ? 'Vitória de' : 'É a vez de:'} <strong class="word-turn-name">${playerName(player)}</strong></div>`;
  }

  function table() {
    const game = room.game;
    const current = room.players.find((p) => p.id === game.turnPlayerId);
    const meIndex = room.players.findIndex((p) => p.id === room.meId);
    const ordered = [...room.players.slice(meIndex + 1), ...room.players.slice(0, meIndex)];
    return `<section class="game-layout">${roomBar('PALAVRAS SE CONSTROEM EM BOA COMPANHIA')}
      <div class="opponents" data-count="${ordered.length}">${ordered.map((p) => `<div class="opponent ${p.id === game.turnPlayerId ? 'active' : ''} ${!p.connected ? 'offline-player' : ''}"><button type="button" class="avatar-target" data-avatar-name="${escape(p.name)}" aria-label="${escape(p.name)}, ${p.cardCount} cartas${!p.connected ? ', desconectado' : ''}">${avatar(p)}${!p.connected ? '<span class="avatar-offline" aria-label="Desconectado">·</span>' : ''}</button><small class="avatar-count"><svg class="count-cards-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="2" width="11" height="14" rx="2"/><rect x="7" y="5" width="11" height="14" rx="2"/></svg><span>${p.cardCount}</span></small></div>`).join('')}</div>
      ${game.paused && !game.challenge && !game.pendingVictory && isHost() ? `<div class="paused-actions"><button class="text-button" data-action="end" ${disabled(!canAct())}>Encerrar partida e voltar à sala →</button></div>` : ''}
      <section class="table-felt" aria-label="Centro da mesa">${game.pendingVictory && !game.challenge ? `<section class="pending-victory" aria-label="Vitória pendente"><p id="victory-countdown" role="status"></p>${game.pendingVictory.playerId !== room.meId ? `<button class="button primary" data-action="accept-victory" ${disabled(!canAct() || !game.pendingVictory.canAccept)}>Aceito a palavra</button>` : '<small>Aguardando os outros jogadores.</small>'}</section>` : ''}
        <div class="table-center"><div class="word-area">${wordHeading(current)}<div class="word-display ${game.word ? '' : 'word-empty'}" aria-label="Palavra atual: ${escape(game.word || 'vazia')}">${game.word ? escape(game.word) : 'A primeira letra é com você.'}</div><div class="table-feedback"><p class="table-notice" role="status">${escape(activeNotice || room.notice)}</p><p class="table-state" id="table-state" role="status">${game.letterDebt.count ? `<span class="debt-state">${escape(room.players.find((p) => p.id === game.letterDebt.playerId)?.name)} deve ${game.letterDebt.count} letra${game.letterDebt.count === 1 ? '' : 's'}</span>` : ''}${game.letterDebt.count && game.blockedLetter ? ' · ' : ''}${game.blockedLetter ? `<span class="block-state">Letra bloqueada: ${escape(game.blockedLetter)}</span>` : ''}</p></div>${game.extraTurns.length ? `<p class="extra-turn-notice">2x ativo · retorno para ${escape(room.players.find((p) => p.id === game.extraTurns.at(-1))?.name)}</p>` : ''}</div></div>
        <div class="table-controls"><button class="draw-pile ${game.canDraw ? 'available' : ''}" data-action="draw" ${disabled(!game.canDraw || !canAct())} aria-label="Comprar uma carta. ${game.deckCount} cartas na pilha, ${game.discardCount} para reembaralhar."><span class="deck-back card-back" aria-hidden="true">${capybaraSvg()}</span><strong>COMPRAR</strong><small>${game.deckCount} na pilha${game.discardCount ? ` · ${game.discardCount} jogadas` : ''}</small></button><div class="challenge-table-actions"><button class="button challenge-button" data-action="challenge" aria-describedby="table-state" ${disabled(!canAct() || Boolean(game.challenge) || game.letterDebt.count > 0)}>Duvidar da palavra <span aria-hidden="true">?</span></button>${game.challenge ? '<button class="text-button" data-action="challenge-view">Acompanhar desafio →</button>' : ''}</div></div>
      </section>
      <section class="hand-section" aria-label="Sua mão"><div class="hand-heading"><h2>Sua mão <span>${room.hand.length} carta${room.hand.length === 1 ? '' : 's'}</span></h2>${game.canSkipTurn && canAct() ? '<button class="button lose-button skip-button hand-skip-button" data-action="skip">Não consigo jogar <span aria-hidden="true">↺</span></button>' : ''}</div>
      <div class="hand-cards">${room.hand.map((card) => cardButton(card, canUseCard(card))).join('')}</div></section>
    </section>`;
  }

  function cardButton(card, enabled) {
    const rule = room.config.cardTypes[card.type];
    const fixed = card.type === 'letter';
    const title = fixed ? card.letter : rule.label;
    const description = rule.description ? `${title} · ${rule.description}` : title;
    const artwork = cardArtwork(card);
    const actionLabel = card.type === 'sword' ? description : `Jogar ${description}`;
    const special = !fixed && card.type !== 'wild';
    const lastRestricted = room.hand.length < room.config.minHandForRestrictedCards && rule.cannotBeLast;
    const reason = lastRestricted ? '' : room.game.playableCardIds.includes(card.id) ? '' : card.type === 'sword' ? 'Aguarde uma oportunidade' : card.type === 'swap' && !room.game.word ? 'Visor vazio' : card.type === 'double' ? 'Sem jogada anterior' : 'Letra bloqueada';
    const button = `<button class="playing-card card-${rule.color} card-face-${card.type} ${card.type === 'wild' ? 'wild-card' : ''} ${special ? 'special-card' : ''} ${reason ? 'unplayable-card' : ''}" data-card="${escape(card.id)}" ${disabled(!enabled)} aria-label="${escape(actionLabel)}${reason ? `: ${reason}` : ''}" title="${escape(reason || description)}"><span class="card-corner" aria-hidden="true">${escape(artwork.corner)}</span><strong class="${special ? 'card-special-title' : ''}" aria-hidden="true">${artwork.center}</strong>${card.type === 'pass' ? '<span class="card-corner card-corner-right" aria-hidden="true">→</span>' : ''}<span class="card-bottom">${escape(card.type === 'sword' ? rule.caption : reason || description.toUpperCase())}</span></button>`;
    return lastRestricted ? `<span class="card-touch-target" role="button" tabindex="0" data-restricted-card="${escape(card.id)}" aria-label="Compre uma carta para poder jogar esta">${button}</span>` : button;
  }

  function victory() {
    const winner = room.players.find((p) => p.id === room.game.winnerId);
    const won = winner.id === room.meId;
    return `<section class="room-layout">${roomBar('FIM DE PARTIDA · COMEÇO DE OUTRA HISTÓRIA')}<section class="victory-panel"><div class="victory-star" aria-hidden="true">✳</div><span class="eyebrow">MÃO VAZIA. SORRISO CHEIO.</span><h1>${won ? 'Essa foi sua!' : `${escape(winner.name)} venceu!`}</h1><p>${won ? 'Você encontrou a última letra e levou a melhor.' : 'A última carta foi jogada. Vale uma revanche?'}</p><div class="final-word">${wordHeading(winner, true)}<strong>${escape(room.game.word)}</strong></div>${['Palavra aceita', 'Palavra recusada'].includes(room.notice) ? `<p class="victory-challenge-result" role="status">${escape(room.notice)}</p>` : ''}<div class="victory-actions">${isHost() ? `<button class="button primary" data-action="start" ${disabled(!canAct())}>Jogar de novo <span>→</span></button><button class="button secondary" data-action="lobby" ${disabled(!canAct())}>Voltar à sala</button>` : '<p class="muted">O anfitrião pode começar outra partida ou voltar à sala.</p><button class="button secondary" data-action="leave" '+disabled(!canAct())+'>Voltar ao início</button>'}</div><p class="field-hint">${isHost() ? 'Para mudar jogadores ou configurações, volte à sala.' : 'Você pode continuar aqui para a próxima rodada.'}</p></section></section>`;
  }

  function closeLetters() {
    selectedCard = null;
    selectedLetter = null;
    selectedBlock = null;
    blockStep = 1;
    pendingDebtLetters = '';
    selectedPlayVersion = null;
    $('#debt-dialog').close();
    $('#letter-dialog').close();
    $('#multi-dialog').close();
  }
  function refreshLetterOptions() {
    if (!selectedCard) return;
    if (room.config.cardTypes[selectedCard.type].effect === 'appendMany') { refreshMultiOptions(); return; }
    let choices = room.game.allowedLettersByCard[selectedCard.id] || '';
    if (selectedCard.type === 'swap' && pendingDebtLetters) choices = [...choices].filter((letter) => letter !== pendingDebtLetters.at(-1)).join('');
    const block = selectedCard.type === 'block';
    if (!choices.includes(selectedLetter)) { selectedLetter = null; blockStep = 1; selectedBlock = null; }
    const blocking = block && blockStep === 2;
    const selected = blocking ? selectedBlock : selectedLetter;
    $('#letter-grid').innerHTML = [...alphabet].map((letter) => `<button class="letter-option ${selected === letter ? 'selected' : ''}" ${blocking ? 'data-block' : 'data-letter'}="${letter}" aria-pressed="${selected === letter}" ${disabled(!blocking && !choices.includes(letter))}>${letter}</button>`).join('');
    $('#letter-live-preview').hidden = selectedCard.type !== 'sword';
    $('#letter-live-preview').textContent = `Visor agora: ${room.game.word || 'vazio'}`;
    $('#block-step-title').hidden = !block;
    $('#block-step-title').textContent = blocking ? 'Letra para bloquear' : 'Adicionar letra';
    $('#block-add-chip').hidden = !blocking;
    $('#block-add-chip').textContent = `Adicionar: ${selectedLetter || ''}`;
    $('#confirm-block').hidden = !block;
    $('#confirm-block').textContent = blocking ? 'Bloquear letra' : 'Adicionar';
    $('#confirm-block').disabled = !selected || !canAct();
    $('#letter-dialog').classList.toggle('block-dialog', block);
    $('#letter-title').textContent = block ? 'Bloqueio' : $('#letter-title').textContent;
    $('#letter-hint').textContent = selectedCard.type === 'swap'
      ? `Substitua ${(room.game.word + pendingDebtLetters).at(-1)} por outra letra. A letra substituída não vale${pendingDebtLetters ? '' : ', nem a bloqueada'}.`
      : `Letras permitidas: ${[...choices].join(', ')}.`;
    if (pendingDebtLetters) $('#letter-hint').textContent = `Letras acumuladas: ${pendingDebtLetters}. ` + $('#letter-hint').textContent;
  }
  function openLetters(card) {
    $('#letter-dialog').dataset.cardTheme = card.type;
    selectedCard = card;
    selectedLetter = null;
    selectedBlock = null;
    blockStep = 1;
    if (room.config.cardTypes[card.type].effect === 'appendMany') {
      $('#multi-input').value = '';
      refreshMultiOptions();
      $('#multi-dialog').showModal();
      fitTextDialogs();
      $('#multi-input').focus();
      return;
    }
    const rule = room.config.cardTypes[card.type];
    $('#letter-title').textContent = rule.description ? `${rule.label} · ${rule.description.toLowerCase()}` : rule.label;
    refreshLetterOptions();
    $('#letter-dialog').showModal();
  }

  function refreshMultiOptions() {
    if (!selectedCard || !room?.game) return;
    const rule = room.config.cardTypes[selectedCard.type];
    const text = $('#multi-input').value;
    const countValid = text.length >= rule.minLetters && text.length <= rule.maxLetters;
    const blocked = pendingDebtLetters ? null : room.game.blockedLetter;
    const firstBlocked = Boolean(blocked && text[0] === blocked);
    $('#multi-hint').textContent = `${pendingDebtLetters ? `Letras acumuladas: ${pendingDebtLetters}. ` : ''}Digite pelo menos ${rule.minLetters} letras de A a Z.`;
    $('#multi-count').textContent = `${text.length}/${rule.maxLetters}`;
    $('#multi-count').classList.toggle('invalid', !countValid && text.length > 0);
    $('#multi-block-warning').hidden = !blocked;
    $('#multi-block-warning').textContent = blocked ? `Letra bloqueada: ${blocked}. A primeira letra não pode ser ${blocked}. Da segunda em diante, ela é permitida.` : '';
    $('#multi-feedback').textContent = firstBlocked ? `Troque a primeira letra: ${blocked} está bloqueada.`
      : text.length < rule.minLetters ? `Faltam ${rule.minLetters - text.length} letra(s) para jogar.`
        : !countValid ? 'Revise a quantidade de letras indicada no contador.' : 'Tudo certo para jogar.';
    $('#multi-input').setAttribute('aria-invalid', String(firstBlocked || (text.length > 0 && !countValid)));
    $('#multi-preview').textContent = room.game.word + pendingDebtLetters + text || 'O visor começa aqui…';
    $('#confirm-multi').disabled = !canAct() || !room.game.canPlay || !countValid || firstBlocked || /[^A-Z]/.test(text);
  }

  // O teclado móvel reduz o visualViewport. O corpo rola; a confirmação fica fora dele.
  function fitTextDialogs() {
    const viewport = window.visualViewport;
    const height = viewport?.height || innerHeight;
    for (const id of ['multi-dialog', 'debt-dialog', 'challenge-dialog']) {
      const dialog = $(`#${id}`);
      if (!dialog.open) continue;
      dialog.style.setProperty('--modal-top', `${(viewport?.offsetTop || 0) + height / 2}px`);
      dialog.style.setProperty('--modal-height', `${Math.max(120, height - 24)}px`);
    }
  }
  window.visualViewport?.addEventListener('resize', () => {
    fitTextDialogs();
    for (const id of ['multi-input', 'debt-input', 'challenge-input']) {
      if (document.activeElement === $(`#${id}`)) requestAnimationFrame(() => $(`#${id}`).scrollIntoView({ block: 'nearest' }));
    }
  });
  window.visualViewport?.addEventListener('scroll', fitTextDialogs);
  window.addEventListener('resize', fitTextDialogs);

  function debtCount() {
    return room?.game?.letterDebt.playerId === room?.meId ? room.game.letterDebt.count : 0;
  }
  function refreshDebtOptions() {
    const count = debtCount();
    const text = $('#debt-input').value;
    const blocked = room.game.blockedLetter;
    const firstBlocked = Boolean(blocked && text[0] === blocked);
    const valid = count > 0 && text.length === count && !firstBlocked && !/[^A-Z]/.test(text);
    $('#debt-hint').textContent = `Digite exatamente ${count} letra${count === 1 ? '' : 's'} de A a Z, antes da carta ${room.config.cardTypes[selectedCard.type].label}.`;
    $('#debt-count').textContent = `${text.length}/${count}`;
    $('#debt-warning').hidden = !blocked;
    $('#debt-warning').textContent = blocked ? `A primeira letra não pode ser ${blocked}. As seguintes podem. Depois deste pagamento, o Bloqueio não restringe a letra da carta.` : '';
    $('#debt-feedback').textContent = firstBlocked ? `Troque a primeira letra: ${blocked} está bloqueada.` : valid ? 'Tudo certo para continuar.' : `Preencha exatamente ${count} letra${count === 1 ? '' : 's'}.`;
    $('#debt-preview').textContent = room.game.word + text || 'O visor começa aqui…';
    $('#confirm-debt').disabled = !canAct() || !room.game.canPlay || !valid;
  }
  async function submitSelectedCard(letter, blockedLetter) {
    const card = selectedCard;
    const data = { version: selectedPlayVersion ?? room.game.version, cardId: selectedCard.id, letter, blockedLetter, accumulatedLetters: pendingDebtLetters };
    closeLetters();
    const ok = await send('game:play', data);
    if (!ok && card.type === 'sword' && isCardAvailable(room?.hand.find((c) => c.id === card.id))) await chooseCard(card);
  }
  async function chooseCard(card) {
    selectedCard = card;
    selectedPlayVersion ??= room.game.version;
    const effect = room.config.cardTypes[card.type].effect;
    if (effect === 'pass' || effect === 'replay' || card.type === 'letter') await submitSelectedCard();
    else openLetters(card);
  }
  function beginDebt(card) {
    $('#debt-dialog').dataset.cardTheme = card.type;
    closeLetters();
    selectedCard = card;
    selectedPlayVersion = room.game.version;
    $('#debt-input').value = '';
    refreshDebtOptions();
    $('#debt-dialog').showModal();
    fitTextDialogs();
    $('#debt-input').focus();
  }
  $('#debt-input').addEventListener('input', (event) => {
    const input = event.target;
    const cursor = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/[^A-Za-z]/g, '').length;
    input.value = input.value.replace(/[^A-Za-z]/g, '').toUpperCase();
    input.setSelectionRange(cursor, cursor);
    refreshDebtOptions();
  });
  $('#debt-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedCard) return;
    refreshDebtOptions();
    if ($('#confirm-debt').disabled) return;
    pendingDebtLetters = $('#debt-input').value;
    $('#debt-dialog').close();
    await chooseCard(selectedCard);
  });
  $('#close-debt').addEventListener('click', closeLetters);
  $('#debt-dialog').addEventListener('cancel', closeLetters);
  $('#multi-input').addEventListener('input', (event) => {
    const input = event.target;
    const cursor = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/[^A-Za-z]/g, '').length;
    // Filtra antes de converter para não transformar símbolos Unicode em letras válidas.
    input.value = input.value.replace(/[^A-Za-z]/g, '').toUpperCase();
    input.setSelectionRange(cursor, cursor);
    refreshMultiOptions();
  });
  $('#multi-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedCard) return;
    refreshMultiOptions();
    if ($('#confirm-multi').disabled) return;
    await submitSelectedCard($('#multi-input').value);
  });
  $('#close-multi').addEventListener('click', closeLetters);
  $('#multi-dialog').addEventListener('cancel', closeLetters);

  app.addEventListener('input', (event) => {
    if (event.target.id === 'player-name') { name = event.target.value; storage.set('name', name); }
    if (event.target.id === 'room-code') { enteredCode = event.target.value.toUpperCase(); event.target.value = enteredCode; }
    if (event.target.matches('input[data-deck-type]') && isHost()) {
      deckDraft = { ...chosenComposition(), [event.target.dataset.deckType]: event.target.value === '' ? NaN : Number(event.target.value) };
      const issue = compositionIssue(deckDraft);
      $('#deck-total').textContent = `${compositionTotalLabel(deckDraft)} cartas`;
      $('#deck-error').textContent = issue || '';
    }
    if (event.target.id === 'player-count') {
      const max = Math.floor((room.deckSize - room.config.reservedDrawCards) / Number(event.target.value));
      $('#initial-cards').max = max;
      if (Number($('#initial-cards').value) > max) {
        $('#initial-cards').value = max;
        toast(`Cartas iniciais ajustadas para ${max}, o máximo para este baralho e esta turma.`);
      }
      $('#max-cards').textContent = `3 a ${max}`;
    }
    if (event.target.matches('input[data-deck-type], #player-count, #initial-cards')) refreshLobbyStart();
  });

  app.addEventListener('toggle', (event) => { if (event.target.matches('.deck-settings')) deckExpanded = event.target.open; }, true);
  app.addEventListener('change', async (event) => {
    if (event.target.matches('input[data-deck-type]') && isHost() && canAct()) await saveComposition(chosenComposition());
  });
  app.addEventListener('keydown', (event) => {
    if (['Enter', ' '].includes(event.key) && event.target.matches('[data-restricted-card]')) { event.preventDefault(); event.target.click(); }
    if (event.key === 'Enter' && event.target.matches('input[data-deck-type]')) { event.preventDefault(); event.target.blur(); }
  });

  app.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (event.target.id === 'join-form') {
      if (!name.trim()) { toast('Primeiro, conte como podemos te chamar.'); $('#player-name').focus(); return; }
      await send('room:join', { sessionId, name, code: enteredCode });
    }
    if (event.target.id === 'settings-form') {
      const form = new FormData(event.target);
      await send('room:settings', { playerCount: Number(form.get('playerCount')), initialCards: Number(form.get('initialCards')) });
    }
  });

  app.addEventListener('click', async (event) => {
    if (event.target.closest('[data-restricted-card]')) { toast('Compre uma carta para poder jogar esta'); return; }
    const step = event.target.closest('[data-deck-step]');
    if (step && !step.disabled && isHost()) {
      await saveComposition({ ...chosenComposition(), [step.dataset.deckType]: Number(chosenComposition()[step.dataset.deckType]) + Number(step.dataset.deckStep) });
      return;
    }
    if (event.target.closest('[data-action="reset-deck"]') && isHost() && canAct()) {
      if (await send('room:deck:reset')) deckDraft = null;
      render(); return;
    }
    const removeButton = event.target.closest('[data-remove]');
    if (removeButton && !removeButton.disabled) { await send('room:remove', { playerId: removeButton.dataset.remove }); return; }
    const cardElement = event.target.closest('[data-card]');
    if (cardElement && !cardElement.disabled) {
      const card = room.hand.find((item) => item.id === cardElement.dataset.card);
      if (!canUseCard(card)) return;
      const effect = room.config.cardTypes[card.type].effect;
      if (debtCount() > 0 && effect !== 'pass' && effect !== 'replay') beginDebt(card);
      else { closeLetters(); await chooseCard(card); }
      return;
    }
    const removeBot = event.target.closest('[data-remove-bot]');
    if (removeBot && !removeBot.disabled) { await send('room:bot:remove', { playerId: removeBot.dataset.removeBot }); return; }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    switch (button.dataset.action) {
      case 'create':
        if (!name.trim()) { toast('Primeiro, conte como podemos te chamar.'); $('#player-name').focus(); return; }
        await send('room:create', { sessionId, name }); break;
      case 'start': await send('game:start'); break;
      case 'add-bot': await send('room:bot:add'); break;
      case 'challenge': await send('challenge:start'); break;
      case 'challenge-view': renderChallenge(); break;
      case 'draw': await send('game:draw'); break;
      case 'skip': await send('game:skip', { version: room.game.version }); break;
      case 'accept-victory': await send('victory:accept', { pendingId: room.game.pendingVictory.id }); break;
      case 'lobby': await send('room:lobby'); break;
      case 'end':
        if (confirm('Encerrar esta partida pausada? Todos voltarão à sala e uma nova partida terá novas cartas.')) await send('room:lobby');
        break;
      case 'leave':
        if (room.phase === 'playing' && !confirm('Sair da partida? Sua mão ficará na mesa, mas você não participará mais desta rodada.')) return;
        if (await send('room:leave')) { room = null; storage.remove('room'); render(); }
        break;
      case 'copy':
        try { await navigator.clipboard.writeText(`${location.origin}/?sala=${room.code}`); toast('Convite copiado! Envie para a turma.'); }
        catch { toast(`Compartilhe este código com seus amigos: ${room.code}`); }
        break;
    }
  });


  const challengeNow = () => Date.now() + serverClockOffset;
  function updateVictoryClock() {
    const pending = room?.game?.pendingVictory;
    const counter = $('#victory-countdown');
    if (!pending || !counter) return;
    const winner = room.players.find((p) => p.id === pending.playerId);
    const remaining = Math.max(0, Math.ceil((pending.deadline - challengeNow()) / 1000));
    counter.textContent = `${winner.name} baixou a última carta. Vitória em ${remaining}s, a menos que alguém duvide.`;
  }
  function updateChallengeClock() {
    const challenge = room?.game?.challenge;
    if (!challenge) return;
    const completing = challenge.phase === 'completando', voting = challenge.phase === 'votando';
    const deadline = completing ? challenge.completionDeadline : challenge.voteDeadline;
    const remaining = Math.max(0, Math.ceil((deadline - challengeNow()) / 1000));
    $('#challenge-timer').textContent = `${remaining}s`;
    $('#challenge-timer').classList.toggle('urgent', remaining <= CHALLENGE_UI.urgentSeconds);
    const mine = challenge.challengedId === room.meId;
    challengeField.setEditable(mine && completing && remaining > 0 && canAct());
    $('#challenge-ok').disabled = !canAct() || !completing || remaining === 0;
    $('#challenge-loss').disabled = !canAct() || voting || remaining === 0;
    for (const button of document.querySelectorAll('[data-vote]')) button.disabled = !canAct() || !challenge.canVote || remaining === 0;
  }

  const challengeField = protectChallengeField($('#challenge-input'), $('#challenge-word'), queueChallengePreview);
  function refreshChallengePreview() {
    const challenge = room?.game?.challenge;
    if (!challenge) return;
    const mine = challenge.challengedId === room.meId && challenge.phase === 'completando';
    const added = mine && challengeDialogId === challenge.id ? challengeField.getAdded() : challenge.addedLetters;
    challengeField.set(challenge.baseWord, added, room.config.challenge.maxLetters, mine && canAct());
  }

  function renderChallenge() {
    const challenge = room?.game?.challenge, dialog = $('#challenge-dialog');
    if (!challenge) {
      dialog.close();
      challengeDialogId = null;
      releaseChallengeHistory();
      clearTimeout(challengePreviewTimer);
      return;
    }
    closeLetters();
    const mine = challenge.challengedId === room.meId;
    const completing = challenge.phase === 'completando', voting = challenge.phase === 'votando';
    if (challengeDialogId !== challenge.id) {
      challengeDialogId = challenge.id;
      challengeField.set(challenge.baseWord, challenge.addedLetters, room.config.challenge.maxLetters, mine && completing);
    } else if (!mine) challengeField.set(challenge.baseWord, challenge.addedLetters, room.config.challenge.maxLetters, mine && completing);
    const nameOf = (id) => room.players.find((p) => p.id === id)?.name || 'Jogador';
    $('#challenge-title').textContent = completing ? 'Diga sua palavra' : 'Aceitar palavra?';
    $('#challenge-description').hidden = voting;
    $('#challenge-description').textContent = `${nameOf(challenge.challengerId)} desafia ${nameOf(challenge.challengedId)}`;
    $('#challenge-ok').hidden = !mine || !completing;
    $('#challenge-loss').hidden = !mine || voting;
    $('#challenge-vote-actions').hidden = !voting || mine;
    $('#challenge-dialog').classList.toggle('voting-dialog', voting);
    for (const button of document.querySelectorAll('[data-vote]')) {
      const ownVote = challenge.ownVote === button.dataset.vote;
      button.classList.toggle('own-vote', ownVote);
      button.setAttribute('aria-pressed', String(ownVote));
    }
    refreshChallengePreview();
    updateChallengeClock();
    guardChallengeHistory(challenge.id);
    if (!dialog.open) {
      dialog.showModal();
      fitTextDialogs();
      if (mine && completing) $('#challenge-input').focus();
    }
  }

  function queueChallengePreview(letters) {
    const challenge = room?.game?.challenge;
    if (!challenge || challenge.challengedId !== room.meId || challenge.phase !== 'completando') return;
    clearTimeout(challengePreviewTimer);
    const challengeId = challenge.id;
    challengePreviewTimer = setTimeout(async () => {
      if (!socket.connected || room?.game?.challenge?.id !== challengeId || room.game.challenge.phase !== 'completando') return;
      try {
        const response = await socket.timeout(10_000).emitWithAck('challenge:preview', { challengeId, letters });
        if (!response.ok && room?.game?.challenge?.id === challengeId) toast(response.error);
      } catch { /* OK também envia o sufixo completo. */ }
    }, room.config.challenge.previewIntervalMs);
  }
  $('#challenge-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('#challenge-ok').disabled || $('#challenge-ok').hidden) return;
    clearTimeout(challengePreviewTimer);
    await send('challenge:confirm', { challengeId: room.game.challenge.id, letters: challengeField.getAdded() });
  });
  $('#challenge-loss').addEventListener('click', async () => {
    clearTimeout(challengePreviewTimer);
    await send('challenge:lose', { challengeId: room.game.challenge.id });
  });
  for (const button of document.querySelectorAll('[data-vote]')) button.addEventListener('click', async () => {
    await send('challenge:vote', { challengeId: room.game.challenge.id, vote: button.dataset.vote });
  });
  // O evento cancel cobre Esc e o fechamento nativo do dialog no botão voltar.
  $('#challenge-dialog').addEventListener('cancel', (event) => event.preventDefault());
  $('#challenge-dialog').addEventListener('close', () => {
    if (room?.game?.challenge) queueMicrotask(renderChallenge);
  });
  function guardChallengeHistory(id) {
    if (challengeHistoryGuard === id) return;
    if (history.state?.capiletrasChallenge !== id) history.pushState({ ...history.state, capiletrasChallenge: id }, '', location.href);
    challengeHistoryGuard = id;
  }
  function releaseChallengeHistory() {
    const id = challengeHistoryGuard;
    challengeHistoryGuard = null;
    if (id !== null && history.state?.capiletrasChallenge === id) history.back();
  }
  window.addEventListener('popstate', () => {
    const challenge = room?.game?.challenge;
    if (!challenge) return;
    // Mantém uma entrada da própria página para o voltar do celular não sair do desafio.
    if (history.state?.capiletrasChallenge !== challenge.id) history.pushState({ ...history.state, capiletrasChallenge: challenge.id }, '', location.href);
    challengeHistoryGuard = challenge.id;
    renderChallenge();
  });
  setTimeout(function tickChallengeClock() {
    updateChallengeClock();
    updateVictoryClock();
    setTimeout(tickChallengeClock, deckInfo?.challenge.tickMs || 1000);
  }, 1000);

  $('#letter-grid').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-letter]');
    if (!button || button.disabled || !selectedCard || !canAct()) return;
    if (selectedCard.type === 'block') { selectedLetter = button.dataset.letter; refreshLetterOptions(); return; }
    await submitSelectedCard(button.dataset.letter);
  });
  $('#letter-grid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-block]');
    if (!button || !selectedCard || !canAct()) return;
    selectedBlock = button.dataset.block;
    refreshLetterOptions();
  });
  $('#confirm-block').addEventListener('click', async () => {
    if (!selectedCard || !selectedLetter || !canAct()) return;
    if (blockStep === 1) { blockStep = 2; selectedBlock = null; refreshLetterOptions(); return; }
    if (!selectedBlock) return;
    await submitSelectedCard(selectedLetter, selectedBlock);
  });
  $('#close-letter').addEventListener('click', closeLetters);
  $('#letter-dialog').addEventListener('cancel', closeLetters);
  $('#open-rules').addEventListener('click', () => $('#rules-dialog').showModal());
  $('#close-rules').addEventListener('click', () => $('#rules-dialog').close());
  for (const dialog of document.querySelectorAll('dialog:not(#challenge-dialog)')) dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) { if (dialog.id === 'rules-dialog') dialog.close(); else closeLetters(); } } });
  let avatarTipTimer;
  const avatarTip = document.createElement('div'); avatarTip.className = 'avatar-tooltip'; avatarTip.hidden = true; avatarTip.setAttribute('role','status'); document.body.append(avatarTip);
  function showAvatarName(event) {
    const target = event.target.closest('[data-avatar-name]'); if (!target) return;
    clearTimeout(avatarTipTimer); avatarTip.textContent = target.dataset.avatarName; avatarTip.hidden = false;
    const bounds = target.getBoundingClientRect(); avatarTip.style.left = `${Math.max(80,Math.min(innerWidth-80,bounds.x+bounds.width/2))}px`; avatarTip.style.top = `${bounds.bottom+6}px`;
    avatarTipTimer = setTimeout(() => { avatarTip.hidden = true; }, AVATAR_UI.tooltipMs);
  }
  document.addEventListener('click', showAvatarName); document.addEventListener('pointerover', showAvatarName); document.addEventListener('focusin', showAvatarName);
  render();
})();
