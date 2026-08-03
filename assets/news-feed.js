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
    return item && item.url && item.publishedAt && localized(item, 'title', lang)
      && typeof item.image === 'string'
      && /^assets\/(news|publisher-news)\/[a-f0-9]{16}\.(jpg|png|webp|avif|gif)$/i.test(item.image)
      && /^https?:\/\//i.test(item.imageSourceUrl || '');
  }

  function labels(lang) {
    return lang === 'ru' ? {
      loading: 'Загружаем новости…', unavailable: 'Новости временно недоступны.', empty: 'Нет новостей по выбранным фильтрам.',
      all: 'Все', main: 'Главное', publisher: 'От издателей', source: 'Источник', search: 'Поиск по новостям',
      official: 'Официально', important: 'Главное', reset: 'Сбросить'
    } : {
      loading: 'Loading news…', unavailable: 'News is temporarily unavailable.', empty: 'No news match the selected filters.',
      all: 'All', main: 'Top stories', publisher: 'From publishers', source: 'Source', search: 'Search news',
      official: 'Official', important: 'Top story', reset: 'Reset'
    };
  }

  function formatDate(value, lang) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : dateFormatters[lang].format(date);
  }

  function renderCard(item, compact, lang) {
    const title = escapeHtml(localized(item, 'title', lang));
    const summary = escapeHtml(localized(item, 'summary', lang));
    const source = escapeHtml(item.publisher || item.source || '');
    const badge = item.type === 'publisher' ? labels(lang).official : item.superImportant || item.mainEligible ? labels(lang).important : '';
    return `<a class="card news-card parsed-news-card" data-news-type="${escapeHtml(item.type || 'industry')}" data-news-source="${source}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
      <img src="${escapeHtml(item.image)}" alt="${title}" loading="lazy">
      <div class="card-body">
        <div class="date">${escapeHtml(formatDate(item.publishedAt, lang))} · ${source}</div>
        ${badge ? `<span class="news-card__badge">${escapeHtml(badge)}</span>` : ''}
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
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : payload.items || [];
  }

  function homeItems(items) {
    const now = Date.now();
    return items.filter(item => {
      if (!item.homeUntil || new Date(item.homeUntil).getTime() <= now) return false;
      return item.type === 'publisher' || item.mainEligible || item.superImportant;
    }).sort((a, b) => {
      const importance = Number(Boolean(b.superImportant)) - Number(Boolean(a.superImportant));
      if (importance) return importance;
      const main = Number(Boolean(b.mainEligible)) - Number(Boolean(a.mainEligible));
      if (main) return main;
      const score = Number(b.trendScore || 0) - Number(a.trendScore || 0);
      return score || new Date(b.publishedAt) - new Date(a.publishedAt);
    }).slice(0, 12);
  }

  function ensureFilters(page, lang) {
    let controls = document.querySelector('#newsFilters');
    if (controls) return controls;
    controls = document.createElement('div');
    controls.id = 'newsFilters';
    controls.className = 'news-filters';
    controls.innerHTML = `<div class="news-filters__types" role="group">
      <button type="button" class="is-active" data-news-filter="all">${labels(lang).all}</button>
      <button type="button" data-news-filter="industry">${labels(lang).main}</button>
      <button type="button" data-news-filter="publisher">${labels(lang).publisher}</button>
    </div>
    <input type="search" data-news-search placeholder="${labels(lang).search}" aria-label="${labels(lang).search}">
    <select data-news-source aria-label="${labels(lang).source}"><option value="">${labels(lang).source}: ${labels(lang).all}</option></select>
    <button type="button" data-news-reset>${labels(lang).reset}</button>`;
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
      if (source && (item.publisher || item.source) !== source) return false;
      const text = `${localized(item, 'title', lang)} ${localized(item, 'summary', lang)} ${item.publisher || item.source || ''}`.toLowerCase();
      return !query || text.includes(query);
    }).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    page.innerHTML = filtered.length ? filtered.map(item => renderCard(item, false, lang)).join('') : `<div class="empty">${escapeHtml(labels(lang).empty)}</div>`;
  }

  function bindFilters(page, lang) {
    const controls = ensureFilters(page, lang);
    const sourceSelect = controls.querySelector('[data-news-source]');
    const sources = [...new Set(allItems.map(item => item.publisher || item.source).filter(Boolean))].sort((a, b) => a.localeCompare(b));
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
      const results = await Promise.allSettled([loadJson('data/news.json'), loadJson('data/publisher-news.json')]);
      const merged = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      allItems = [...new Map(merged.map(item => [item.url, item])).values()].filter(item => validItem(item, lang));
      if (!allItems.length) throw new Error('No localized news available');
      if (home) {
        const selected = homeItems(allItems);
        home.innerHTML = selected.length ? selected.map(item => renderCard(item, true, lang)).join('') : `<div class="empty">${escapeHtml(labels(lang).empty)}</div>`;
        if (selected.length) window.IgropoiskInfiniteRail?.(home);
      }
      if (page) {
        bindFilters(page, lang);
        renderArchive(page, lang);
      }
    } catch (error) {
      console.warn('News feeds are unavailable.', error);
      setState(home, labels(lang).unavailable);
      setState(page, labels(lang).unavailable);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderNews, { once: true });
  else renderNews();
  window.addEventListener('igropoisk:languagechange', renderNews);
  new MutationObserver(mutations => {
    if (mutations.some(item => item.attributeName === 'lang')) renderNews();
  }).observe(document.documentElement, { attributes: true });
})();
