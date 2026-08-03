'use strict';

(() => {
  const locale = (document.documentElement.lang || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
  const copy = locale === 'en'
    ? { loading: 'Loading news…', empty: 'No news matches these filters.', unavailable: 'News is temporarily unavailable.', all: 'All', ranked: 'Top stories', publisher: 'Official', source: 'Source' }
    : { loading: 'Загружаем новости…', empty: 'По этим фильтрам новостей нет.', unavailable: 'Новости временно недоступны.', all: 'Все', ranked: 'Главное', publisher: 'От издателей', source: 'Источник' };
  const formatter = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  function escapeHtml(value = '') {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function localized(item, field) {
    return item[`${field}${locale === 'en' ? 'En' : 'Ru'}`] || item[field] || '';
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : formatter.format(date);
  }

  function isDownloadedOriginalImage(item) {
    return typeof item.image === 'string' && /^assets\/news\/[a-f0-9-]+\.(jpg|png|webp|avif|gif)$/i.test(item.image) && /^https?:\/\//i.test(item.imageSourceUrl || '');
  }

  function homepageEligible(item) {
    const ageHours = Math.max(0, (Date.now() - new Date(item.publishedAt).getTime()) / 36e5);
    const importance = item.importance || (item.trendScore >= 400 ? 'critical' : item.sourceCount >= 2 ? 'major' : 'normal');
    const ttl = importance === 'critical' ? 168 : importance === 'major' ? 72 : item.type === 'publisher' ? 36 : 48;
    return ageHours <= ttl;
  }

  function renderCard(item, compact = false) {
    const title = escapeHtml(localized(item, 'title'));
    const summary = escapeHtml(localized(item, 'summary'));
    const source = escapeHtml(item.source || copy.source);
    const image = escapeHtml(item.image);
    const url = escapeHtml(item.url);
    const date = formatDate(item.publishedAt);
    const tag = item.type === 'publisher' ? copy.publisher : copy.ranked;
    return `<a class="card news-card parsed-news-card" data-news-type="${escapeHtml(item.type || 'ranked')}" href="${url}" target="_blank" rel="noopener noreferrer">
      <img src="${image}" alt="${title}" loading="lazy">
      <div class="card-body">
        <div class="date"><span class="news-card__tag">${escapeHtml(tag)}</span> · ${escapeHtml(date)} · ${source}</div>
        <h3>${title}</h3>
        ${compact || !summary ? '' : `<p>${summary}</p>`}
      </div>
    </a>`;
  }

  function setState(target, text) {
    if (!target) return;
    target._igInfiniteRailCleanup?.();
    target.innerHTML = `<div class="empty">${escapeHtml(text)}</div>`;
  }

  async function loadJson(path) {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload : payload.items || [];
  }

  function installFilters(page, items) {
    let controls = document.querySelector('#newsFilters');
    if (!controls) {
      controls = document.createElement('div');
      controls.id = 'newsFilters';
      controls.className = 'news-filters';
      page.parentElement?.insertBefore(controls, page);
    }
    controls.innerHTML = [
      ['all', copy.all], ['ranked', copy.ranked], ['publisher', copy.publisher]
    ].map(([value, label], index) => `<button type="button" data-filter="${value}" class="${index === 0 ? 'is-active' : ''}">${escapeHtml(label)}</button>`).join('');
    const apply = type => {
      controls.querySelectorAll('button').forEach(button => button.classList.toggle('is-active', button.dataset.filter === type));
      const filtered = type === 'all' ? items : items.filter(item => (item.type || 'ranked') === type);
      page.innerHTML = filtered.length ? filtered.map(item => renderCard(item, false)).join('') : `<div class="empty">${escapeHtml(copy.empty)}</div>`;
    };
    controls.addEventListener('click', event => {
      const button = event.target.closest('button[data-filter]');
      if (button) apply(button.dataset.filter);
    });
    apply('all');
  }

  async function renderParsedNews() {
    const home = document.querySelector('#homeNews');
    const page = document.querySelector('#newsPage');
    setState(home, copy.loading);
    setState(page, copy.loading);
    try {
      const [ranked, publisher] = await Promise.all([loadJson('data/news.json'), loadJson('data/publisher-news.json')]);
      const items = [
        ...ranked.map(item => ({ ...item, type: item.type || 'ranked' })),
        ...publisher.map(item => ({ ...item, type: 'publisher' }))
      ].filter(item => item && localized(item, 'title') && item.url && isDownloadedOriginalImage(item));
      const byUrl = [...new Map(items.map(item => [item.url, item])).values()];
      const archiveItems = byUrl.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      const homeItems = byUrl.filter(homepageEligible).sort((a, b) => {
        const scoreA = Number(a.trendScore || (a.type === 'publisher' ? 75 : 0));
        const scoreB = Number(b.trendScore || (b.type === 'publisher' ? 75 : 0));
        return scoreB - scoreA || new Date(b.publishedAt) - new Date(a.publishedAt);
      }).slice(0, 12);
      if (home) {
        home.innerHTML = homeItems.length ? homeItems.map(item => renderCard(item, true)).join('') : `<div class="empty">${escapeHtml(copy.empty)}</div>`;
        window.IgropoiskInfiniteRail?.(home);
      }
      if (page) installFilters(page, archiveItems);
    } catch (error) {
      console.warn('News feed is unavailable.', error);
      setState(home, copy.unavailable);
      setState(page, copy.unavailable);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderParsedNews, { once: true });
  else renderParsedNews();
})();
