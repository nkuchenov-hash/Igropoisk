'use strict';

(() => {
  const scriptUrl = document.currentScript?.src || document.baseURI;
  const siteBase = new URL('../../../', scriptUrl);
  const trustedMedia = new Set(['Игромания', 'StopGame', 'IGN', 'GameSpot', 'Eurogamer', 'VGC', 'PC Gamer', 'GamesRadar+', 'Polygon', 'Rock Paper Shotgun', 'Ars Technica', 'PlayGround.ru']);
  const formatters = {
    ru: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }),
    en: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' })
  };
  const countryRegions = {
    RU: 'cis', KZ: 'cis', BY: 'cis', AM: 'cis', AZ: 'cis', GE: 'cis', KG: 'cis', MD: 'cis', TJ: 'cis', TM: 'cis', UZ: 'cis',
    US: 'north-america', CA: 'north-america', MX: 'north-america',
    JP: 'japan', KR: 'korea', CN: 'china', HK: 'china', MO: 'china', TW: 'china',
    BR: 'latam', AR: 'latam', CL: 'latam', CO: 'latam', PE: 'latam',
    AE: 'mena', SA: 'mena', TR: 'mena', IL: 'mena', EG: 'mena',
    SG: 'sea', MY: 'sea', ID: 'sea', TH: 'sea', VN: 'sea', PH: 'sea',
    AU: 'oceania', NZ: 'oceania',
    GB: 'europe', IE: 'europe', FR: 'europe', DE: 'europe', ES: 'europe', IT: 'europe', PT: 'europe', NL: 'europe', BE: 'europe', LU: 'europe',
    PL: 'europe', CZ: 'europe', SK: 'europe', HU: 'europe', RO: 'europe', BG: 'europe', GR: 'europe', AT: 'europe', CH: 'europe', NO: 'europe', SE: 'europe', FI: 'europe', DK: 'europe', IS: 'europe', EE: 'europe', LV: 'europe', LT: 'europe', SI: 'europe', HR: 'europe', RS: 'europe', BA: 'europe', ME: 'europe', MK: 'europe', AL: 'europe'
  };
  const timezoneCountries = {
    'Europe/Moscow': 'RU', 'Europe/Minsk': 'BY', 'Asia/Almaty': 'KZ', 'Asia/Yerevan': 'AM', 'Asia/Baku': 'AZ', 'Asia/Tbilisi': 'GE',
    'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
    'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK', 'Australia/Sydney': 'AU', 'Pacific/Auckland': 'NZ'
  };
  const sourceFiles = ['data/news-events.json', 'data/news.json', 'data/publisher-news.json'];
  const cache = new Map();

  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
  const hasCyrillic = value => /[А-Яа-яЁё]/.test(value || '');
  const absoluteAsset = path => new URL(path, siteBase).href;

  function language() {
    return (document.documentElement.lang || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
  }

  function labels(lang) {
    return lang === 'ru'
      ? { loading: 'Загружаем новости…', unavailable: 'Новости временно недоступны.', empty: 'По выбранным параметрам новостей нет.', search: 'Найти игру, студию или тему', all: 'Все новости', official: 'От разработчиков' }
      : { loading: 'Loading news…', unavailable: 'News is temporarily unavailable.', empty: 'No news matches the selected filters.', search: 'Search games, studios or topics', all: 'All news', official: 'From developers' };
  }

  function text(item, field, lang) {
    const suffix = lang === 'ru' ? 'Ru' : 'En';
    const value = String(item[`${field}${suffix}`] || item[field] || '').trim();
    if (lang === 'ru' && field === 'title' && !hasCyrillic(value)) return '';
    return value;
  }

  function profileCountry() {
    const keys = ['igropoisk-profile', 'igropoisk.user', 'igropoisk-user', 'igropoisk-auth', 'igropoisk.session'];
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
    for (const locale of navigator.languages || [navigator.language || '']) {
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

  function userRegion() {
    const country = inferredCountry();
    return countryRegions[country] || (country === 'EU' ? 'europe' : '');
  }

  function sourceName(item) {
    return item.primarySource || item.publisher || item.organization || item.source || item.sources?.[0]?.name || '';
  }

  function applyTranslation(item, lang) {
    if (lang !== 'ru') return item;
    const translated = window.IgropoiskNewsTranslationsRu?.[item.id];
    if (!translated) return item;
    return { ...item, titleRu: translated[0], summaryRu: translated[1] };
  }

  function normalize(raw, official = false, lang = language()) {
    const item = applyTranslation(raw || {}, lang);
    const source = sourceName(item);
    return {
      ...item,
      type: official ? 'official' : (item.type || 'ranked'),
      primaryUrl: item.primaryUrl || item.url || '',
      primarySource: source,
      titleRu: item.titleRu || item.title || '',
      titleEn: item.titleEn || item.title || '',
      summaryRu: item.summaryRu || item.summary || '',
      summaryEn: item.summaryEn || item.summary || '',
      mediaSourceCount: Number(item.mediaSourceCount || item.sourceCount || 1),
      regions: Array.isArray(item.regions) ? item.regions : [],
      sources: Array.isArray(item.sources) && item.sources.length ? item.sources : [{ name: source, organization: item.organization || item.publisher || '', official }]
    };
  }

  function valid(item, lang) {
    const date = new Date(item?.publishedAt || '').getTime();
    return Boolean(item && /^https?:\/\//i.test(item.primaryUrl || '') && Number.isFinite(date) && text(item, 'title', lang)
      && /^assets\/(news|publisher-news)\/[a-f0-9]{16}\.(jpg|png|webp|avif|gif)$/i.test(item.image || ''));
  }

  async function loadJson(path) {
    const url = new URL(path, siteBase);
    url.searchParams.set('v', String(Date.now()));
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : (payload.items || []);
  }

  function isOfficial(item) {
    return item.type === 'official' || item.official || (item.sources || []).some(source => source.official);
  }

  function isGlobal(item) {
    if (isOfficial(item)) return true;
    if (typeof item.globalEligible === 'boolean') return item.globalEligible;
    return Number(item.mediaSourceCount || 0) >= 3 || Number(item.discussionMentions || 0) >= 3 || Number(item.trendScore || 0) >= 450;
  }

  function matchesRegion(item, region = userRegion()) {
    return Boolean(region && item.regionalEligible && (item.regions || []).includes(region));
  }

  function score(item, region = userRegion()) {
    const trusted = (item.sources || []).some(source => trustedMedia.has(source.name)) || trustedMedia.has(sourceName(item));
    return Number(item.globalScore || item.trendScore || 0)
      + Number(item.mediaSourceCount || 0) * 100
      + (isOfficial(item) ? 180 : 0)
      + (trusted ? 120 : 0)
      + (matchesRegion(item, region) ? Number(item.regionalScore || 180) : 0)
      + Math.max(0, 168 - (Date.now() - new Date(item.publishedAt).getTime()) / 36e5);
  }

  function deriveTags(item, lang) {
    const body = `${text(item, 'title', lang)} ${text(item, 'summary', lang)}`.toLowerCase();
    const tags = [];
    if (item.game) tags.push(item.game);
    const organization = item.organization || item.publisher || item.sources?.find(source => source.official)?.organization;
    if (organization && organization !== item.game) tags.push(organization);
    const groups = lang === 'ru'
      ? [
          ['Релизы', /релиз|вышел|вышла|выходит|дата выхода|ранн.*доступ|снимут с продажи/],
          ['Обновления', /патч|обновлен|хотфикс|сезон|update|драйвер|перерабатывает/],
          ['Анонсы', /анонс|представил|трейлер|показал|direct/],
          ['DLC', /\bdlc\b|дополнен|expansion/],
          ['Индустрия', /студи|издател|увольнен|закрыт|поглощен|продаж|директор|компания/],
          ['Технологии', /движок|график|видеокарт|драйвер|unreal|unity|oled|желез|\bai\b/],
          ['RPG', /\brpg\b|ролевая|ролевой/],
          ['Стратегии', /стратег|\brts\b/],
          ['Шутеры', /шутер|shoot/],
          ['Симуляторы', /симулятор|simulator/],
          ['Хорроры', /хоррор|horror|silent hill/]
        ]
      : [
          ['Releases', /release|launch|early access/], ['Updates', /patch|update|hotfix|season|driver/], ['Announcements', /announce|trailer|reveal|direct/], ['DLC', /\bdlc\b|expansion/], ['Industry', /studio|publisher|layoff|acquisition|sales|director/], ['Technology', /engine|graphics|gpu|driver|unreal|unity|oled|\bai\b/], ['RPG', /\brpg\b/], ['Strategy', /strategy|\brts\b/], ['Shooters', /shooter/], ['Simulation', /simulator/], ['Horror', /horror/]
        ];
    groups.forEach(([tag, pattern]) => { if (pattern.test(body)) tags.push(tag); });
    if (isOfficial(item)) tags.push(labels(lang).official);
    return [...new Set(tags)].slice(0, 5);
  }

  async function loadAll(lang = language(), { force = false } = {}) {
    const cacheKey = `all:${lang}`;
    if (!force && cache.has(cacheKey)) return cache.get(cacheKey);
    const pending = (async () => {
      const results = await Promise.allSettled(sourceFiles.map(loadJson));
      if (results.every(result => result.status === 'rejected')) throw new Error('All news sources are unavailable.');
      const candidates = results.flatMap((result, index) => {
        if (result.status !== 'fulfilled') return [];
        return result.value.map(item => normalize(item, index === 2 || item.type === 'official', lang));
      }).filter(item => valid(item, lang));
      const byUrl = new Map();
      for (const item of candidates) {
        const previous = byUrl.get(item.primaryUrl);
        const quality = Number(hasCyrillic(item.titleRu)) * 100 + Number(item.mediaSourceCount || 0) * 10 + Number(item.trendScore || 0);
        const previousQuality = previous ? Number(hasCyrillic(previous.titleRu)) * 100 + Number(previous.mediaSourceCount || 0) * 10 + Number(previous.trendScore || 0) : -1;
        if (!previous || quality > previousQuality) byUrl.set(item.primaryUrl, item);
      }
      return [...byUrl.values()];
    })();
    cache.set(cacheKey, pending);
    try {
      return await pending;
    } catch (error) {
      cache.delete(cacheKey);
      throw error;
    }
  }

  async function loadHome(lang = language()) {
    if (lang === 'ru') {
      try {
        const curated = (await loadJson('data/news-home-ru.json')).map(item => normalize(item, Boolean(item.official), lang)).filter(item => valid(item, lang)).slice(0, 12);
        if (curated.length === 12) return curated;
      } catch (error) {
        console.warn('Curated home news feed unavailable.', error);
      }
    }
    const region = userRegion();
    const all = await loadAll(lang);
    const globalItems = all.filter(isGlobal).sort((a, b) => score(b, region) - score(a, region) || new Date(b.publishedAt) - new Date(a.publishedAt));
    const globalUrls = new Set(globalItems.slice(0, 12).map(item => item.primaryUrl));
    const regionalItems = all.filter(item => matchesRegion(item, region) && !globalUrls.has(item.primaryUrl))
      .sort((a, b) => score(b, region) - score(a, region) || new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 3);
    return [...globalItems.slice(0, 12), ...regionalItems];
  }

  function renderCard(item, { compact = false, lang = language() } = {}) {
    const title = escapeHtml(text(item, 'title', lang));
    const summary = escapeHtml(text(item, 'summary', lang));
    const tags = deriveTags(item, lang);
    return `<a class="card ig-news-card${compact ? ' ig-news-card--compact' : ''}" href="${escapeHtml(item.primaryUrl)}" target="_blank" rel="noopener noreferrer" data-news-external>
      <img class="ig-news-card__image" src="${escapeHtml(absoluteAsset(item.image))}" alt="${title}" loading="lazy">
      <div class="card-body ig-news-card__body">
        <div class="ig-news-card__date">${escapeHtml(formatters[lang].format(new Date(item.publishedAt)))} · ${escapeHtml(sourceName(item))}</div>
        ${tags.length ? `<div class="ig-news-card__tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
        <h3 class="ig-news-card__title">${title}</h3>
        ${compact || !summary ? '' : `<p class="ig-news-card__summary">${summary}</p>`}
      </div>
    </a>`;
  }

  function setState(target, message, kind = '') {
    if (!target) return;
    target.innerHTML = `<div class="ig-news__state${kind ? ` ig-news__state--${escapeHtml(kind)}` : ''}">${escapeHtml(message)}</div>`;
  }

  window.IgropoiskNews = Object.freeze({ absoluteAsset, deriveTags, escapeHtml, isGlobal, labels, language, loadAll, loadHome, matchesRegion, renderCard, score, setState, text, userRegion });
})();
