'use strict';

(() => {
  const FALLBACK_IMAGE = 'https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/library_hero.jpg';
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : formatter.format(date);
  }

  function renderCard(item, compact = false) {
    const title = escapeHtml(item.title);
    const summary = escapeHtml(item.summary || '');
    const source = escapeHtml(item.source || 'Источник');
    const image = escapeHtml(item.image || FALLBACK_IMAGE);
    const url = escapeHtml(item.url || '#');
    const date = formatDate(item.publishedAt);

    return `<a class="card news-card parsed-news-card" href="${url}" target="_blank" rel="noopener noreferrer">
      <img src="${image}" alt="${title}" loading="lazy" onerror="this.src='${FALLBACK_IMAGE}'">
      <div class="card-body">
        <div class="date">${escapeHtml(date)} · ${source}</div>
        <h3>${title}</h3>
        ${compact || !summary ? '' : `<p>${summary}</p>`}
      </div>
    </a>`;
  }

  async function loadNews() {
    const response = await fetch(`data/news.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`News request failed: ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : payload.items || [];
  }

  async function renderParsedNews() {
    try {
      const items = (await loadNews())
        .filter(item => item && item.title && item.url)
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      if (!items.length) return;

      const home = document.querySelector('#homeNews');
      const page = document.querySelector('#newsPage');

      if (home) home.innerHTML = items.slice(0, 5).map(item => renderCard(item, true)).join('');
      if (page) page.innerHTML = items.map(item => renderCard(item, false)).join('');
    } catch (error) {
      console.warn('Parsed news feed is unavailable; static fallback remains visible.', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderParsedNews, { once: true });
  } else {
    renderParsedNews();
  }
})();
