'use strict';

(() => {
  const api = window.IgropoiskNews;
  const root = document.querySelector('[data-news-module="home"]');
  const rail = root?.querySelector('[data-news-home]');
  const controls = root?.querySelector('[data-news-home-controls]');
  if (!api || !root || !rail) return;

  const lang = api.language();
  const copy = api.labels(lang);
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startScroll = 0;

  function ensureArchiveLink() {
    const head = root.querySelector('.section-head');
    if (!head || head.querySelector('[data-news-all-link]')) return;
    const link = document.createElement('a');
    link.className = 'ig-button ig-news__all-link';
    link.dataset.newsAllLink = 'true';
    link.href = api.storyUrl({ id: '' }).replace(/([?&])story=(?:&|$)/, '$1').replace(/[?&]$/, '');
    link.textContent = copy.allNews;
    head.appendChild(link);
  }

  function bindControls() {
    if (!controls || controls.dataset.newsBound === 'true') return;
    controls.dataset.newsBound = 'true';
    controls.addEventListener('click', event => {
      const button = event.target.closest('[data-news-direction]');
      if (!button) return;
      const card = rail.querySelector('.ig-news-card');
      const gap = Number.parseFloat(getComputedStyle(rail).gap) || 16;
      const step = (card?.getBoundingClientRect().width || 360) + gap;
      rail.scrollBy({ left: button.dataset.newsDirection === 'prev' ? -step : step, behavior: 'smooth' });
    });
  }

  function bindMouseDrag() {
    rail.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startScroll = rail.scrollLeft;
      rail.setPointerCapture?.(event.pointerId);
    });
    rail.addEventListener('pointermove', event => {
      if (!dragging) return;
      const delta = event.clientX - startX;
      if (Math.abs(delta) > 6) {
        moved = true;
        rail.classList.add('is-dragging');
      }
      if (moved) rail.scrollLeft = startScroll - delta;
    });
    const finish = event => {
      if (!dragging) return;
      dragging = false;
      rail.releasePointerCapture?.(event.pointerId);
      rail.classList.remove('is-dragging');
      if (moved) {
        rail.dataset.newsDragged = 'true';
        window.setTimeout(() => delete rail.dataset.newsDragged, 0);
      }
    };
    rail.addEventListener('pointerup', finish);
    rail.addEventListener('pointercancel', finish);
    rail.addEventListener('click', event => {
      if (rail.dataset.newsDragged !== 'true') return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  async function render() {
    api.setState(rail, copy.loading);
    try {
      const items = await api.loadHome(lang);
      rail.innerHTML = items.length
        ? items.map(item => api.renderCard(item, { compact: true, lang })).join('')
        : `<div class="ig-empty-state">${api.escapeHtml(copy.empty)}</div>`;
      root.dataset.newsStatus = items.length ? 'ready' : 'empty';
      root.dispatchEvent(new CustomEvent('ig:news:home-ready', { detail: { count: items.length } }));
    } catch (error) {
      console.warn('Home news widget failed.', error);
      root.dataset.newsStatus = 'error';
      api.setState(rail, copy.unavailable, 'error');
    }
  }

  ensureArchiveLink();
  bindControls();
  bindMouseDrag();
  render();
})();
