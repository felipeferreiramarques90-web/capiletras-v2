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
  let pendingDebtLetters = '';
  let pendingDebtVersion = null;
  let challengeDialogId = null;
  let challengeHistoryGuard = null;
  let challengePreviewTimer;
  let serverClockOffset = 0;
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

  // Identidade visual independente da configuração de regras recebida do servidor.
  function cardArtwork(card) {
    const faces = {
      letter: ['+', card.letter], wild: ['+', '*'], vowel: ['+', 'vogal'],
      consonant: ['+', 'consoante'], first: ['+', 'a-m'], last: ['+', 'n-z'],
      swap: ['🔄', '🔄'], block: ['+', '🚫'], double: ['', '2x'],
      multi: ['2+*', bombSvg()], life: ['♥', '♥'], pass: ['→', '→'],
    };
    const [corner, center] = faces[card.type] || ['', ''];
    return { corner, center: card.type === 'multi' ? center : escape(center) };
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
    room = state;
    if (Number.isFinite(state.serverNow)) serverClockOffset = state.serverNow - Date.now();
    deckInfo = state.config;
    updateDeckSummary();
    storage.set('room', state.code);
    if (selectedCard) {
      if (room.game?.challenge) { closeLetters(); }
      else if (pendingDebtVersion !== null && room.game?.version !== pendingDebtVersion) {
        closeLetters();
        toast('A mesa mudou. Escolha sua carta novamente.');
      } else if (!room.game?.canPlay || !room.game.playableCardIds.includes(selectedCard.id)) closeLetters();
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
    if (!room) app.innerHTML = home();
    else if (room.phase === 'lobby') app.innerHTML = lobby();
    else if (room.phase === 'finished') app.innerHTML = victory();
    else app.innerHTML = table();
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

  function wordHeading(player, finished = false) {
    const ownTurn = !finished && player?.id === room.meId;
    return `<div class="word-turn-label ${ownTurn ? 'own-turn-label' : ''}" role="status">${finished ? 'Vitória de' : 'É a vez de:'} <strong class="word-turn-name">${escape(player?.name)}</strong></div>`;
  }

  function table() {
    const game = room.game;
    const skipReason = game.challenge ? 'Desafio em andamento' : game.pendingVictory ? 'Vitória pendente' : !game.drawsThisTurn && game.availableCount > 0 ? 'Compre uma carta primeiro' : !game.noPlayableCards ? 'Você tem carta jogável' : game.turnPlayerId !== room.meId ? 'Não é a sua vez' : !room.hand.length ? 'Sua mão está vazia' : game.paused ? 'Partida pausada' : `Compre até ${room.config.lossPenalty} cartas e perca a vez.`;
    const current = room.players.find((p) => p.id === game.turnPlayerId);
    const myTurn = game.canPlay && canAct();
    const meIndex = room.players.findIndex((p) => p.id === room.meId);
    const ordered = [...room.players.slice(meIndex + 1), ...room.players.slice(0, meIndex)];
    return `<section class="game-layout">${roomBar('PALAVRAS SE CONSTROEM EM BOA COMPANHIA')}
      <div class="opponents">${ordered.map((p) => { const i = room.players.findIndex((item) => item.id === p.id); return `<div class="opponent ${p.id === game.turnPlayerId ? 'active' : ''} ${!p.connected ? 'offline-player' : ''}">${avatar(p, i)}<div><strong>${escape(p.name)}</strong><span>${p.left ? 'Saiu da sala' : !p.connected ? 'Reconectando…' : `${p.cardCount} carta${p.cardCount === 1 ? '' : 's'}`}</span></div><span class="mini-cards card-back" aria-hidden="true">${capybaraSvg()}</span></div>`; }).join('')}</div>
      <div class="turn-bar ${myTurn ? 'your-turn' : ''}" role="status"><span class="status-dot connected"></span>${!socket.connected ? 'Reconectando… Suas cartas estão guardadas.' : game.challenge ? 'Desafio em andamento · a partida aguarda o resultado.' : game.pendingVictory ? 'Última carta na mesa · vitória pendente.' : game.paused ? 'Partida pausada · aguardando outro jogador reconectar' : game.turnPlayerId === room.meId ? (game.noPlayableCards ? (game.canSkipTurn ? 'Sem carta jogável. Você pode usar Não consigo jogar.' : 'Sem carta jogável. Compre uma carta primeiro.') : 'É a sua vez! Escolha uma carta para jogar.') : `Vez de ${escape(current?.name)}. Prepare sua próxima letra.`}<span class="turn-number">TURNO ${game.turnNumber}</span></div>${game.paused && !game.challenge && !game.pendingVictory && isHost() ? `<div class="paused-actions"><button class="text-button" data-action="end" ${disabled(!canAct())}>Encerrar partida e voltar à sala →</button></div>` : ''}
      <section class="table-felt" aria-label="Centro da mesa"><div class="felt-caption">CAPILETRAS · A MESA É DE TODOS</div>${game.pendingVictory && !game.challenge ? `<section class="pending-victory" aria-label="Vitória pendente"><p id="victory-countdown" role="status"></p><small>${game.pendingVictory.acceptedCount}/${game.pendingVictory.voterCount} aceitaram</small>${game.pendingVictory.playerId !== room.meId ? `<button class="button primary" data-action="accept-victory" ${disabled(!canAct() || !game.pendingVictory.canAccept)}>Aceito a palavra</button>` : '<small>Aguardando os outros jogadores.</small>'}</section>` : ''}
        <div class="table-center"><button class="draw-pile ${game.canDraw ? 'available' : ''}" data-action="draw" ${disabled(!game.canDraw || !canAct())} aria-label="Comprar uma carta. ${game.deckCount} cartas na pilha, ${game.discardCount} para reembaralhar."><span class="deck-back card-back" aria-hidden="true">${capybaraSvg()}</span><strong>COMPRAR</strong><small>${game.deckCount} na pilha${game.discardCount ? ` · ${game.discardCount} jogadas` : ''}</small></button>
        <div class="word-area">${wordHeading(current)}<div class="word-display ${game.word ? '' : 'word-empty'}" aria-label="Palavra atual: ${escape(game.word || 'vazia')}">${game.word ? escape(game.word) : 'A primeira letra é com você.'}</div><p>${game.word ? `${game.word.length} letra${game.word.length === 1 ? '' : 's'} e contando…` : 'Uma carta é tudo que precisa para começar.'}</p>${game.blockedLetter ? `<div class="block-badge" role="status">➕🚫 Letra bloqueada: <strong>${game.blockedLetter}</strong><span>até a próxima jogada com letra</span></div>` : ''}${game.letterDebt.count ? `<div class="debt-badge" role="status"><span aria-hidden="true">→</span> ${escape(room.players.find((p) => p.id === game.letterDebt.playerId)?.name)} deve ${game.letterDebt.count} letra${game.letterDebt.count === 1 ? '' : 's'}</div>` : ''}${game.extraTurns.length ? `<p class="extra-turn-notice">2x ativo · retorno para ${escape(room.players.find((p) => p.id === game.extraTurns.at(-1))?.name)}</p>` : ''}</div>
        <div class="lose-area"><button class="button lose-button skip-button" data-action="skip" aria-describedby="loss-help" ${disabled(!game.canSkipTurn || !canAct())}>Não consigo jogar <span aria-hidden="true">↺</span></button><p id="loss-help">${escape(skipReason)}</p></div></div>
        <div class="challenge-table-actions"><button class="button challenge-button" data-action="challenge" aria-describedby="challenge-help-debt" ${disabled(!canAct() || Boolean(game.challenge) || game.letterDebt.count > 0)}>Duvidar da palavra <span aria-hidden="true">?</span></button>${game.letterDebt.count > 0 ? '<p id="challenge-help-debt" class="challenge-debt-reason" role="status">Há letras acumuladas pendentes.</p>' : '<span id="challenge-help-debt" hidden></span>'}${game.challenge ? '<button class="text-button" data-action="challenge-view">Acompanhar desafio →</button>' : ''}</div>
        <p class="table-notice" role="status">${escape(room.notice)}</p>${game.challengeResult ? `<section class="challenge-result" aria-label="Resultado do desafio"><strong>Resultado do desafio</strong><p>Palavra: ${escape(game.challengeResult.word)}</p>${challengeVotesMarkup(game.challengeResult)}</section>` : ''}
      </section>
      <section class="hand-section" aria-label="Sua mão"><div class="hand-heading"><div><span class="eyebrow">SUAS POSSIBILIDADES</span><h2>Sua mão <span>${room.hand.length} carta${room.hand.length === 1 ? '' : 's'}</span></h2></div><p>${game.drawsThisTurn && game.turnPlayerId === room.meId ? (game.noPlayableCards ? 'Você já comprou e segue sem carta jogável. Use Não consigo jogar.' : 'Você já comprou. Agora, baixe uma carta.') : !game.availableCount ? 'Sem cartas para comprar. Escolha uma da mão.' : `Compre até ${room.config.maxDrawsPerTurn} carta por turno, se quiser.`}</p></div>
      <div class="hand-cards">${room.hand.map((card) => cardButton(card, myTurn && game.playableCardIds.includes(card.id))).join('')}</div><p class="hand-note">${myTurn ? (game.noPlayableCards ? (game.canSkipTurn ? 'Sem carta jogável: use Não consigo jogar.' : 'Sem carta jogável: compre uma carta primeiro.') : 'Clique em uma carta para jogar.') : 'Sua mão é visível só para você.'} Não consigo jogar: só na sua vez, sem carta jogável.</p></section>
    </section>`;
  }

  function cardButton(card, enabled) {
    const rule = room.config.cardTypes[card.type];
    const fixed = card.type === 'letter';
    const title = fixed ? card.letter : rule.label;
    const description = rule.description ? `${title} · ${rule.description}` : title;
    const artwork = cardArtwork(card);
    const special = !fixed && card.type !== 'wild';
    const reason = room.game.playableCardIds.includes(card.id) ? '' : card.type === 'swap' && !room.game.word ? 'Visor vazio' : card.type === 'double' ? 'Sem jogada anterior' : 'Letra bloqueada';
    return `<button class="playing-card card-${rule.color} card-face-${card.type} ${card.type === 'wild' ? 'wild-card' : ''} ${special ? 'special-card' : ''} ${reason ? 'unplayable-card' : ''}" data-card="${escape(card.id)}" ${disabled(!enabled)} aria-label="Jogar ${escape(description)}${reason ? `: ${reason}` : ''}" title="${escape(reason || description)}"><span class="card-corner" aria-hidden="true">${escape(artwork.corner)}</span><strong class="${special ? 'card-special-title' : ''}" aria-hidden="true">${artwork.center}</strong>${card.type === 'pass' ? '<span class="card-corner card-corner-right" aria-hidden="true">→</span>' : ''}<span class="card-bottom">${escape(reason || description.toUpperCase())}</span></button>`;
  }

  function victory() {
    const winner = room.players.find((p) => p.id === room.game.winnerId);
    const won = winner.id === room.meId;
    return `<section class="room-layout">${roomBar('FIM DE PARTIDA · COMEÇO DE OUTRA HISTÓRIA')}<section class="victory-panel"><div class="victory-star" aria-hidden="true">✳</div><span class="eyebrow">MÃO VAZIA. SORRISO CHEIO.</span><h1>${won ? 'Essa foi sua!' : `${escape(winner.name)} venceu!`}</h1><p>${won ? 'Você encontrou a última letra e levou a melhor.' : 'A última carta foi jogada. Vale uma revanche?'}</p><div class="final-word">${wordHeading(winner, true)}<strong>${escape(room.game.word)}</strong></div>${room.game.challengeResult ? `<section class="victory-challenge-result" aria-label="Resultado do desafio">${challengeVotesMarkup(room.game.challengeResult)}<p>${escape(room.notice)}</p></section>` : ''}<div class="victory-actions">${isHost() ? `<button class="button primary" data-action="start" ${disabled(!canAct())}>Jogar de novo <span>→</span></button><button class="button secondary" data-action="lobby" ${disabled(!canAct())}>Voltar à sala</button>` : '<p class="muted">O anfitrião pode começar outra partida ou voltar à sala.</p><button class="button secondary" data-action="leave" '+disabled(!canAct())+'>Voltar ao início</button>'}</div><p class="field-hint">${isHost() ? 'Para mudar jogadores ou configurações, volte à sala.' : 'Você pode continuar aqui para a próxima rodada.'}</p></section></section>`;
  }

  function closeLetters() {
    selectedCard = null;
    selectedLetter = null;
    selectedBlock = null;
    pendingDebtLetters = '';
    pendingDebtVersion = null;
    $('#debt-dialog').close();
    $('#letter-dialog').close();
    $('#multi-dialog').close();
  }
  function refreshLetterOptions() {
    if (!selectedCard) return;
    if (room.config.cardTypes[selectedCard.type].effect === 'appendMany') { refreshMultiOptions(); return; }
    let choices = room.game.allowedLettersByCard[selectedCard.id] || '';
    if (selectedCard.type === 'swap' && pendingDebtLetters) choices = [...choices].filter((letter) => letter !== pendingDebtLetters.at(-1)).join('');
    if (!choices.includes(selectedLetter)) selectedLetter = null;
    $('#letter-grid').innerHTML = [...alphabet].map((letter) => `<button class="letter-option ${selectedLetter === letter ? 'selected' : ''}" data-letter="${letter}" aria-pressed="${selectedLetter === letter}" ${disabled(!choices.includes(letter))}>${letter}</button>`).join('');
    const block = selectedCard.type === 'block';
    $('#block-picker').hidden = !block;
    if (block) $('#block-grid').innerHTML = [...alphabet].map((letter) => `<button class="letter-option ${selectedBlock === letter ? 'selected' : ''}" data-block="${letter}" aria-pressed="${selectedBlock === letter}">${letter}</button>`).join('');
    $('#confirm-block').disabled = !selectedLetter || !selectedBlock || !canAct();
    $('#letter-hint').textContent = selectedCard.type === 'swap'
      ? `Substitua ${(room.game.word + pendingDebtLetters).at(-1)} por outra letra. A letra substituída não vale${pendingDebtLetters ? '' : ', nem a bloqueada'}.`
      : `${block ? '1. Letra a adicionar. ' : ''}Letras permitidas: ${[...choices].join(', ')}.`;
    if (pendingDebtLetters) $('#letter-hint').textContent = `Letras acumuladas: ${pendingDebtLetters}. ` + $('#letter-hint').textContent;
  }
  function openLetters(card) {
    $('#letter-dialog').dataset.cardTheme = card.type;
    selectedCard = card;
    selectedLetter = null;
    selectedBlock = null;
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
    const data = { version: room.game.version, cardId: selectedCard.id, letter, blockedLetter, accumulatedLetters: pendingDebtLetters };
    closeLetters();
    await send('game:play', data);
  }
  async function chooseCard(card) {
    selectedCard = card;
    const effect = room.config.cardTypes[card.type].effect;
    if (effect === 'pass' || effect === 'replay' || card.type === 'letter') await submitSelectedCard();
    else openLetters(card);
  }
  function beginDebt(card) {
    $('#debt-dialog').dataset.cardTheme = card.type;
    closeLetters();
    selectedCard = card;
    pendingDebtVersion = room.game.version;
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
      const effect = room.config.cardTypes[card.type].effect;
      if (debtCount() > 0 && effect !== 'pass' && effect !== 'replay') beginDebt(card);
      else { closeLetters(); await chooseCard(card); }
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    switch (button.dataset.action) {
      case 'create':
        if (!name.trim()) { toast('Primeiro, conte como podemos te chamar.'); $('#player-name').focus(); return; }
        await send('room:create', { sessionId, name }); break;
      case 'start': await send('game:start'); break;
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

  function challengeVotesMarkup(result) {
    const tally = result.tally;
    if (!tally) return '<p>Desafio encerrado sem votação.</p>';
    return `<p>${tally.rejected ? 'Palavra recusada' : 'Palavra aceita'} · ${tally.yes} Sim / ${tally.no} Não${tally.early ? ` · Encerrada antecipadamente (${tally.pending} dispensados)` : ''}</p><ul class="challenge-vote-list">${Object.entries(result.votes).map(([id, vote]) => `<li><span>${escape(room.players.find((p) => p.id === id)?.name || 'Jogador')}</span><strong>${vote === 'sim' ? 'Sim' : 'Não'}</strong></li>`).join('')}</ul>`;
  }

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
    $('#challenge-timer').textContent = `${remaining}s · ${completing ? 'para completar' : 'para votar'}`;
    const challenged = room.players.find((p) => p.id === challenge.challengedId);
    $('#challenge-auto-loss').hidden = !completing;
    $('#challenge-auto-loss').textContent = completing ? `Se ${challenged?.name} não apertar OK em ${remaining}s, perde automaticamente.` : '';
    const mine = challenge.challengedId === room.meId;
    $('#challenge-input').readOnly = !mine || !completing || remaining === 0 || !canAct();
    $('#challenge-ok').disabled = !canAct() || !completing || remaining === 0;
    $('#challenge-loss').disabled = !canAct() || voting || remaining === 0;
    for (const button of document.querySelectorAll('[data-vote]')) button.disabled = !canAct() || !challenge.canVote || remaining === 0;
  }

  function refreshChallengePreview() {
    const challenge = room?.game?.challenge;
    if (!challenge) return;
    const text = challenge.challengedId === room.meId && challenge.phase === 'completando' ? $('#challenge-input').value : challenge.addedLetters;
    $('#challenge-count').textContent = `${text.length}/${room.config.challenge.maxLetters}`;
    $('#challenge-word').textContent = challenge.baseWord + text;
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
      $('#challenge-input').value = challenge.addedLetters;
    } else if (!mine) $('#challenge-input').value = challenge.addedLetters;
    const nameOf = (id) => room.players.find((p) => p.id === id)?.name || 'Jogador';
    $('#challenge-title').textContent = completing ? 'Completar a palavra' : 'Aceitar palavra?';
    $('#challenge-description').textContent = `${nameOf(challenge.challengerId)} desafia ${nameOf(challenge.challengedId)} a completar a palavra. ${mine ? 'Você é o desafiado e não vota.' : 'Acompanhe a palavra em tempo real.'}`;
    $('#challenge-input').maxLength = room.config.challenge.maxLetters;
    $('#challenge-edit').hidden = !completing;
    $('#challenge-ok').hidden = !mine || !completing;
    $('#challenge-loss').hidden = !mine || voting;
    $('#challenge-vote-actions').hidden = !voting || !challenge.canVote;
    $('#challenge-progress').textContent = voting ? `${challenge.respondedCount}/${challenge.voterCount} responderam. ${challenge.hasVoted ? 'Seu voto foi registrado.' : ''} Os votos ficam ocultos até o resultado.` : (mine ? 'Complete a palavra ou use PERDI.' : 'Só o desafiado pode completar ou usar PERDI.');
    $('#challenge-votes').innerHTML = challenge.tally ? challengeVotesMarkup(challenge) : '';
    $('#challenge-action-help').textContent = voting ? (mine ? 'Você não vota. Aguarde o resultado.' : challenge.hasVoted ? 'Aguarde os demais votantes.' : 'Não responder no prazo ou estar desconectado conta como Sim.') : 'As ações da partida ficam suspensas durante o desafio.';
    refreshChallengePreview();
    updateChallengeClock();
    guardChallengeHistory(challenge.id);
    if (!dialog.open) {
      dialog.showModal();
      fitTextDialogs();
      if (mine && completing) $('#challenge-input').focus();
    }
  }

  $('#challenge-input').addEventListener('input', () => {
    const challenge = room?.game?.challenge;
    if (!challenge || challenge.challengedId !== room.meId || challenge.phase !== 'completando') return;
    const input = $('#challenge-input');
    input.value = input.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, room.config.challenge.maxLetters);
    refreshChallengePreview();
    clearTimeout(challengePreviewTimer);
    const challengeId = challenge.id, letters = input.value;
    challengePreviewTimer = setTimeout(async () => {
      if (!socket.connected || room?.game?.challenge?.id !== challengeId || room.game.challenge.phase !== 'completando') return;
      try {
        const response = await socket.timeout(10_000).emitWithAck('challenge:preview', { challengeId, letters });
        if (!response.ok && room?.game?.challenge?.id === challengeId && room.game.challenge.phase === 'completando') toast(response.error);
      } catch { /* O OK envia o texto completo; uma prévia perdida não confirma a jogada. */ }
    }, room.config.challenge.previewIntervalMs);
  });
  $('#challenge-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('#challenge-ok').disabled || $('#challenge-ok').hidden) return;
    clearTimeout(challengePreviewTimer);
    await send('challenge:confirm', { challengeId: room.game.challenge.id, letters: $('#challenge-input').value });
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
  $('#block-grid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-block]');
    if (!button || !selectedCard || !canAct()) return;
    selectedBlock = button.dataset.block;
    refreshLetterOptions();
  });
  $('#confirm-block').addEventListener('click', async () => {
    if (!selectedCard || !selectedLetter || !selectedBlock || !canAct()) return;
    await submitSelectedCard(selectedLetter, selectedBlock);
  });
  $('#close-letter').addEventListener('click', closeLetters);
  $('#letter-dialog').addEventListener('cancel', closeLetters);
  $('#open-rules').addEventListener('click', () => $('#rules-dialog').showModal());
  $('#close-rules').addEventListener('click', () => $('#rules-dialog').close());
  for (const dialog of document.querySelectorAll('dialog:not(#challenge-dialog)')) dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) { if (dialog.id === 'rules-dialog') dialog.close(); else closeLetters(); } } });
  render();
})();
