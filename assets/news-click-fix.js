'use strict';

(() => {
  let pointerDown = null;

  document.addEventListener('pointerdown', event => {
    const card = event.target.closest('.news-card, .news-event-card');
    if (!card) return;
    pointerDown = { x: event.clientX, y: event.clientY, card };
  }, true);

  document.addEventListener('click', event => {
    const card = event.target.closest('.news-card, .news-event-card');
    if (!card) return;

    const href = card.getAttribute('href') || card.dataset.href || card.dataset.url;
    if (!href || !/^https?:\/\//i.test(href)) return;

    const dragged = pointerDown && pointerDown.card === card
      && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 8;
    pointerDown = null;
    if (dragged) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.open(href, '_blank', 'noopener,noreferrer');
  }, true);
})();
