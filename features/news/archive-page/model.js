'use strict';

((root, factory) => {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.IgropoiskNewsArchiveModel = model;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const DEFAULT_TIME_ZONE = 'Europe/Moscow';
  const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  function normalizeSlug(value = '') {
    return String(value).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function canonicalUrl(value = '') {
    try {
      const url = new URL(String(value));
      url.hash = '';
      [...url.searchParams.keys()].forEach(key => {
        if (/^(utm_|fbclid$|gclid$|yclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
      });
      url.pathname = url.pathname.replace(/\/+$/, '') || '/';
      return url.href;
    } catch {
      return String(value || '').trim();
    }
  }

  function dateParts(date, timeZone = DEFAULT_TIME_ZONE) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return values.year && values.month && values.day ? `${values.year}-${values.month}-${values.day}` : null;
  }

  function calendarDayKey(item, { timeZone = DEFAULT_TIME_ZONE } = {}) {
    if (DAY_PATTERN.test(String(item?.publishedDay || ''))) return item.publishedDay;
    return dateParts(new Date(item?.publishedAt || ''), timeZone) || '0000-00-00';
  }

  function publicationTime(item) {
    const value = Date.parse(item?.publishedAt || '');
    return Number.isFinite(value) ? value : 0;
  }

  function itemIdentity(item) {
    return canonicalUrl(item?.canonicalUrl || item?.primaryUrl || item?.url || '') || String(item?.id || '');
  }

  function deduplicate(items = []) {
    const result = [];
    const seen = new Set();
    for (const item of [...items].sort((a, b) => publicationTime(b) - publicationTime(a))) {
      const identity = itemIdentity(item);
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      result.push(item);
    }
    return result;
  }

  function sortChronologically(items = []) {
    return deduplicate(items).sort((a, b) => {
      const timeDifference = publicationTime(b) - publicationTime(a);
      if (timeDifference) return timeDifference;
      return String(a?.id || '').localeCompare(String(b?.id || ''), 'en');
    });
  }

  function gameSlugs(item) {
    const values = [];
    if (Array.isArray(item?.games)) {
      item.games.forEach(game => {
        const slug = normalizeSlug(typeof game === 'string' ? game : game?.slug);
        if (slug) values.push(slug);
      });
    }
    const legacy = normalizeSlug(item?.gameSlug || '');
    if (legacy) values.push(legacy);
    return [...new Set(values)];
  }

  function filterByGame(items = [], slug = '') {
    const normalized = normalizeSlug(slug);
    if (!normalized) return [...items];
    return items.filter(item => gameSlugs(item).includes(normalized));
  }

  function groupByCalendarDay(items = [], options = {}) {
    const groups = [];
    const byDay = new Map();
    for (const item of sortChronologically(items)) {
      const key = calendarDayKey(item, options);
      if (!byDay.has(key)) {
        const group = { key, items: [] };
        byDay.set(key, group);
        groups.push(group);
      }
      byDay.get(key).items.push(item);
    }
    groups.sort((a, b) => b.key.localeCompare(a.key));
    groups.forEach(group => group.items.sort((a, b) => publicationTime(b) - publicationTime(a)));
    return groups;
  }

  function formatDayHeading(dayKey, { currentYear = new Date().getFullYear(), lang = 'ru' } = {}) {
    if (!DAY_PATTERN.test(String(dayKey))) return '';
    const [year, month, day] = dayKey.split('-').map(Number);
    if (lang === 'ru') return `${day} ${MONTHS_RU[month - 1]}${year === currentYear ? '' : ` ${year}`}`;
    return new Intl.DateTimeFormat(lang, {
      day: 'numeric',
      month: 'long',
      ...(year === currentYear ? {} : { year: 'numeric' }),
      timeZone: 'UTC'
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  }

  function filterFromSearch(search = '') {
    return normalizeSlug(new URLSearchParams(String(search).replace(/^\?/, '')).get('game') || '');
  }

  return Object.freeze({
    DEFAULT_TIME_ZONE,
    calendarDayKey,
    canonicalUrl,
    deduplicate,
    filterByGame,
    filterFromSearch,
    formatDayHeading,
    gameSlugs,
    groupByCalendarDay,
    normalizeSlug,
    sortChronologically
  });
});
