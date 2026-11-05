// Efeitos locais; nenhum timer ou elemento visual faz parte do estado da sala.
export const DRAW_UI = Object.freeze({ durationMs: 500, staggerMs: 120, maxFlights: 12 });
export function drawIncreases(previous, next) {
  if (!previous || previous.code !== next?.code || previous.phase !== 'playing' || !next?.game) return [];
  return next.players.flatMap(player => {
    const old = previous.players.find(p => p.id === player.id);
    const count = old ? Math.max(0, player.cardCount - old.cardCount) : 0;
    return count ? [{ playerId: player.id, count }] : [];
  });
}
export function animateDraws(previous, next, { document = globalThis.document, reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches, artwork = '' } = {}) {
  if (reduced || document?.hidden) return;
  const source = document?.querySelector('.draw-pile .deck-back');
  if (!source) return;
  const from = source.getBoundingClientRect();
  for (const { playerId, count } of drawIncreases(previous, next)) {
    const own = playerId === next.meId;
    const target = own ? document.querySelector('.hand-cards')
      : [...document.querySelectorAll('[data-player-id]')].find(n => n.dataset.playerId === playerId);
    if (!target) continue;
    const to = target.getBoundingClientRect();
    for (let i = 0; i < Math.min(count, DRAW_UI.maxFlights); i++) {
      while (document.querySelectorAll('.draw-flight').length >= DRAW_UI.maxFlights) document.querySelector('.draw-flight').remove();
      const card = document.createElement('span');
      card.className = 'draw-flight card-back'; card.setAttribute('aria-hidden', 'true'); card.innerHTML = artwork;
      Object.assign(card.style, { left: `${from.x}px`, top: `${from.y}px`, width: `${from.width}px`, height: `${from.height}px` });
      document.body.append(card);
      const animation = card.animate?.([
        { transform: 'translate(0, 0) rotate(-5deg)', opacity: own ? 1 : .6 },
        { transform: `translate(${to.x + to.width / 2 - from.x - from.width / 2}px, ${to.y + to.height / 2 - from.y - from.height / 2}px) rotate(9deg) scale(${own ? 1 : .6})`, opacity: 0 },
      ], { duration: DRAW_UI.durationMs, delay: i * DRAW_UI.staggerMs, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
      if (animation) void animation.finished.catch(() => {}).finally(() => card.remove());
      else card.remove();
    }
  }
}
