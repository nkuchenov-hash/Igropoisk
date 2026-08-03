'use strict';

(() => {
  const formatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : formatter.format(date);
  }

  function renderMedia(item, title) {
    if (!item.image) {
      return '<div class="news-card__placeholder" aria-label="У источника нет изображения">Без изображения</div>';
    }
    return `<img src="${escapeHtml(item.image)}" alt="${title}" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;news-card__placeholder&quot;>Без изображения</div>'">`;
  }

  function renderCard(item, compact = false) {
    const title = escapeHtml(item.title);
    const summary = escapeHtml(item.summary || '');
    const source = escapeHtml(item.source || 'Источник');
    const url = escapeHtml(item.url || '#');
    const date = formatDate(item.publishedAt);

    return `<a class="card news-card parsed-news-card" href="${url}" target="_blank" rel="noopener noreferrer">
      ${renderMedia(item, title)}
      <div class="card-body">
        <div class="date">${escapeHtml(date)} · ${source}</div>
        <h3>${title}</h3>
        ${compact || !summary ? '' : `<p>${summary}</p>`}
      </div>
    </a>`;
  }

  async function renderParsedNews() {
    const home = document.querySelector('#homeNews');
    const page = document.querySelector('#newsPage');
    if (!home && !page) return;

    try {
      const response = await fetch(`data/news.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`News request failed: ${response.status}`);
      const payload = await response.json();
      const items = (Array.isArray(payload) ? payload : payload.items || [])
        .filter(item => item && item.title && item.url)
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      if (!items.length) throw new Error('Empty news feed');
      if (home) home.innerHTML = items.slice(0, 5).map(item => renderCard(item, true)).join('');
      if (page) page.innerHTML = items.map(item => renderCard(item, false)).join('');
    } catch (error) {
      console.warn('Parsed news feed is unavailable.', error);
      const message = '<div class="empty">Новости временно недоступны.</div>';
      if (home) home.innerHTML = message;
      if (page) page.innerHTML = message;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderParsedNews, { once: true });
  else renderParsedNews();
})();
