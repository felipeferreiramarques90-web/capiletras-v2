/* O cliente apresenta a mesa e envia intenções. Todas as regras são validadas pelo servidor. */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const app = $('#app');
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
  let deckInfo = null;
  let toastTimer;
  const socket = io({ reconnection: true, reconnectionDelay: 800, reconnectionDelayMax: 5000 });
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const disabled = (condition) => condition ? 'disabled' : '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // Quantidades, rótulos e possibilidades vêm do servidor. A UI não decide jogadas.
  fetch('/api/config').then((response) => { if (!response.ok) throw new Error(); return response.json(); })
    .then((config) => { deckInfo = config; updateDeckSummary(); render(); })
    .catch(() => { /* A configuração também chega ao entrar em uma sala. */ });
  function updateDeckSummary() {
    if (deckInfo) $('#deck-summary').textContent = `${deckInfo.deckSize} cartas. Infinitas possibilidades.`;
  }
  const canAct = () => socket.connected && !busy;
  const isHost = () => room?.meId === room?.hostId;
  const avatar = (player, index) => `<span class="avatar color-${index % 4}" aria-hidden="true">${escape(player.name.slice(0, 1).toUpperCase())}</span>`;

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
  socket.on('disconnect', () => { connection(); render(); });
  socket.on('room:state', (state) => {
    room = state;
    deckInfo = state.config;
    updateDeckSummary();
    storage.set('room', state.code);
    if (selectedCard) {
      if (!room.game?.canPlay || !room.game.playableCardIds.includes(selectedCard.id)) closeLetters();
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
    if (!room) app.innerHTML = home();
    else if (room.phase === 'lobby') app.innerHTML = lobby();
    else if (room.phase === 'finished') app.innerHTML = victory();
    else app.innerHTML = table();
  }

  function home() {
    return `<section class="home-layout">
      <div class="hero-copy"><span class="eyebrow"><span class="little-star">✳</span> UM JOGO PARA CONECTAR</span>
        <h1>Uma letra.<br>Mil <em>possibilidades.</em></h1>
        <p class="hero-description">Junte os amigos, puxe uma cadeira e deixe a palavra crescer. Quem ficar sem cartas primeiro, vence.</p>
        <div class="home-facts"><span>2–8 jogadores</span><span>Em tempo real</span><span>Sem cadastro</span></div>
        <div class="card-scene" aria-hidden="true"><div class="deco-card deco-a"><small>A</small><b>A</b><small>A</small></div><div class="deco-card deco-star"><small>*</small><b>*</b><span>CORINGA</span></div><div class="deco-card deco-z"><small>Z</small><b>Z</b><small>Z</small></div><span class="scene-caption">A próxima letra é sua. →</span></div>
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

  function lobby() {
    const ready = room.players.length === room.settings.playerCount && room.players.every((p) => p.connected);
    return `<section class="room-layout">${roomBar('AQUELE MOMENTO ANTES DA PRIMEIRA CARTA')}
      <div class="lobby-layout"><section class="panel settings-panel"><span class="eyebrow">DO SEU JEITO</span><h2>Prepare a mesa.</h2><p class="muted">${isHost() ? 'Você é o anfitrião. Escolha o tamanho da roda.' : 'O anfitrião está preparando a partida.'}</p>
        <form id="settings-form"><fieldset ${disabled(!isHost() || !canAct())}><label for="player-count">Número de jogadores <span>2 a 8</span></label><select id="player-count" name="playerCount">${Array.from({ length: 7 }, (_, i) => i + 2).map((n) => `<option value="${n}" ${n === room.settings.playerCount ? 'selected' : ''}>${n} jogadores</option>`).join('')}</select>
        <label for="initial-cards">Cartas por pessoa <span id="max-cards">3 a ${room.settings.maxInitialCards}</span></label><input id="initial-cards" name="initialCards" type="number" min="3" max="${room.settings.maxInitialCards}" value="${room.settings.initialCards}" required><p class="field-hint">${room.deckSize} cartas no total. Sempre sobra pelo menos uma para comprar.</p>
        ${isHost() ? '<button class="button secondary full">Salvar configuração <span>✓</span></button>' : ''}</fieldset></form>
        <div class="lobby-tip"><span aria-hidden="true">✳</span><p>Não precisa saber a palavra inteira.<br>Só a próxima letra.</p></div>
      </section>
      <section class="panel players-panel"><div class="section-top"><div><span class="eyebrow">A TURMA</span><h2>Quem está na roda</h2></div><span class="count-badge">${room.players.filter((p) => p.connected).length}/${room.settings.playerCount}</span></div>
        <ul class="player-list">${room.players.map((p, i) => `<li>${avatar(p, i)}<div class="player-info"><strong>${escape(p.name)}${p.id === room.meId ? ' <span class="you-label">(você)</span>' : ''}</strong><small>${p.id === room.hostId ? 'Anfitrião' : 'Na turma'} · ${p.connected ? 'Conectado' : 'Aguardando reconexão'}</small></div><span class="status-dot ${p.connected ? 'connected' : ''}" aria-label="${p.connected ? 'Conectado' : 'Desconectado'}"></span>${isHost() && !p.connected ? `<button class="text-button" data-remove="${p.id}" ${disabled(!canAct())}>Liberar vaga</button>` : ''}</li>`).join('')}${Array.from({ length: Math.max(0, room.settings.playerCount - room.players.length) }, () => '<li class="empty-seat"><span class="avatar">+</span><div class="player-info"><strong>Uma cadeira livre</strong><small>Compartilhe o código da sala</small></div></li>').join('')}</ul>
        <div class="start-area">${isHost() ? `<button class="button primary full" data-action="start" ${disabled(!ready || !canAct())}>Iniciar partida <span>→</span></button><p class="field-hint">${ready ? 'Todo mundo chegou. Pode começar!' : `Aguardando os ${room.settings.playerCount} jogadores ficarem conectados.`}</p>` : '<div class="waiting"><span class="status-dot connected"></span> Aguardando o anfitrião iniciar a partida…</div>'}</div>
      </section></div><p class="room-note">Caiu a conexão? Volte pelo mesmo navegador para retomar sua vaga. O anfitrião pode liberar vagas desconectadas no lobby.</p></section>`;
  }

  function table() {
    const game = room.game;
    const protectedByLife = game.protectedPlayerId === room.meId;
    const current = room.players.find((p) => p.id === game.turnPlayerId);
    const myTurn = game.canPlay && canAct();
    const meIndex = room.players.findIndex((p) => p.id === room.meId);
    const ordered = [...room.players.slice(meIndex + 1), ...room.players.slice(0, meIndex)];
    return `<section class="game-layout">${roomBar('PALAVRAS SE CONSTROEM EM BOA COMPANHIA')}
      <div class="opponents">${ordered.map((p) => { const i = room.players.findIndex((item) => item.id === p.id); return `<div class="opponent ${p.id === game.turnPlayerId ? 'active' : ''} ${!p.connected ? 'offline-player' : ''}">${avatar(p, i)}<div><strong>${escape(p.name)}</strong><span>${p.left ? 'Saiu da sala' : !p.connected ? 'Reconectando…' : `${p.cardCount} carta${p.cardCount === 1 ? '' : 's'}`}</span></div><span class="mini-cards" aria-hidden="true">▥</span></div>`; }).join('')}</div>
      <div class="turn-bar ${myTurn ? 'your-turn' : ''}" role="status"><span class="status-dot connected"></span>${!socket.connected ? 'Reconectando… Suas cartas estão guardadas.' : game.paused ? 'Partida pausada · aguardando outro jogador reconectar' : game.turnPlayerId === room.meId ? (game.noPlayableCards ? 'Sem carta jogável. Você pode usar PERDI ou comprar uma carta.' : 'É a sua vez! Escolha uma carta para jogar.') : `Vez de ${escape(current?.name)}. Prepare sua próxima letra.`}<span class="turn-number">TURNO ${game.turnNumber}</span></div>${game.paused && isHost() ? `<div class="paused-actions"><button class="text-button" data-action="end" ${disabled(!canAct())}>Encerrar partida e voltar à sala →</button></div>` : ''}
      <section class="table-felt" aria-label="Centro da mesa"><div class="felt-caption">CAPILETRAS · A MESA É DE TODOS</div>
        <div class="table-center"><button class="draw-pile ${game.canDraw ? 'available' : ''}" data-action="draw" ${disabled(!game.canDraw || !canAct())} aria-label="Comprar uma carta. ${game.deckCount} cartas na pilha, ${game.discardCount} para reembaralhar."><span class="deck-back" aria-hidden="true"><span>c<span>*</span></span></span><strong>COMPRAR</strong><small>${game.deckCount} na pilha${game.discardCount ? ` · ${game.discardCount} jogadas` : ''}</small></button>
        <div class="word-area"><span class="eyebrow">NOSSA PALAVRA</span><div class="word-display ${game.word ? '' : 'word-empty'}" aria-label="Palavra atual: ${escape(game.word || 'vazia')}">${game.word ? escape(game.word) : 'A primeira letra é com você.'}</div><p>${game.word ? `${game.word.length} letra${game.word.length === 1 ? '' : 's'} e contando…` : 'Uma carta é tudo que precisa para começar.'}</p>${game.blockedLetter ? `<div class="block-badge" role="status">➕🚫 Letra bloqueada: <strong>${game.blockedLetter}</strong><span>até a próxima jogada com letra</span></div>` : ''}${game.extraTurns.length ? `<p class="extra-turn-notice">2x ativo · retorno para ${escape(room.players.find((p) => p.id === game.extraTurns.at(-1))?.name)}</p>` : ''}</div>
        <div class="lose-area"><button class="button lose-button" data-action="lose" aria-describedby="loss-help" title="${protectedByLife ? 'Protegido pela Vida' : 'PERDI'}" ${disabled(!game.canLose || !canAct())}>PERDI <span aria-hidden="true">↺</span></button><p id="loss-help">${protectedByLife ? '<span class="life-protection">Protegido pela Vida ❤️</span>' : `Compre até ${room.config.lossPenalty} cartas.<br>Zere palavra e bloqueio.`}</p></div></div>
        <p class="table-notice" role="status">${escape(room.notice)}</p>
      </section>
      <section class="hand-section" aria-label="Sua mão"><div class="hand-heading"><div><span class="eyebrow">SUAS POSSIBILIDADES</span><h2>Sua mão <span>${room.hand.length} carta${room.hand.length === 1 ? '' : 's'}</span></h2></div><p>${game.drawsThisTurn && game.turnPlayerId === room.meId ? (game.noPlayableCards ? 'Você já comprou e segue sem carta jogável. Use PERDI.' : 'Você já comprou. Agora, baixe uma carta.') : !game.availableCount ? 'Sem cartas para comprar. Escolha uma da mão.' : `Compre até ${room.config.maxDrawsPerTurn} carta por turno, se quiser.`}</p></div>
      <div class="hand-cards">${room.hand.map((card) => cardButton(card, myTurn && game.playableCardIds.includes(card.id))).join('')}</div><p class="hand-note">${myTurn ? (game.noPlayableCards ? 'Sem carta jogável: use PERDI ou compre, se quiser.' : 'Clique em uma carta para jogar.') : 'Sua mão é visível só para você.'} PERDI: última carta jogada ou sua vez sem carta jogável.</p></section>
    </section>`;
  }

  function cardButton(card, enabled) {
    const rule = room.config.cardTypes[card.type];
    const fixed = card.type === 'letter';
    const title = fixed ? card.letter : rule.label;
    // Coração em texto mantém o contraste configurado, sem depender da cor do emoji do sistema.
    const symbol = card.type === 'life' ? '♥' : fixed ? card.letter : rule.symbol;
    const special = !fixed && card.type !== 'wild';
    const reason = room.game.playableCardIds.includes(card.id) ? '' : card.type === 'swap' && !room.game.word ? 'Visor vazio' : card.type === 'double' ? 'Sem jogada anterior' : 'Letra bloqueada';
    return `<button class="playing-card card-${rule.color} ${card.type === 'wild' ? 'wild-card' : ''} ${special ? 'special-card' : ''} ${reason ? 'unplayable-card' : ''}" data-card="${escape(card.id)}" ${disabled(!enabled)} aria-label="Jogar ${escape(title)}${reason ? `: ${reason}` : ''}" title="${escape(reason || title)}"><span class="card-corner">${escape(symbol)}</span><strong class="${special ? 'card-special-title' : ''}">${escape(special && ['swap', 'block', 'double', 'multi', 'life'].includes(card.type) ? symbol : fixed ? title : card.type === 'wild' ? '*' : title)}</strong><span class="card-bottom">${escape(reason || title.toUpperCase())}</span></button>`;
  }

  function victory() {
    const winner = room.players.find((p) => p.id === room.game.winnerId);
    const won = winner.id === room.meId;
    return `<section class="room-layout">${roomBar('FIM DE PARTIDA · COMEÇO DE OUTRA HISTÓRIA')}<section class="victory-panel"><div class="victory-star" aria-hidden="true">✳</div><span class="eyebrow">MÃO VAZIA. SORRISO CHEIO.</span><h1>${won ? 'Essa foi sua!' : `${escape(winner.name)} venceu!`}</h1><p>${won ? 'Você encontrou a última letra e levou a melhor.' : 'A última carta foi jogada. Vale uma revanche?'}</p><div class="final-word"><span>ÚLTIMA PALAVRA DA MESA</span><strong>${escape(room.game.word)}</strong></div><div class="victory-actions">${isHost() ? `<button class="button primary" data-action="start" ${disabled(!canAct())}>Jogar de novo <span>→</span></button><button class="button secondary" data-action="lobby" ${disabled(!canAct())}>Voltar à sala</button>` : '<p class="muted">O anfitrião pode começar outra partida ou voltar à sala.</p><button class="button secondary" data-action="leave" '+disabled(!canAct())+'>Voltar ao início</button>'}</div><p class="field-hint">${isHost() ? 'Para mudar jogadores ou configurações, volte à sala.' : 'Você pode continuar aqui para a próxima rodada.'}</p></section></section>`;
  }

  function closeLetters() {
    selectedCard = null;
    selectedLetter = null;
    selectedBlock = null;
    $('#letter-dialog').close();
    $('#multi-dialog').close();
  }
  function refreshLetterOptions() {
    if (!selectedCard) return;
    if (room.config.cardTypes[selectedCard.type].effect === 'appendMany') { refreshMultiOptions(); return; }
    const choices = room.game.allowedLettersByCard[selectedCard.id] || '';
    if (!choices.includes(selectedLetter)) selectedLetter = null;
    $('#letter-grid').innerHTML = [...alphabet].map((letter) => `<button class="letter-option ${selectedLetter === letter ? 'selected' : ''}" data-letter="${letter}" aria-pressed="${selectedLetter === letter}" ${disabled(!choices.includes(letter))}>${letter}</button>`).join('');
    const block = selectedCard.type === 'block';
    $('#block-picker').hidden = !block;
    if (block) $('#block-grid').innerHTML = [...alphabet].map((letter) => `<button class="letter-option ${selectedBlock === letter ? 'selected' : ''}" data-block="${letter}" aria-pressed="${selectedBlock === letter}">${letter}</button>`).join('');
    $('#confirm-block').disabled = !selectedLetter || !selectedBlock || !canAct();
    $('#letter-hint').textContent = selectedCard.type === 'swap'
      ? `Substitua ${room.game.word.at(-1)} por outra letra. A letra atual e a bloqueada não valem.`
      : `${block ? '1. Letra a adicionar. ' : ''}Letras permitidas: ${[...choices].join(', ')}.`;
  }
  function openLetters(card) {
    selectedCard = card;
    selectedLetter = null;
    selectedBlock = null;
    if (room.config.cardTypes[card.type].effect === 'appendMany') {
      $('#multi-input').value = '';
      refreshMultiOptions();
      $('#multi-dialog').showModal();
      fitMultiDialog();
      $('#multi-input').focus();
      return;
    }
    $('#letter-title').textContent = room.config.cardTypes[card.type].label;
    refreshLetterOptions();
    $('#letter-dialog').showModal();
  }

  function refreshMultiOptions() {
    if (!selectedCard || !room?.game) return;
    const rule = room.config.cardTypes[selectedCard.type];
    const text = $('#multi-input').value;
    const countValid = text.length >= rule.minLetters && text.length <= rule.maxLetters;
    const blocked = room.game.blockedLetter;
    const firstBlocked = Boolean(blocked && text[0] === blocked);
    $('#multi-hint').textContent = `Digite pelo menos ${rule.minLetters} letras de A a Z.`;
    $('#multi-count').textContent = `${text.length}/${rule.maxLetters}`;
    $('#multi-count').classList.toggle('invalid', !countValid && text.length > 0);
    $('#multi-block-warning').hidden = !blocked;
    $('#multi-block-warning').textContent = blocked ? `Letra bloqueada: ${blocked}. A primeira letra não pode ser ${blocked}. Da segunda em diante, ela é permitida.` : '';
    $('#multi-feedback').textContent = firstBlocked ? `Troque a primeira letra: ${blocked} está bloqueada.`
      : text.length < rule.minLetters ? `Faltam ${rule.minLetters - text.length} letra(s) para jogar.`
        : !countValid ? 'Revise a quantidade de letras indicada no contador.' : 'Tudo certo para jogar.';
    $('#multi-input').setAttribute('aria-invalid', String(firstBlocked || (text.length > 0 && !countValid)));
    $('#multi-preview').textContent = room.game.word + text || 'O visor começa aqui…';
    $('#confirm-multi').disabled = !canAct() || !room.game.canPlay || !countValid || firstBlocked || /[^A-Z]/.test(text);
  }

  // O teclado móvel reduz o visualViewport. O corpo rola; a confirmação fica fora dele.
  function fitMultiDialog() {
    const dialog = $('#multi-dialog');
    if (!dialog.open) return;
    const viewport = window.visualViewport;
    const height = viewport?.height || innerHeight;
    dialog.style.setProperty('--modal-top', `${(viewport?.offsetTop || 0) + height / 2}px`);
    dialog.style.setProperty('--modal-height', `${Math.max(120, height - 24)}px`);
  }
  window.visualViewport?.addEventListener('resize', () => {
    fitMultiDialog();
    if ($('#multi-dialog').open && document.activeElement === $('#multi-input')) {
      requestAnimationFrame(() => $('#multi-input').scrollIntoView({ block: 'nearest' }));
    }
  });
  window.visualViewport?.addEventListener('scroll', fitMultiDialog);
  window.addEventListener('resize', fitMultiDialog);
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
    const data = { cardId: selectedCard.id, letter: $('#multi-input').value };
    closeLetters();
    await send('game:play', data);
  });
  $('#close-multi').addEventListener('click', closeLetters);
  $('#multi-dialog').addEventListener('cancel', () => { selectedCard = null; });

  app.addEventListener('input', (event) => {
    if (event.target.id === 'player-name') { name = event.target.value; storage.set('name', name); }
    if (event.target.id === 'room-code') { enteredCode = event.target.value.toUpperCase(); event.target.value = enteredCode; }
    if (event.target.id === 'player-count') {
      const max = Math.floor((room.deckSize - room.config.reservedDrawCards) / Number(event.target.value));
      $('#initial-cards').max = max;
      $('#initial-cards').value = Math.min(Number($('#initial-cards').value), max);
      $('#max-cards').textContent = `3 a ${max}`;
    }
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
    const removeButton = event.target.closest('[data-remove]');
    if (removeButton && !removeButton.disabled) { await send('room:remove', { playerId: removeButton.dataset.remove }); return; }
    const cardElement = event.target.closest('[data-card]');
    if (cardElement && !cardElement.disabled && room?.game?.canPlay && canAct()) {
      const card = room.hand.find((item) => item.id === cardElement.dataset.card);
      if (card.type === 'letter' || card.type === 'double') await send('game:play', { cardId: card.id });
      else openLetters(card);
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    switch (button.dataset.action) {
      case 'create':
        if (!name.trim()) { toast('Primeiro, conte como podemos te chamar.'); $('#player-name').focus(); return; }
        await send('room:create', { sessionId, name }); break;
      case 'start': await send('game:start'); break;
      case 'draw': await send('game:draw'); break;
      case 'lose': await send('game:lose', { version: room.game.version }); break;
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

  $('#letter-grid').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-letter]');
    if (!button || button.disabled || !selectedCard || !canAct()) return;
    if (selectedCard.type === 'block') { selectedLetter = button.dataset.letter; refreshLetterOptions(); return; }
    const cardId = selectedCard.id;
    const letter = button.dataset.letter;
    closeLetters();
    await send('game:play', { cardId, letter });
  });
  $('#block-grid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-block]');
    if (!button || !selectedCard || !canAct()) return;
    selectedBlock = button.dataset.block;
    refreshLetterOptions();
  });
  $('#confirm-block').addEventListener('click', async () => {
    if (!selectedCard || !selectedLetter || !selectedBlock || !canAct()) return;
    const data = { cardId: selectedCard.id, letter: selectedLetter, blockedLetter: selectedBlock };
    closeLetters();
    await send('game:play', data);
  });
  $('#close-letter').addEventListener('click', closeLetters);
  $('#letter-dialog').addEventListener('cancel', () => { selectedCard = null; });
  $('#open-rules').addEventListener('click', () => $('#rules-dialog').showModal());
  $('#close-rules').addEventListener('click', () => $('#rules-dialog').close());
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  render();
})();
