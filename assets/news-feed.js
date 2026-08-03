'use strict';

(() => {
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

  function isDownloadedOriginalImage(item) {
    return typeof item.image === 'string'
      && /^assets\/news\/[a-f0-9]{16}\.(jpg|png|webp|avif|gif)$/i.test(item.image)
      && /^https?:\/\//i.test(item.imageSourceUrl || '');
  }

  function renderCard(item, compact = false) {
    const title = escapeHtml(item.title);
    const summary = escapeHtml(item.summary || '');
    const source = escapeHtml(item.source || 'Источник');
    const image = escapeHtml(item.image);
    const url = escapeHtml(item.url);
    const date = formatDate(item.publishedAt);

    return `<a class="card news-card parsed-news-card" href="${url}" target="_blank" rel="noopener noreferrer">
      <img src="${image}" alt="${title}" loading="lazy">
      <div class="card-body">
        <div class="date">${escapeHtml(date)} · ${source}</div>
        <h3>${title}</h3>
        ${compact || !summary ? '' : `<p>${summary}</p>`}
      </div>
    </a>`;
  }

  function setState(target, text) {
    if (target) target.innerHTML = `<div class="empty">${escapeHtml(text)}</div>`;
  }

  async function loadNews() {
    const response = await fetch(`data/news.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`News request failed: ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : payload.items || [];
  }

  async function renderParsedNews() {
    const home = document.querySelector('#homeNews');
    const page = document.querySelector('#newsPage');

    setState(home, 'Загружаем новости…');
    setState(page, 'Загружаем новости…');

    try {
      const items = (await loadNews())
        .filter(item => item && item.title && item.url && isDownloadedOriginalImage(item))
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      if (!items.length) {
        setState(home, 'Новости обновляются.');
        setState(page, 'Новости обновляются.');
        return;
      }

      if (home) home.innerHTML = items.slice(0, 5).map(item => renderCard(item, true)).join('');
      if (page) page.innerHTML = items.map(item => renderCard(item, false)).join('');
    } catch (error) {
      console.warn('Original-image news feed is unavailable.', error);
      setState(home, 'Новости временно недоступны.');
      setState(page, 'Новости временно недоступны.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderParsedNews, { once: true });
  } else {
    renderParsedNews();
  }
})();
