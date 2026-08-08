import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCanonicalNewsCatalog } from './news-game-registry-adapter.mjs';

const TRACKING_QUERY = /^(utm_|fbclid$|gclid$|yclid$|ref$|source$)/i;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GENERIC_SINGLE_WORD_GAME_TITLES = new Set(['control']);

export function normalizeName(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’'“”"`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalSourceUrl(value = '') {
  try {
    const url = new URL(String(value));
    url.hash = '';
    [...url.searchParams.keys()].forEach(key => {
      if (TRACKING_QUERY.test(key)) url.searchParams.delete(key);
    });
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch {
    return String(value || '').trim();
  }
}

function offsetMinutes(raw = '') {
  const value = String(raw).trim();
  if (/\b(?:UTC|GMT|Z)\b/i.test(value) && !/[+-]\d{2}:?\d{2}/.test(value)) return 0;
  const match = value.match(/([+-])(\d{2}):?(\d{2})(?!.*[+-]\d{2}:?\d{2})/);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function publicationFields(rawDate, { fallback = new Date(), defaultOffsetMinutes = 0 } = {}) {
  const parsed = new Date(rawDate || fallback);
  const valid = Number.isFinite(parsed.getTime()) ? parsed : new Date(fallback);
  const explicitOffset = offsetMinutes(rawDate);
  const offset = explicitOffset ?? defaultOffsetMinutes;
  const local = new Date(valid.getTime() + offset * 60_000);
  return {
    publishedAt: valid.toISOString(),
    publishedAtSource: String(rawDate || ''),
    publicationOffsetMinutes: offset,
    publishedDay: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    publishedLocalTime: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
  };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function normalizeExternalIds(value = {}) {
  return Object.fromEntries(Object.entries(value || {})
    .map(([provider, id]) => [String(provider).toLowerCase(), String(id).trim()])
    .filter(([, id]) => id));
}

export function publicationFieldsInTimeZone(value, { timeZone = 'Europe/Moscow', fallback = new Date() } = {}) {
  const parsed = new Date(value || fallback);
  const valid = Number.isFinite(parsed.getTime()) ? parsed : new Date(fallback);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(valid);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    publishedAt: valid.toISOString(),
    publicationTimeZone: timeZone,
    publishedDay: `${fields.year}-${fields.month}-${fields.day}`,
    publishedLocalTime: `${fields.hour === '24' ? '00' : fields.hour}:${fields.minute}`
  };
}

export async function loadGameCatalog({ root = process.cwd() } = {}) {
  return loadCanonicalNewsCatalog({ root });
}

function createIndexes(catalog) {
  const alias = new Map();
  const external = new Map();
  const bySlug = new Map(catalog.games.map(game => [game.slug, game]));
  const addAlias = (value, game, kind) => {
    const normalized = normalizeName(value);
    if (!normalized) return;
    const entries = alias.get(normalized) || [];
    entries.push({ game, kind, source: String(value) });
    alias.set(normalized, entries);
  };
  catalog.games.forEach(game => {
    game.aliases.forEach(value => addAlias(value, game, 'alias'));
    game.abbreviations.forEach(value => addAlias(value, game, 'abbreviation'));
    Object.entries(game.externalIds).forEach(([provider, id]) => external.set(`${provider}:${id}`, game));
  });
  return { alias, external, bySlug };
}

function exactTextContains(haystack, needle) {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactCaseTitleContains(title, source) {
  const normalized = normalizeName(source);
  if (!normalized || normalized.includes(' ') || GENERIC_SINGLE_WORD_GAME_TITLES.has(normalized)) return false;
  const candidate = String(source || '').trim();
  if (!candidate || candidate.length < 4) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(candidate)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(String(title || ''));
}

function explicitNames(item) {
  const values = [];
  if (typeof item?.game === 'string' && item.game.trim()) values.push(item.game.trim());
  if (Array.isArray(item?.gameNames)) values.push(...item.gameNames.filter(Boolean).map(String));
  if (Array.isArray(item?.games)) {
    item.games.forEach(game => {
      if (typeof game === 'string') values.push(game);
      else if (game?.title) values.push(String(game.title));
    });
  }
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function itemOverride(item, overrides) {
  const entries = overrides?.items || {};
  const keys = [item?.id, canonicalSourceUrl(item?.primaryUrl || item?.url || '')].filter(Boolean);
  for (const key of keys) if (entries[key]) return entries[key];
  return null;
}

function publicGame(game, { manual = false, matchedBy = 'automatic' } = {}) {
  return Object.freeze({
    gameId: game.gameId,
    slug: game.slug,
    title: game.title,
    pageExists: game.pageExists,
    pageUrl: game.pageExists ? game.pageUrl : '',
    manual,
    matchedBy
  });
}

function reviewCandidate(name, reason, games = []) {
  return {
    name,
    reason,
    possibleGameIds: [...new Set(games.map(game => game.gameId).filter(Boolean))],
    possibleGameSlugs: [...new Set(games.map(game => game.slug).filter(Boolean))]
  };
}

export function resolveNewsGames(item, catalog, overrides = { items: {} }) {
  const indexes = createIndexes(catalog);
  const manual = itemOverride(item, overrides);
  const resolved = new Map();
  const candidates = [];
  const reasons = new Set();

  if (manual) {
    for (const slug of manual.games || []) {
      const game = indexes.bySlug.get(String(slug));
      if (game) resolved.set(game.gameId, publicGame(game, { manual: true, matchedBy: 'manual' }));
      else candidates.push(reviewCandidate(String(slug), 'manual-game-not-found'));
    }
    if (manual.status === 'no-game') reasons.add('manual-no-game');
  } else {
    const externalIds = normalizeExternalIds(item?.externalGameIds || item?.gameIds || {});
    Object.entries(externalIds).forEach(([provider, id]) => {
      const game = indexes.external.get(`${provider}:${id}`);
      if (game) resolved.set(game.gameId, publicGame(game, { matchedBy: `external:${provider}` }));
    });

    for (const name of explicitNames(item)) {
      const matches = indexes.alias.get(normalizeName(name)) || [];
      const games = [...new Map(matches.map(match => [match.game.gameId, match.game])).values()];
      if (games.length === 1) {
        const game = games[0];
        resolved.set(game.gameId, publicGame(game, { matchedBy: 'explicit-name' }));
      } else if (games.length > 1) {
        candidates.push(reviewCandidate(name, 'ambiguous-explicit-name', games));
      } else {
        candidates.push(reviewCandidate(name, 'unknown-explicit-game'));
      }
    }

    const title = [item?.titleRu, item?.titleEn, item?.title].filter(Boolean).map(String).join(' · ');
    const body = normalizeName(`${title} ${item?.summaryRu || ''} ${item?.summaryEn || ''} ${item?.summary || ''}`);
    const matchedPhrases = [...indexes.alias.entries()]
      .map(([phrase, matches]) => ({
        phrase,
        matches,
        abbreviation: matches.some(match => match.kind === 'abbreviation'),
        singleWordHeadline: !phrase.includes(' ') && matches.some(match => exactCaseTitleContains(title, match.source))
      }))
      .filter(entry => ((entry.phrase.split(' ').length >= 2 || entry.abbreviation) && exactTextContains(body, entry.phrase)) || entry.singleWordHeadline)
      .sort((a, b) => b.phrase.length - a.phrase.length);
    const acceptedPhrases = [];
    for (const { phrase, matches, abbreviation, singleWordHeadline } of matchedPhrases) {
      if (acceptedPhrases.some(longer => exactTextContains(longer, phrase))) continue;
      acceptedPhrases.push(phrase);
      const games = [...new Map(matches.map(match => [match.game.gameId, match.game])).values()];
      if (games.length === 1) {
        const game = games[0];
        resolved.set(game.gameId, publicGame(game, { matchedBy: abbreviation ? 'abbreviation' : singleWordHeadline ? 'headline-single-word' : 'official-or-alias' }));
      } else {
        candidates.push(reviewCandidate(matches[0]?.source || phrase, 'ambiguous-alias', games));
      }
    }

    for (const [seriesName, seriesSlugs] of Object.entries(catalog.rules?.series || {})) {
      const normalizedSeries = normalizeName(seriesName);
      if (!normalizedSeries || !exactTextContains(body, normalizedSeries)) continue;
      if ([...resolved.values()].some(game => exactTextContains(normalizeName(game.title), normalizedSeries))) continue;
      const games = [...new Map((seriesSlugs || []).map(String).map(slug => indexes.bySlug.get(slug)).filter(Boolean).map(game => [game.gameId, game])).values()];
      if (games.length === 1) {
        const game = games[0];
        resolved.set(game.gameId, publicGame(game, { matchedBy: 'series' }));
      } else if (games.length > 1) {
        candidates.push(reviewCandidate(seriesName, 'ambiguous-series', games));
      }
    }
  }

  const games = [...resolved.values()];
  if (games.some(game => !game.pageExists)) reasons.add('missing-game-page');
  candidates.forEach(candidate => reasons.add(candidate.reason));
  const status = manual
    ? 'manual'
    : reasons.size
      ? 'needs-review'
      : games.length
        ? 'resolved'
        : 'unmatched';

  return Object.freeze({
    games: Object.freeze(games),
    gameIds: Object.freeze(games.map(game => game.gameId)),
    gameCandidates: Object.freeze(candidates.map(candidate => Object.freeze(candidate))),
    gameReviewStatus: status,
    gameReviewReasons: Object.freeze([...reasons])
  });
}

export function mergeExistingNewsItems(existing = [], incoming = [], { now = new Date().toISOString() } = {}) {
  const oldByUrl = new Map(existing.map(item => [canonicalSourceUrl(item?.primaryUrl || item?.url || ''), item]));
  const merged = new Map();
  for (const item of incoming) {
    const canonicalUrl = canonicalSourceUrl(item?.primaryUrl || item?.url || '');
    if (!canonicalUrl) continue;
    const previous = oldByUrl.get(canonicalUrl) || {};
    const candidate = {
      ...previous,
      ...item,
      id: item.id || previous.id,
      canonicalUrl,
      firstSeenAt: previous.firstSeenAt || item.firstSeenAt || now,
      updatedAt: now
    };
    const existingCandidate = merged.get(canonicalUrl);
    if (!existingCandidate || Date.parse(candidate.publishedAt || '') >= Date.parse(existingCandidate.publishedAt || '')) {
      merged.set(canonicalUrl, candidate);
    }
  }
  return [...merged.values()];
}

export async function enrichNewsItems(items, { root = process.cwd(), catalog, overrides } = {}) {
  const loadedCatalog = catalog || await loadGameCatalog({ root });
  const loadedOverrides = overrides || await readJson(path.join(root, 'data/news-game-overrides.json'), { schemaVersion: 1, items: {} });
  return items.map(item => {
    const publication = DAY_PATTERN.test(String(item?.publishedDay || ''))
      ? {}
      : item?.publishedAtSource
        ? publicationFields(item.publishedAtSource)
        : publicationFieldsInTimeZone(item?.publishedAt || '', { timeZone: 'Europe/Moscow' });
    return {
      ...item,
      ...publication,
      canonicalUrl: canonicalSourceUrl(item?.primaryUrl || item?.url || ''),
      ...resolveNewsGames(item, loadedCatalog, loadedOverrides)
    };
  });
}

export function buildGameReviewQueue(items = [], { generatedAt = new Date().toISOString() } = {}) {
  const reviewItems = items.filter(item => item.gameReviewStatus === 'needs-review')
    .map(item => ({
      id: item.id,
      primaryUrl: item.primaryUrl || item.url || '',
      titleRu: item.titleRu || item.title || '',
      titleEn: item.titleEn || item.title || '',
      publishedAt: item.publishedAt,
      games: item.games || [],
      gameIds: item.gameIds || [],
      candidates: item.gameCandidates || [],
      reasons: item.gameReviewReasons || []
    }));
  return {
    schemaVersion: 1,
    generatedAt,
    count: reviewItems.length,
    items: reviewItems
  };
}
