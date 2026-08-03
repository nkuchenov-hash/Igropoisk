'use strict';

(() => {
  const dateFormatters = {
    ru: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
    en: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  };
  let allItems = [];

  function escapeHtml(value = '') {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function currentLanguage() {
    const htmlLang = (document.documentElement.lang || '').toLowerCase();
    if (htmlLang.startsWith('en')) return 'en';
    const stored = String(localStorage.getItem('igropoisk-language') || localStorage.getItem('language') || '').toLowerCase();
    return stored.startsWith('en') ? 'en' : 'ru';
  }
  function localized(item, field, lang) {
    const value = item[`${field}${lang === 'ru' ? 'Ru' : 'En'}`];
    return typeof value === 'string' ? value.trim() : '';
  }
  function validItem(item, lang) {
    return item && item.primaryUrl && item.publishedAt && localized(item, 'title', lang)
      && typeof item.image === 'string'
      && /^assets\/(news|publisher-news)\/[a-f0-9]{16}\.(jpg|png|webp|avif|gif)$/i.test(item.image)
      && /^https?:\/\//i.test(item.imageSourceUrl || '');
  }
  function labels(lang) {
    return lang === 'ru' ? {
      loading: 'Загружаем новости…', unavailable: 'Новости временно недоступны.', empty: 'Нет событий по выбранным фильтрам.',
      all: 'Все', main: 'Главное', official: 'Официальные', confirmed: 'Подтверждённые', source: 'Источник', search: 'Поиск по событиям',
      critical: 'Сверхважно', major: 'Важное', sources: 'источников', oneSource: 'источник', reset: 'Сбросить', game: 'Игра'
    } : {
      loading: 'Loading news…', unavailable: 'News is temporarily unavailable.', empty: 'No events match the selected filters.',
      all: 'All', main: 'Top stories', official: 'Official', confirmed: 'Confirmed', source: 'Source', search: 'Search events',
      critical: 'Critical', major: 'Important', sources: 'sources', oneSource: 'source', reset: 'Reset', game: 'Game'
    };
  }
  function formatDate(value, lang) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : dateFormatters[lang].format(date);
  }
  function sourceLabel(item) { return item.primarySource || item.sources?.[0]?.name || ''; }
  function renderCard(item, compact, lang) {
    const copy = labels(lang);
    const title = escapeHtml(localized(item, 'title', lang));
    const summary = escapeHtml(localized(item, 'summary', lang));
    const source = escapeHtml(sourceLabel(item));
    const totalSources = Array.isArray(item.sources) ? item.sources.length : 1;
    const badge = item.importance === 'critical' ? copy.critical : item.importance === 'major' ? copy.major : item.type === 'official' ? copy.official : item.type === 'confirmed' ? copy.confirmed : '';
    const sourceCount = totalSources > 1 ? `${totalSources} ${copy.sources}` : `1 ${copy.oneSource}`;
    const game = item.game ? ` · ${copy.game}: ${escapeHtml(item.game)}` : '';
    return `<a class="card news-card parsed-news-card news-event-card" data-news-type="${escapeHtml(item.type || 'ranked')}" data-news-source="${source}" href="${escapeHtml(item.primaryUrl)}" target="_blank" rel="noopener noreferrer">
      <img src="${escapeHtml(item.image)}" alt="${title}" loading="lazy">
      <div class="card-body">
        <div class="date">${escapeHtml(formatDate(item.publishedAt, lang))} · ${source}${game}</div>
        ${badge ? `<span class="news-card__badge">${escapeHtml(badge)}</span>` : ''}
        <h3>${title}</h3>
        ${compact || !summary ? '' : `<p>${summary}</p>`}
        <div class="news-event-card__sources">${escapeHtml(sourceCount)}</div>
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
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : payload.items || [];
  }
  function legacyToEvent(item, official) {
    const sourceName = item.publisher || item.organization || item.source || '';
    const importance = item.superImportant || Number(item.trendScore || 0) >= 400 ? 'critical' : item.mainEligible || Number(item.sourceCount || 0) >= 2 ? 'major' : 'normal';
    return {
      id: item.id, type: official ? 'official' : 'ranked', importance,
      titleRu: item.titleRu || item.title || '', titleEn: item.titleEn || item.title || '',
      summaryRu: item.summaryRu || item.summary || '', summaryEn: item.summaryEn || item.summary || '',
      publishedAt: item.publishedAt, game: item.game || '', image: item.image, imageSourceUrl: item.imageSourceUrl,
      primaryUrl: item.url, primarySource: sourceName, trendScore: Number(item.trendScore || 0),
      sources: [{ name: sourceName, organization: item.organization || item.publisher || '', kind: official ? 'official' : 'media', url: item.url, official }],
      homeUntil: item.homeUntil || new Date(new Date(item.publishedAt).getTime() + (official ? 36 : importance === 'critical' ? 168 : importance === 'major' ? 72 : 48) * 3600e3).toISOString()
    };
  }
  async function loadEvents() {
    try {
      const events = await loadJson('data/news-events.json');
      if (events.length) return events;
    } catch (error) {
      console.warn('Event index is not ready; using source feeds.', error);
    }
    const results = await Promise.allSettled([loadJson('data/news.json'), loadJson('data/publisher-news.json')]);
    const ranked = results[0].status === 'fulfilled' ? results[0].value.map(item => legacyToEvent(item, false)) : [];
    const official = results[1].status === 'fulfilled' ? results[1].value.map(item => legacyToEvent(item, true)) : [];
    return [...ranked, ...official];
  }
  function homeItems(items) {
    const now = Date.now();
    return items.filter(item => new Date(item.homeUntil || 0).getTime() > now)
      .sort((a, b) => {
        const weights = { critical: 3, major: 2, normal: 1 };
        return (weights[b.importance] || 0) - (weights[a.importance] || 0)
          || Number(b.trendScore || 0) - Number(a.trendScore || 0)
          || new Date(b.publishedAt) - new Date(a.publishedAt);
      }).slice(0, 12);
  }
  function ensureFilters(page, lang) {
    let controls = document.querySelector('#newsFilters');
    if (controls) return controls;
    const copy = labels(lang);
    controls = document.createElement('div');
    controls.id = 'newsFilters';
    controls.className = 'news-filters';
    controls.innerHTML = `<div class="news-filters__types" role="group">
      <button type="button" class="is-active" data-news-filter="all">${copy.all}</button>
      <button type="button" data-news-filter="ranked">${copy.main}</button>
      <button type="button" data-news-filter="confirmed">${copy.confirmed}</button>
      <button type="button" data-news-filter="official">${copy.official}</button>
    </div>
    <input type="search" data-news-search placeholder="${copy.search}" aria-label="${copy.search}">
    <select data-news-source aria-label="${copy.source}"><option value="">${copy.source}: ${copy.all}</option></select>
    <button type="button" data-news-reset>${copy.reset}</button>`;
    page.parentNode.insertBefore(controls, page);
    return controls;
  }
  function renderArchive(page, lang) {
    const controls = ensureFilters(page, lang);
    const active = controls.querySelector('[data-news-filter].is-active')?.dataset.newsFilter || 'all';
    const query = controls.querySelector('[data-news-search]')?.value.trim().toLowerCase() || '';
    const source = controls.querySelector('[data-news-source]')?.value || '';
    const filtered = allItems.filter(item => {
      if (active !== 'all' && item.type !== active) return false;
      const names = (item.sources || []).map(entry => entry.name).filter(Boolean);
      if (source && !names.includes(source)) return false;
      const text = `${localized(item, 'title', lang)} ${localized(item, 'summary', lang)} ${item.game || ''} ${names.join(' ')}`.toLowerCase();
      return !query || text.includes(query);
    }).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    page.innerHTML = filtered.length ? filtered.map(item => renderCard(item, false, lang)).join('') : `<div class="empty">${escapeHtml(labels(lang).empty)}</div>`;
  }
  function bindFilters(page, lang) {
    const controls = ensureFilters(page, lang);
    const sourceSelect = controls.querySelector('[data-news-source]');
    const sources = [...new Set(allItems.flatMap(item => (item.sources || []).map(entry => entry.name)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    sourceSelect.innerHTML = `<option value="">${labels(lang).source}: ${labels(lang).all}</option>${sources.map(source => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join('')}`;
    controls.querySelectorAll('[data-news-filter]').forEach(button => button.addEventListener('click', () => {
      controls.querySelectorAll('[data-news-filter]').forEach(item => item.classList.toggle('is-active', item === button));
      renderArchive(page, lang);
    }));
    controls.querySelector('[data-news-search]').addEventListener('input', () => renderArchive(page, lang));
    sourceSelect.addEventListener('change', () => renderArchive(page, lang));
    controls.querySelector('[data-news-reset]').addEventListener('click', () => {
      controls.querySelectorAll('[data-news-filter]').forEach((item, index) => item.classList.toggle('is-active', index === 0));
      controls.querySelector('[data-news-search]').value = '';
      sourceSelect.value = '';
      renderArchive(page, lang);
    });
  }
  async function renderNews() {
    const lang = currentLanguage();
    const home = document.querySelector('#homeNews');
    const page = document.querySelector('#newsPage');
    setState(home, labels(lang).loading);
    setState(page, labels(lang).loading);
    try {
      allItems = (await loadEvents()).filter(item => validItem(item, lang));
      if (!allItems.length) throw new Error('No localized events available');
      if (home) {
        const selected = homeItems(allItems);
        home.innerHTML = selected.length ? selected.map(item => renderCard(item, true, lang)).join('') : `<div class="empty">${escapeHtml(labels(lang).empty)}</div>`;
        if (selected.length) window.IgropoiskInfiniteRail?.(home);
      }
      if (page) { bindFilters(page, lang); renderArchive(page, lang); }
    } catch (error) {
      console.warn('News event feed is unavailable.', error);
      setState(home, labels(lang).unavailable);
      setState(page, labels(lang).unavailable);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderNews, { once: true }); else renderNews();
  window.addEventListener('igropoisk:languagechange', renderNews);
  new MutationObserver(mutations => { if (mutations.some(item => item.attributeName === 'lang')) renderNews(); }).observe(document.documentElement, { attributes: true });
})();
