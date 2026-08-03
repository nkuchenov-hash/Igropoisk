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

  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
  const formatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

  function tags(item) {
    const value = `${item.titleRu || ''} ${item.summaryRu || ''}`.toLowerCase();
    const result = [];
    if (/релиз|выйдет|ранн.*доступ/.test(value)) result.push('Релизы');
    if (/обновлен|патч|сезон|переработ/.test(value)) result.push('Обновления');
    if (/анонс|direct|представ/.test(value)) result.push('Анонсы');
    if (/dlc|дополнен/.test(value)) result.push('DLC');
    if (/монитор|oled|технолог/.test(value)) result.push('Технологии');
    if (/rpg|ролевая/.test(value)) result.push('RPG');
    if (/стратег/.test(value)) result.push('Стратегии');
    if (/silent hill/.test(value)) result.push('Хорроры');
    return [...new Set(result)].slice(0, 3);
  }

  function renderCard(item) {
    const chips = tags(item);
    return `<a class="card news-card news-event-card" href="${escapeHtml(item.primaryUrl)}" target="_blank" rel="noopener noreferrer">
      <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.titleRu)}" loading="lazy">
      <div class="card-body">
        <div class="date">${escapeHtml(formatter.format(new Date(item.publishedAt)))} · ${escapeHtml(item.primarySource || '')}</div>
        ${chips.length ? `<div class="news-card__tags">${chips.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
        <h3>${escapeHtml(item.titleRu)}</h3>
      </div>
    </a>`;
  }

  async function renderCuratedHomeNews() {
    const target = document.querySelector('#homeNews');
    if (!target || !document.documentElement.lang.toLowerCase().startsWith('ru')) return;
    try {
      const response = await fetch(`data/news-home-ru.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      const items = (payload.items || []).slice(0, 12);
      if (items.length !== 12) return;
      target.innerHTML = items.map(renderCard).join('');
    } catch (error) {
      console.warn('Curated home news feed unavailable.', error);
    }
  }

  function loadFullArchive() {
    if (!document.querySelector('link[href*="news-archive-full.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'assets/news-archive-full.css?v=20260803-1';
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[src*="news-archive-full.js"]')) {
      const script = document.createElement('script');
      script.src = 'assets/news-archive-full.js?v=20260803-1';
      script.defer = true;
      document.body.appendChild(script);
    }
  }

  const scheduleRender = () => {
    loadFullArchive();
    setTimeout(renderCuratedHomeNews, 900);
    setTimeout(renderCuratedHomeNews, 2200);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleRender, { once: true });
  else scheduleRender();
})();
