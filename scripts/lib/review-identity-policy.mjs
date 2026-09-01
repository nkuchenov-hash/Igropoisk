import fs from 'node:fs';
import path from 'node:path';

export const forbiddenReviewDomains = [
  'metacritic.com',
  'opencritic.com',
  'gamerankings.com',
  'mobygames.com',
  'reddit.com',
  'steamcommunity.com',
  'store.steampowered.com',
  'wikipedia.org',
  'wikimedia.org',
  'wikidata.org',
];

export const normalizeReviewIdentity = value => String(value || '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/[^a-z0-9а-яё]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const safeDecodedUrl = value => {
  const raw = String(value || '');
  try { return decodeURIComponent(raw); }
  catch { return raw; }
};

const containsPhrase = (haystack, phrase) => {
  const hay = ` ${normalizeReviewIdentity(haystack)} `;
  const needle = normalizeReviewIdentity(phrase);
  return Boolean(needle && hay.includes(` ${needle} `));
};

const startsWithPhrase = (value, phrase) => {
  const normalized = normalizeReviewIdentity(value);
  const needle = normalizeReviewIdentity(phrase);
  return Boolean(needle && (normalized === needle || normalized.startsWith(`${needle} `)));
};

export function reviewUrlProblem(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return 'missing-or-invalid-direct-url';
  let parsed;
  try { parsed = new URL(raw); }
  catch { return 'missing-or-invalid-direct-url'; }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  if (forbiddenReviewDomains.some(domain => host === domain || host.endsWith(`.${domain}`))) {
    return `forbidden-host:${host}`;
  }
  const decoded = safeDecodedUrl(raw).toLowerCase();
  const wrappedForbidden = forbiddenReviewDomains.find(domain => decoded.includes(domain));
  if (wrappedForbidden) return `wrapped-forbidden-host:${wrappedForbidden}`;
  const pathname = String(parsed.pathname || '').replace(/\/+$/, '') || '/';
  if (pathname === '/') return `homepage-not-direct-review:${host}`;
  if (/\/(search|search-results|searchresults)(?:\/|$)/i.test(pathname)) return `search-page-not-direct-review:${host}`;
  return '';
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function identityAliases(slug, draft) {
  return [...new Set([
    slug.replace(/-/g, ' '),
    draft?.identity?.title,
    ...(Array.isArray(draft?.identity?.aliases) ? draft.identity.aliases : []),
  ].map(normalizeReviewIdentity).filter(Boolean))];
}

const stopTokens = new Set(['the','a','an','of','and','or','for','to','in','on','game','video','edition','remastered','remake','игра','издание']);

export function buildReviewIdentityPolicy(root, slug, draft) {
  const targetAliases = identityAliases(slug, draft);
  const titleBase = normalizeReviewIdentity(String(draft?.identity?.title || slug).split(':')[0]);
  const distinctiveTokens = titleBase.split(' ').filter(token => token.length >= 4 && !/^\d+$/.test(token) && !stopTokens.has(token));
  const franchiseToken = distinctiveTokens[0] || targetAliases.flatMap(alias => alias.split(' ')).find(token => token.length >= 4 && !stopTokens.has(token)) || '';
  const siblingAliases = new Set();
  const draftsDir = path.join(root, 'data/drafts');
  if (franchiseToken && fs.existsSync(draftsDir)) {
    for (const name of fs.readdirSync(draftsDir)) {
      if (!name.endsWith('.json')) continue;
      const otherSlug = name.slice(0, -5);
      if (otherSlug === slug) continue;
      const other = readJson(path.join(draftsDir, name), {});
      const aliases = identityAliases(otherSlug, other);
      if (!aliases.some(alias => containsPhrase(alias, franchiseToken))) continue;
      for (const alias of aliases) {
        if (!containsPhrase(alias, franchiseToken)) continue;
        if (targetAliases.includes(alias)) continue;
        if (alias === franchiseToken) continue;
        if (alias.length < franchiseToken.length + 2) continue;
        siblingAliases.add(alias);
      }
    }
  }
  return {
    slug,
    targetAliases,
    franchiseToken,
    siblingAliases: [...siblingAliases].sort((a, b) => b.length - a.length),
  };
}

const genericReviewPrefixes = [
  'review', 'review of', 'our review', 'our review of', 'hands on', 'hands on review',
  'обзор', 'обзор игры', 'рецензия', 'рецензия на',
].sort((a, b) => b.length - a.length);

function stripGenericReviewPrefix(value) {
  const normalized = normalizeReviewIdentity(value);
  for (const prefix of genericReviewPrefixes) {
    const normalizedPrefix = normalizeReviewIdentity(prefix);
    if (normalized === normalizedPrefix) return '';
    if (normalized.startsWith(`${normalizedPrefix} `)) return normalized.slice(normalizedPrefix.length + 1).trim();
  }
  return normalized;
}

function titleIdentifiesSibling(title, sibling) {
  const normalized = normalizeReviewIdentity(title);
  if (!normalized) return false;
  if (startsWithPhrase(normalized, sibling)) return true;
  for (const prefix of genericReviewPrefixes) {
    if (startsWithPhrase(normalized, `${prefix} ${sibling}`)) return true;
  }
  return false;
}

function urlIdentifiesSibling(value, sibling) {
  let parsed;
  try { parsed = new URL(String(value || '')); }
  catch { return false; }
  const segments = safeDecodedUrl(parsed.pathname).split('/').map(normalizeReviewIdentity).filter(Boolean);
  for (const segment of segments) {
    if (startsWithPhrase(segment, sibling)) return true;
    if (startsWithPhrase(segment, `review ${sibling}`)) return true;
    if (startsWithPhrase(segment, `reviews ${sibling}`)) return true;
    if (startsWithPhrase(segment, `обзор ${sibling}`)) return true;
  }
  return false;
}

function nonGameSubjectProblem(item, policy) {
  const franchise = normalizeReviewIdentity(policy.franchiseToken);
  if (!franchise) return '';
  const subject = stripGenericReviewPrefix(item?.title || '');
  if (!startsWithPhrase(subject, franchise)) return '';
  const tail = subject.slice(franchise.length).trim();
  if (/^(?:tv|television) (?:show|series)\b/.test(tail)) return 'non-game-subject:television';
  if (/^season\s+\d+\b/.test(tail)) return 'non-game-subject:television-season';
  if (/^(?:the )?(?:movie|film)(?: adaptation)?(?:\s|$)/.test(tail)) return 'non-game-subject:film';
  if (/^(?:the )?(?:board game|tabletop game|card game)(?:\s|$)/.test(tail)) return 'non-game-subject:tabletop';
  return '';
}

function targetIdentityEvidenced(item, policy) {
  if (!policy.franchiseToken) return true;
  const title = String(item?.title || '');
  const url = safeDecodedUrl(item?.resolved_url || item?.url || '');
  return containsPhrase(title, policy.franchiseToken) || containsPhrase(url, policy.franchiseToken);
}

export function reviewIdentityProblem(item, policy) {
  const explicitSlug = normalizeReviewIdentity(item?.game_slug || item?.slug || '');
  if (explicitSlug && explicitSlug !== normalizeReviewIdentity(policy.slug)) {
    return `explicit-game-slug-mismatch:${explicitSlug}`;
  }
  const url = String(item?.resolved_url || item?.url || '');
  const urlProblem = reviewUrlProblem(url);
  if (urlProblem) return urlProblem;
  if (!targetIdentityEvidenced(item, policy)) return 'target-game-identity-not-evidenced';
  const nonGameProblem = nonGameSubjectProblem(item, policy);
  if (nonGameProblem) return nonGameProblem;
  for (const sibling of policy.siblingAliases) {
    if (urlIdentifiesSibling(url, sibling) || titleIdentifiesSibling(item?.title || '', sibling)) {
      return `different-game-in-series:${sibling}`;
    }
  }
  return '';
}

export function reviewRowFingerprint(item) {
  return JSON.stringify({
    publication: normalizeReviewIdentity(item?.publication || item?.source || ''),
    title: normalizeReviewIdentity(item?.title || ''),
    url: String(item?.resolved_url || item?.url || '').trim(),
    score: item?.score ?? item?.original_score?.score ?? null,
    scale: item?.scale ?? item?.original_score?.scale ?? null,
    grade: String(item?.grade ?? item?.original_score?.grade ?? '').toUpperCase(),
    normalized_10: Number.isFinite(Number(item?.normalized_10)) ? Number(item.normalized_10) : null,
  });
}
