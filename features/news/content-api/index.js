'use strict';

(() => {
  const scriptUrl = document.currentScript?.src || document.baseURI;
  const siteBase = new URL('../../../', scriptUrl);
  const trustedMedia = new Set(['Игромания', 'StopGame', 'IGN', 'GameSpot', 'Eurogamer', 'VGC', 'PC Gamer', 'GamesRadar+', 'Polygon', 'Rock Paper Shotgun', 'Ars Technica', 'PlayGround.ru']);
  const sourceDefinitions = Object.freeze([
    Object.freeze({ id: 'ranked-events', path: 'data/news-events.json', official: false }),
    Object.freeze({ id: 'legacy-news', path: 'data/news.json', official: false }),
    Object.freeze({ id: 'publisher-news', path: 'data/publisher-news.json', official: true })
  ]);
  const curatedFeeds = Object.freeze({ ru: 'data/news-home-ru.json' });
  const countryRegions = Object.freeze({
    RU: 'cis', KZ: 'cis', BY: 'cis', AM: 'cis', AZ: 'cis', GE: 'cis', KG: 'cis', MD: 'cis', TJ: 'cis', TM: 'cis', UZ: 'cis',
    US: 'north-america', CA: 'north-america', MX: 'north-america',
    JP: 'japan', KR: 'korea', CN: 'china', HK: 'china', MO: 'china', TW: 'china',
    BR: 'latam', AR: 'latam', CL: 'latam', CO: 'latam', PE: 'latam',
    AE: 'mena', SA: 'mena', TR: 'mena', IL: 'mena', EG: 'mena',
    SG: 'sea', MY: 'sea', ID: 'sea', TH: 'sea', VN: 'sea', PH: 'sea',
    AU: 'oceania', NZ: 'oceania',
    GB: 'europe', IE: 'europe', FR: 'europe', DE: 'europe', ES: 'europe', IT: 'europe', PT: 'europe', NL: 'europe', BE: 'europe', LU: 'europe',
    PL: 'europe', CZ: 'europe', SK: 'europe', HU: 'europe', RO: 'europe', BG: 'europe', GR: 'europe', AT: 'europe', CH: 'europe', NO: 'europe', SE: 'europe', FI: 'europe', DK: 'europe', IS: 'europe', EE: 'europe', LV: 'europe', LT: 'europe', SI: 'europe', HR: 'europe', RS: 'europe', BA: 'europe', ME: 'europe', MK: 'europe', AL: 'europe'
  });
  const timezoneCountries = Object.freeze({
    'Europe/Moscow': 'RU', 'Europe/Minsk': 'BY', 'Asia/Almaty': 'KZ', 'Asia/Yerevan': 'AM', 'Asia/Baku': 'AZ', 'Asia/Tbilisi': 'GE',
    'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
    'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK', 'Australia/Sydney': 'AU', 'Pacific/Auckland': 'NZ'
  });
  const cache = new Map();
  let lastHealth = Object.freeze({ status: 'idle', checkedAt: '', sources: Object.freeze([]) });

  const hasCyrillic = value => /[А-Яа-яЁё]/.test(value || '');

  function language() {
    return (document.documentElement.lang || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
  }

  function text(item, field, lang = language()) {
    const suffix = lang === 'ru' ? 'Ru' : 'En';
    const value = String(item?.[`${field}${suffix}`] || item?.[field] || '').trim();
    if (lang === 'ru' && field === 'title' && !hasCyrillic(value)) return '';
    return value;
  }

  function sourceName(item) {
    return item?.primarySource || item?.publisher || item?.organization || item?.source || item?.sources?.[0]?.name || '';
  }

  function isOfficial(item) {
    return Boolean(item?.type === 'official' || item?.official || (item?.sources || []).some(source => source.official));
  }

  function applyTranslation(item, lang) {
    if (lang !== 'ru') return item;
    const translated = window.IgropoiskNewsTranslationsRu?.[item.id];
    if (!translated) return item;
    return { ...item, titleRu: translated[0], summaryRu: translated[1] };
  }

  function normalize(raw, { official = false, lang = language() } = {}) {
    const item = applyTranslation(raw || {}, lang);
    const source = sourceName(item);
    return Object.freeze({
      ...item,
      type: official ? 'official' : (item.type || 'ranked'),
      primaryUrl: item.primaryUrl || item.url || '',
      primarySource: source,
      titleRu: item.titleRu || item.title || '',
      titleEn: item.titleEn || item.title || '',
      summaryRu: item.summaryRu || item.summary || '',
      summaryEn: item.summaryEn || item.summary || '',
      mediaSourceCount: Number(item.mediaSourceCount || item.sourceCount || 1),
      regions: Object.freeze(Array.isArray(item.regions) ? [...item.regions] : []),
      sources: Object.freeze(Array.isArray(item.sources) && item.sources.length
        ? item.sources.map(entry => Object.freeze({ ...entry }))
        : [Object.freeze({ name: source, organization: item.organization || item.publisher || '', official })])
    });
  }

  function valid(item, lang = language()) {
    const date = new Date(item?.publishedAt || '').getTime();
    return Boolean(item && /^https?:\/\//i.test(item.primaryUrl || '') && Number.isFinite(date) && text(item, 'title', lang)
      && /^assets\/(news|publisher-news)\/[a-f0-9]{16}\.(jpg|png|webp|avif|gif)$/i.test(item.image || ''));
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

  function matchesRegion(item, region = userRegion()) {
    return Boolean(region && item?.regionalEligible && (item.regions || []).includes(region));
  }

  function isGlobal(item) {
    if (isOfficial(item)) return true;
    if (typeof item?.globalEligible === 'boolean') return item.globalEligible;
    return Number(item?.mediaSourceCount || 0) >= 3 || Number(item?.discussionMentions || 0) >= 3 || Number(item?.trendScore || 0) >= 450;
  }

  function score(item, region = userRegion()) {
    const trusted = (item?.sources || []).some(source => trustedMedia.has(source.name)) || trustedMedia.has(sourceName(item));
    return Number(item?.globalScore || item?.trendScore || 0)
      + Number(item?.mediaSourceCount || 0) * 100
      + (isOfficial(item) ? 180 : 0)
      + (trusted ? 120 : 0)
      + (matchesRegion(item, region) ? Number(item?.regionalScore || 180) : 0)
      + Math.max(0, 168 - (Date.now() - new Date(item?.publishedAt).getTime()) / 36e5);
  }

  async function loadJson(path) {
    const url = new URL(path, siteBase);
    url.searchParams.set('v', String(Date.now()));
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : (payload.items || []);
  }

  function quality(item) {
    return Number(hasCyrillic(item.titleRu)) * 100
      + Number(item.mediaSourceCount || 0) * 10
      + Number(item.trendScore || 0);
  }

  function deduplicate(items) {
    const byUrl = new Map();
    for (const item of items) {
      const previous = byUrl.get(item.primaryUrl);
      if (!previous || quality(item) > quality(previous)) byUrl.set(item.primaryUrl, item);
    }
    return Object.freeze([...byUrl.values()]);
  }

  function setHealth(results) {
    const sources = sourceDefinitions.map((source, index) => {
      const result = results[index];
      return Object.freeze({
        id: source.id,
        path: source.path,
        status: result.status === 'fulfilled' ? 'ready' : 'error',
        count: result.status === 'fulfilled' ? result.value.length : 0,
        error: result.status === 'rejected' ? String(result.reason?.message || result.reason || 'Unknown source error') : ''
      });
    });
    const ready = sources.filter(source => source.status === 'ready').length;
    lastHealth = Object.freeze({
      status: ready === sources.length ? 'ready' : (ready ? 'degraded' : 'error'),
      checkedAt: new Date().toISOString(),
      sources: Object.freeze(sources)
    });
  }

  async function getAll({ lang = language(), force = false } = {}) {
    const cacheKey = `all:${lang}`;
    if (!force && cache.has(cacheKey)) return cache.get(cacheKey);
    const pending = (async () => {
      const results = await Promise.allSettled(sourceDefinitions.map(async source => {
        const payload = await loadJson(source.path);
        return payload
          .map(item => normalize(item, { official: source.official || item.type === 'official', lang }))
          .filter(item => valid(item, lang));
      }));
      setHealth(results);
      if (results.every(result => result.status === 'rejected')) throw new Error('All news sources are unavailable.');
      return deduplicate(results.flatMap(result => result.status === 'fulfilled' ? result.value : []));
    })();
    cache.set(cacheKey, pending);
    try {
      return await pending;
    } catch (error) {
      cache.delete(cacheKey);
      throw error;
    }
  }

  async function getHome({ lang = language(), region = userRegion(), globalLimit = 12, regionalLimit = 3, force = false } = {}) {
    const curatedPath = curatedFeeds[lang];
    if (curatedPath) {
      try {
        const curated = (await loadJson(curatedPath))
          .map(item => normalize(item, { official: Boolean(item.official), lang }))
          .filter(item => valid(item, lang))
          .slice(0, globalLimit);
        if (curated.length === globalLimit) return Object.freeze(curated);
      } catch (error) {
        console.warn('Curated home news feed unavailable.', error);
      }
    }
    const all = await getAll({ lang, force });
    const globalItems = all.filter(isGlobal)
      .sort((a, b) => score(b, region) - score(a, region) || new Date(b.publishedAt) - new Date(a.publishedAt));
    const globalUrls = new Set(globalItems.slice(0, globalLimit).map(item => item.primaryUrl));
    const regionalItems = all.filter(item => matchesRegion(item, region) && !globalUrls.has(item.primaryUrl))
      .sort((a, b) => score(b, region) - score(a, region) || new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, regionalLimit);
    return Object.freeze([...globalItems.slice(0, globalLimit), ...regionalItems]);
  }

  function invalidate() {
    cache.clear();
  }

  function health() {
    return lastHealth;
  }

  window.IgropoiskNewsContent = Object.freeze({
    version: 1,
    getAll,
    getHome,
    health,
    invalidate,
    isGlobal,
    isOfficial,
    language,
    matchesRegion,
    normalize,
    score,
    sourceName,
    sources: sourceDefinitions,
    text,
    userRegion,
    valid
  });
})();
