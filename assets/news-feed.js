'use strict';

(() => {
  const trustedMedia = new Set(['Игромания','StopGame','IGN','GameSpot','Eurogamer','VGC','PC Gamer','GamesRadar+','Polygon','Rock Paper Shotgun','Ars Technica','PlayGround.ru']);
  const formatters = {
    ru: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }),
    en: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' })
  };
  const countryRegions = {
    RU:'cis',KZ:'cis',BY:'cis',AM:'cis',AZ:'cis',GE:'cis',KG:'cis',MD:'cis',TJ:'cis',TM:'cis',UZ:'cis',
    US:'north-america',CA:'north-america',MX:'north-america',
    JP:'japan',KR:'korea',CN:'china',HK:'china',MO:'china',TW:'china',
    BR:'latam',AR:'latam',CL:'latam',CO:'latam',PE:'latam',
    AE:'mena',SA:'mena',TR:'mena',IL:'mena',EG:'mena',
    SG:'sea',MY:'sea',ID:'sea',TH:'sea',VN:'sea',PH:'sea',
    AU:'oceania',NZ:'oceania',
    GB:'europe',IE:'europe',FR:'europe',DE:'europe',ES:'europe',IT:'europe',PT:'europe',NL:'europe',BE:'europe',LU:'europe',
    PL:'europe',CZ:'europe',SK:'europe',HU:'europe',RO:'europe',BG:'europe',GR:'europe',AT:'europe',CH:'europe',NO:'europe',SE:'europe',FI:'europe',DK:'europe',IS:'europe',EE:'europe',LV:'europe',LT:'europe',SI:'europe',HR:'europe',RS:'europe',BA:'europe',ME:'europe',MK:'europe',AL:'europe'
  };
  const timezoneCountries = {
    'Europe/Moscow':'RU','Europe/Minsk':'BY','Asia/Almaty':'KZ','Asia/Yerevan':'AM','Asia/Baku':'AZ','Asia/Tbilisi':'GE',
    'America/New_York':'US','America/Chicago':'US','America/Denver':'US','America/Los_Angeles':'US','America/Toronto':'CA','America/Vancouver':'CA',
    'Asia/Tokyo':'JP','Asia/Seoul':'KR','Asia/Shanghai':'CN','Asia/Hong_Kong':'HK','Australia/Sydney':'AU','Pacific/Auckland':'NZ'
  };
  let allItems = [];
  let activeTag = '';
  let userRegion = '';

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = (value = '') => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const hasCyrillic = value => /[А-Яа-яЁё]/.test(value || '');

  function language() {
    return (document.documentElement.lang || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
  }

  function text(item, field, lang) {
    const value = String(item[`${field}${lang === 'ru' ? 'Ru' : 'En'}`] || item[field] || '').trim();
    if (lang === 'ru' && field === 'title' && !hasCyrillic(value)) return '';
    return value;
  }

  function labels(lang) {
    return lang === 'ru'
      ? { loading:'Загружаем новости…', unavailable:'Новости временно недоступны.', empty:'По выбранным тегам новостей нет.', search:'Найти игру, студию или тему', all:'Все новости', official:'От разработчиков' }
      : { loading:'Loading news…', unavailable:'News is temporarily unavailable.', empty:'No news matches these tags.', search:'Search games, studios or topics', all:'All news', official:'From developers' };
  }

  function profileCountry() {
    const keys = ['igropoisk-profile','igropoisk.user','igropoisk-user','igropoisk-auth','igropoisk.session'];
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const value = JSON.parse(raw);
        const country = String(value?.country || value?.profile?.country || value?.user?.country || value?.countryCode || '').toUpperCase();
        if (/^[A-Z]{2}$/.test(country)) return country;
      } catch {}
    }
    return '';
  }

  function inferredCountry() {
    const profile = profileCountry();
    if (profile) return profile;
    const languages = navigator.languages || [navigator.language || ''];
    for (const locale of languages) {
      const country = String(locale).match(/[-_]([A-Za-z]{2})\b/)?.[1]?.toUpperCase();
      if (country && countryRegions[country]) return country;
    }
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (timezoneCountries[timezone]) return timezoneCountries[timezone];
      if (timezone?.startsWith('Europe/')) return 'EU';
    } catch {}
    return '';
  }

  function resolveUserRegion() {
    const country = inferredCountry();
    return countryRegions[country] || (country === 'EU' ? 'europe' : '');
  }

  function valid(item, lang) {
    return item && /^https?:\/\//i.test(item.primaryUrl || item.url || '') && item.publishedAt && text(item,'title',lang)
      && /^assets\/(news|publisher-news)\/[a-f0-9]{16}\.(jpg|png|webp|avif|gif)$/i.test(item.image || '');
  }

  function sourceName(item) {
    return item.primarySource || item.publisher || item.organization || item.source || item.sources?.[0]?.name || '';
  }

  function deriveTags(item, lang) {
    const body = `${text(item,'title',lang)} ${text(item,'summary',lang)}`.toLowerCase();
    const tags = [];
    if (item.game) tags.push(item.game);
    const organization = item.organization || item.publisher || item.sources?.find(source => source.official)?.organization;
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
    if (item.type === 'official' || item.official) tags.push(labels(lang).official);
    return [...new Set(tags)].slice(0, 5);
  }

  function normalize(item, official = false) {
    const source = sourceName(item);
    return {
      ...item,
      type: official ? 'official' : (item.type || 'ranked'),
      primaryUrl: item.primaryUrl || item.url,
      primarySource: source,
      titleRu: item.titleRu || item.title || '',
      titleEn: item.titleEn || item.title || '',
      summaryRu: item.summaryRu || item.summary || '',
      summaryEn: item.summaryEn || item.summary || '',
      mediaSourceCount: Number(item.mediaSourceCount || item.sourceCount || 1),
      regions: Array.isArray(item.regions) ? item.regions : [],
      sources: item.sources || [{ name: source, organization: item.organization || item.publisher || '', official }]
    };
  }

  async function loadJson(path) {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : payload.items || [];
  }

  function isOfficial(item) {
    return item.type === 'official' || item.official || (item.sources || []).some(source => source.official);
  }

  function isGlobal(item) {
    if (isOfficial(item)) return true;
    if (typeof item.globalEligible === 'boolean') return item.globalEligible;
    return Number(item.mediaSourceCount || 0) >= 3 || Number(item.discussionMentions || 0) >= 3 || Number(item.trendScore || 0) >= 450;
  }

  function matchesRegion(item) {
    return Boolean(userRegion && item.regionalEligible && (item.regions || []).includes(userRegion));
  }

  async function loadItems(lang) {
    const results = await Promise.allSettled([
      loadJson('data/news-events.json'),
      loadJson('data/news.json'),
      loadJson('data/publisher-news.json')
    ]);
    const candidates = [
      ...(results[0].status === 'fulfilled' ? results[0].value.map(item => normalize(item, item.type === 'official')) : []),
      ...(results[1].status === 'fulfilled' ? results[1].value.map(item => normalize(item, false)) : []),
      ...(results[2].status === 'fulfilled' ? results[2].value.map(item => normalize(item, true)) : [])
    ].filter(item => valid(item, lang));

    const byUrl = new Map();
    for (const item of candidates) {
      const key = item.primaryUrl;
      const previous = byUrl.get(key);
      const quality = Number(hasCyrillic(item.titleRu)) * 100 + Number(item.mediaSourceCount || 0) * 10 + Number(item.trendScore || 0);
      const previousQuality = previous ? Number(hasCyrillic(previous.titleRu)) * 100 + Number(previous.mediaSourceCount || 0) * 10 + Number(previous.trendScore || 0) : -1;
      if (!previous || quality > previousQuality) byUrl.set(key, item);
    }
    return [...byUrl.values()].filter(item => isGlobal(item) || matchesRegion(item));
  }

  function score(item) {
    const trusted = (item.sources || []).some(source => trustedMedia.has(source.name)) || trustedMedia.has(sourceName(item));
    const official = isOfficial(item);
    return Number(item.globalScore || item.trendScore || 0)
      + Number(item.mediaSourceCount || 0) * 100
      + (official ? 180 : 0)
      + (trusted ? 120 : 0)
      + (matchesRegion(item) ? Number(item.regionalScore || 180) : 0)
      + Math.max(0, 168 - (Date.now() - new Date(item.publishedAt).getTime()) / 36e5);
  }

  function renderCard(item, compact, lang) {
    const title = escapeHtml(text(item,'title',lang));
    const summary = escapeHtml(text(item,'summary',lang));
    const tags = deriveTags(item, lang);
    return `<a class="card news-card news-event-card" href="${escapeHtml(item.primaryUrl)}" target="_blank" rel="noopener noreferrer">
      <img src="${escapeHtml(item.image)}" alt="${title}" loading="lazy">
      <div class="card-body">
        <div class="date">${escapeHtml(formatters[lang].format(new Date(item.publishedAt)))} · ${escapeHtml(sourceName(item))}</div>
        ${tags.length ? `<div class="news-card__tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
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
    const tags = [...frequencies].sort((a,b) => b[1] - a[1]).slice(0, 18).map(([tag]) => tag);
    controls.innerHTML = `<div class="news-toolbar__top"><input type="search" data-news-search placeholder="${labels(lang).search}"></div><div class="news-tag-filter"><button class="is-active" data-tag="">${labels(lang).all}</button>${tags.map(tag => `<button data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')}</div>`;
    controls.onclick = event => {
      const button = event.target.closest('[data-tag]');
      if (!button) return;
      activeTag = button.dataset.tag || '';
      controls.querySelectorAll('[data-tag]').forEach(item => item.classList.toggle('is-active', item === button));
      renderArchive(page, lang);
    };
    $('[data-news-search]', controls).oninput = () => renderArchive(page, lang);
  }

  function renderArchive(page, lang) {
    const query = ($('[data-news-search]', $('#newsFilters'))?.value || '').trim().toLowerCase();
    const filtered = allItems.filter(item => {
      const tags = deriveTags(item, lang);
      if (activeTag && !tags.includes(activeTag)) return false;
      const haystack = `${text(item,'title',lang)} ${text(item,'summary',lang)} ${tags.join(' ')}`.toLowerCase();
      return !query || haystack.includes(query);
    }).sort((a,b) => score(b) - score(a) || new Date(b.publishedAt) - new Date(a.publishedAt));
    page.innerHTML = filtered.length ? filtered.map(item => renderCard(item, false, lang)).join('') : `<div class="empty">${labels(lang).empty}</div>`;
  }

  async function render() {
    const lang = language();
    const home = $('#homeNews');
    const page = $('#newsPage');
    userRegion = resolveUserRegion();
    setState(home, labels(lang).loading);
    setState(page, labels(lang).loading);
    try {
      allItems = await loadItems(lang);
      const globalItems = allItems.filter(isGlobal).sort((a,b) => score(b) - score(a) || new Date(b.publishedAt) - new Date(a.publishedAt));
      const globalUrls = new Set(globalItems.slice(0, 12).map(item => item.primaryUrl));
      const regionalItems = allItems.filter(item => matchesRegion(item) && !globalUrls.has(item.primaryUrl))
        .sort((a,b) => score(b) - score(a) || new Date(b.publishedAt) - new Date(a.publishedAt))
        .slice(0, 3);
      const homeItems = [...globalItems.slice(0, 12), ...regionalItems];
      if (home) home.innerHTML = homeItems.length ? homeItems.map(item => renderCard(item, true, lang)).join('') : `<div class="empty">${labels(lang).empty}</div>`;
      if (page) { buildFilters(page, lang); renderArchive(page, lang); }
    } catch (error) {
      console.warn(error);
      setState(home, labels(lang).unavailable);
      setState(page, labels(lang).unavailable);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true }); else render();
})();
