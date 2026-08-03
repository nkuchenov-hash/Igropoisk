'use strict';

(() => {
  const trustedMedia = new Set(['Игромания','StopGame','IGN','GameSpot','Eurogamer','VGC','PC Gamer','GamesRadar+','Polygon','Rock Paper Shotgun','Ars Technica','PlayGround.ru']);
  const formatters = {
    ru: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }),
    en: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' })
  };
  let allItems = [];
  let activeTag = '';

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = (value = '') => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const hasCyrillic = value => /[А-Яа-яЁё]/.test(value || '');

  function language() {
    return (document.documentElement.lang || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
  }

  function text(item, field, lang) {
    const localized = String(item[`${field}${lang === 'ru' ? 'Ru' : 'En'}`] || '').trim();
    if (lang === 'ru' && localized && !hasCyrillic(localized) && field === 'title') return '';
    return localized;
  }

  function labels(lang) {
    return lang === 'ru'
      ? { loading:'Загружаем новости…', unavailable:'Новости временно недоступны.', empty:'По выбранным тегам новостей нет.', search:'Найти игру, студию или тему', all:'Все новости', official:'От разработчиков' }
      : { loading:'Loading news…', unavailable:'News is temporarily unavailable.', empty:'No news matches these tags.', search:'Search games, studios or topics', all:'All news', official:'From developers' };
  }

  function valid(item, lang) {
    return item && /^https?:\/\//i.test(item.primaryUrl || '') && item.publishedAt && text(item,'title',lang)
      && /^assets\/(news|publisher-news)\/[a-f0-9]{16}\.(jpg|png|webp|avif|gif)$/i.test(item.image || '');
  }

  function sourceName(item) {
    return item.primarySource || item.sources?.[0]?.name || '';
  }

  function deriveTags(item, lang) {
    const body = `${text(item,'title',lang)} ${text(item,'summary',lang)}`.toLowerCase();
    const tags = [];
    if (item.game) tags.push(item.game);
    const organization = item.sources?.find(source => source.official)?.organization;
    if (organization && organization !== item.game) tags.push(organization);
    const groups = lang === 'ru' ? [
      ['Релизы', /релиз|вышел|вышла|выходит|дата выхода|ранн.*доступ/],
      ['Обновления', /патч|обновлен|хотфикс|сезон|update/],
      ['Анонсы', /анонс|представил|трейлер|показал|direct/],
      ['DLC', /\bdlc\b|дополнен|expansion/],
      ['Индустрия', /студи|издател|увольнен|закрыт|поглощен|продаж|директор/],
      ['Технологии', /движок|график|видеокарт|драйвер|unreal|unity|oled|желез/],
      ['RPG', /\brpg\b|ролевая|ролевой/],
      ['Стратегии', /стратег|\brts\b/],
      ['Шутеры', /шутер|shoot/],
      ['Симуляторы', /симулятор|simulator/],
      ['Хорроры', /хоррор|horror/]
    ] : [
      ['Releases', /release|launch|early access/], ['Updates', /patch|update|hotfix|season/], ['Announcements', /announce|trailer|reveal|direct/], ['DLC', /\bdlc\b|expansion/], ['Industry', /studio|publisher|layoff|acquisition|sales|director/], ['Technology', /engine|graphics|gpu|driver|unreal|unity|oled/], ['RPG', /\brpg\b/], ['Strategy', /strategy|\brts\b/], ['Shooters', /shooter/], ['Simulation', /simulator/], ['Horror', /horror/]
    ];
    groups.forEach(([tag, pattern]) => { if (pattern.test(body)) tags.push(tag); });
    if (item.type === 'official') tags.push(labels(lang).official);
    return [...new Set(tags)].slice(0, 5);
  }

  function normalizedItem(item, official = false) {
    const source = item.publisher || item.organization || item.source || '';
    return {
      ...item,
      type: official ? 'official' : (item.type || 'ranked'),
      primaryUrl: item.primaryUrl || item.url,
      primarySource: item.primarySource || source,
      titleRu: item.titleRu || item.title || '', titleEn: item.titleEn || item.title || '',
      summaryRu: item.summaryRu || item.summary || '', summaryEn: item.summaryEn || item.summary || '',
      mediaSourceCount: Number(item.mediaSourceCount || item.sourceCount || 1),
      sources: item.sources || [{ name: source, organization: item.organization || item.publisher || '', official }],
      homeUntil: item.homeUntil || new Date(new Date(item.publishedAt).getTime() + 72 * 3600e3).toISOString()
    };
  }

  async function loadJson(path) {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : payload.items || [];
  }

  async function loadItems() {
    try {
      const events = await loadJson('data/news-events.json');
      if (events.length) return events.map(item => normalizedItem(item, item.type === 'official'));
    } catch {}
    const [news, official] = await Promise.allSettled([loadJson('data/news.json'), loadJson('data/publisher-news.json')]);
    return [
      ...(news.status === 'fulfilled' ? news.value.map(item => normalizedItem(item, false)) : []),
      ...(official.status === 'fulfilled' ? official.value.map(item => normalizedItem(item, true)) : [])
    ];
  }

  function homeEligible(item) {
    if (new Date(item.homeUntil || 0).getTime() < Date.now()) return false;
    const sources = item.sources || [];
    const trusted = sources.some(source => trustedMedia.has(source.name));
    const official = item.type === 'official' || sources.some(source => source.official);
    return official || trusted || Number(item.mediaSourceCount || 0) >= 2;
  }

  function score(item) {
    return (item.importance === 'critical' ? 1000 : item.importance === 'major' ? 400 : 0)
      + Number(item.trendScore || 0)
      + (item.type === 'official' ? 80 : 0);
  }

  function renderCard(item, compact, lang) {
    const title = escapeHtml(text(item,'title',lang));
    const summary = escapeHtml(text(item,'summary',lang));
    const tags = deriveTags(item, lang);
    return `<a class="card news-card news-event-card" href="${escapeHtml(item.primaryUrl)}" target="_blank" rel="noopener noreferrer">
      <img src="${escapeHtml(item.image)}" alt="${title}" loading="lazy">
      <div class="card-body">
        <div class="date">${escapeHtml(formatters[lang].format(new Date(item.publishedAt)))} · ${escapeHtml(sourceName(item))}</div>
        <div class="news-card__tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        <h3>${title}</h3>
        ${compact || !summary ? '' : `<p>${summary}</p>`}
      </div>
    </a>`;
  }

  function setState(target, value) {
    if (target) target.innerHTML = `<div class="empty">${escapeHtml(value)}</div>`;
  }

  function buildFilters(page, lang) {
    let controls = $('#newsFilters');
    if (!controls) {
      controls = document.createElement('div');
      controls.id = 'newsFilters';
      controls.className = 'news-toolbar';
      page.before(controls);
    }
    const frequencies = new Map();
    allItems.flatMap(item => deriveTags(item, lang)).forEach(tag => frequencies.set(tag, (frequencies.get(tag) || 0) + 1));
    const tags = [...frequencies].sort((a,b) => b[1] - a[1]).slice(0, 12).map(([tag]) => tag);
    controls.innerHTML = `<div class="news-toolbar__top"><input type="search" data-news-search placeholder="${labels(lang).search}"></div><div class="news-tag-filter"><button class="is-active" data-tag="">${labels(lang).all}</button>${tags.map(tag => `<button data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')}</div>`;
    controls.addEventListener('click', event => {
      const button = event.target.closest('[data-tag]');
      if (!button) return;
      activeTag = button.dataset.tag || '';
      controls.querySelectorAll('[data-tag]').forEach(item => item.classList.toggle('is-active', item === button));
      renderArchive(page, lang);
    });
    $('[data-news-search]', controls).addEventListener('input', () => renderArchive(page, lang));
  }

  function renderArchive(page, lang) {
    const query = ($('[data-news-search]', $('#newsFilters'))?.value || '').trim().toLowerCase();
    const filtered = allItems.filter(item => {
      const tags = deriveTags(item, lang);
      if (activeTag && !tags.includes(activeTag)) return false;
      const haystack = `${text(item,'title',lang)} ${text(item,'summary',lang)} ${tags.join(' ')} ${sourceName(item)}`.toLowerCase();
      return !query || haystack.includes(query);
    }).sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    page.innerHTML = filtered.length ? filtered.map(item => renderCard(item, false, lang)).join('') : `<div class="empty">${labels(lang).empty}</div>`;
  }

  async function render() {
    const lang = language();
    const home = $('#homeNews');
    const page = $('#newsPage');
    setState(home, labels(lang).loading);
    setState(page, labels(lang).loading);
    try {
      allItems = (await loadItems()).filter(item => valid(item, lang));
      const homeItems = allItems.filter(homeEligible).sort((a,b) => score(b) - score(a) || new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 12);
      if (home) home.innerHTML = homeItems.length ? homeItems.map(item => renderCard(item, true, lang)).join('') : `<div class="empty">${labels(lang).empty}</div>`;
      if (page) { buildFilters(page, lang); renderArchive(page, lang); }
    } catch (error) {
      console.warn(error);
      setState(home, labels(lang).unavailable);
      setState(page, labels(lang).unavailable);
    }
  }

  document.addEventListener('click', event => {
    const card = event.target.closest('a.news-event-card[href]');
    if (!card || event.defaultPrevented) return;
    event.stopPropagation();
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true }); else render();
})();
