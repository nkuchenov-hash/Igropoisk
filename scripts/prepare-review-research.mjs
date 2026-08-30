import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const slug = String(process.argv[2] || '').trim();
if (!slug) {
  console.error('Usage: node scripts/prepare-review-research.mjs <game-slug>');
  process.exit(1);
}

const read = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch { return fallback; }
};
const write = (file, value) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};

const reviewConfig = read('config/parsers/review-synthesis.json', {});
const quality = read('config/game-page-quality-v2.json', {});
const corpus = quality.review_corpus || {};
const draft = read(`data/drafts/${slug}.json`);
if (!draft) throw new Error(`Missing data/drafts/${slug}.json`);

const seed = read(`data/reviews/${slug}.json`, {});
const seeds = Array.isArray(seed.reviews) ? seed.reviews : [];
const title = String(draft.identity?.title || slug).trim();
const year = Number(String(draft.release?.date || draft.release?.date_text || '').match(/(?:19|20)\d{2}/)?.[0] || 0);
const checkedAt = new Date().toISOString();
const minimum = Number(corpus.minimum_sources || 10);
const target = Number(corpus.target_sources || 20);

const extras = [
  { id: 'dtf', name: 'DTF', url: 'https://dtf.ru/games' },
  { id: 'dzen', name: 'Дзен', url: 'https://dzen.ru/' },
  { id: 'vgtimes', name: 'VGTimes', url: 'https://vgtimes.ru/games/' },
  { id: 'vk-play', name: 'VK Play Media', url: 'https://media.vkplay.ru/' },
  { id: 'ixbt-games', name: 'iXBT.games', url: 'https://ixbt.games/' },
  { id: 'gamemag', name: 'GameMAG.ru', url: 'https://gamemag.ru/' },
  { id: 'shazoo', name: 'Shazoo', url: 'https://shazoo.ru/' },
];

const registry = (reviewConfig.sources || [])
  .filter(source => source.enabled !== false && source.family === 'editorial')
  .map(source => ({
    id: String(source.id || source.name),
    name: String(source.name || source.id),
    url: String(source.url || ''),
    type: String(source.type || 'review-search'),
  }));
for (const extra of extras) {
  if (!registry.some(source => source.id === extra.id || source.name.toLowerCase() === extra.name.toLowerCase())) {
    registry.push(extra);
  }
}

const decode = value => String(value || '')
  .replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const canonical = value => {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ysclid']) {
      url.searchParams.delete(key);
    }
    return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch {
    return String(value || '').trim();
  }
};
const host = value => {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
};
const sourceDomain = source => {
  const h = host(source.url);
  return h === 'web.archive.org' ? '' : h;
};
const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/[®™©]/g, '')
  .replace(/[^a-z0-9а-яё]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const significantTokens = value => normalize(value).split(' ').filter(token => token.length > 1 || /^\d+$/.test(token));

// Steam frequently exposes a long store title while reviews use the short canonical name.
// Build identity variants from explicit aliases, the full title, the title before a colon,
// and the slug. A candidate only needs to match one variant, but numbered sequels are rejected
// when the target itself has no numeric identity token.
const aliasCandidates = [
  ...(Array.isArray(draft.identity?.aliases) ? draft.identity.aliases : []),
  title,
  title.split(':')[0],
  slug.replace(/-/g, ' '),
].map(value => String(value || '').trim()).filter(Boolean);
const aliases = [...new Set(aliasCandidates.map(normalize).filter(value => value.length >= 3))]
  .sort((a, b) => significantTokens(a).length - significantTokens(b).length || a.length - b.length);
const fullTitleNormalized = normalize(title);
const canonicalNumericTokens = significantTokens(fullTitleNormalized).filter(token => /^\d+$/.test(token));
const primaryAlias = aliases[0] || fullTitleNormalized;
const escapedPrimary = primaryAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
const numberedSequelRx = canonicalNumericTokens.length === 0 && primaryAlias.split(' ').length <= 4
  ? new RegExp(`\\b${escapedPrimary}\\s+(?:[2-9]\\d*|ii|iii|iv|v|vi|vii|viii|ix|x)\\b`, 'i')
  : null;

function identityMatch(value) {
  const hay = ` ${normalize(value)} `;
  const matched = aliases.find(alias => {
    const tokens = significantTokens(alias);
    return tokens.length && tokens.every(token => hay.includes(` ${token} `));
  });
  if (!matched) return { ok: false, alias: '' };
  if (numberedSequelRx && numberedSequelRx.test(normalize(value))) return { ok: false, alias: matched };
  if (canonicalNumericTokens.length && !canonicalNumericTokens.every(token => hay.includes(` ${token} `))) {
    return { ok: false, alias: matched };
  }
  return { ok: true, alias: matched };
}

const reviewSignal = value => /(review|retro(?:spective|view)?|opinion|longread|recenz|реценз|обзор|ретро|мнение|вердикт|reviewed)/i.test(String(value || ''));
const badSignal = value => /(walkthrough|guide|wiki|tips|cheat|news|preview|interview|how to|прохожд|гайд|новост|превью|интервью|steamcommunity|reddit\.com|user[- ]?review)/i.test(String(value || ''));
const aggregator = value => /(metacritic\.com|opencritic\.com)/i.test(host(value));

const parseRss = xml => {
  const out = [];
  for (const match of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const body = match[1];
    const pick = tag => decode((body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')) || [])[1] || '');
    const url = pick('link');
    if (url) out.push({ url, title: pick('title'), description: pick('description') });
  }
  return out;
};

async function bing(query) {
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('format', 'rss');
  url.searchParams.set('count', '50');
  url.searchParams.set('q', query);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; IgropoiskSourceDiscovery/7.0)',
        'accept-language': 'en-US,en;q=.9,ru;q=.8',
      },
    });
    if (!response.ok) return { ok: false, status: response.status, items: [] };
    return { ok: true, status: response.status, items: parseRss(await response.text()) };
  } catch (error) {
    return { ok: false, status: 0, error: error.message, items: [] };
  }
}

async function probe(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36',
        'accept-language': 'en-US,en;q=.9,ru;q=.8',
      },
    });
    if (!response.ok) return { ok: false, status: response.status, url: response.url || url, html: '' };
    const type = (response.headers.get('content-type') || '').toLowerCase();
    const html = /html|text/.test(type) ? await response.text() : '';
    return { ok: true, status: response.status, url: response.url || url, html };
  } catch (error) {
    return { ok: false, status: 0, url, error: error.message, html: '' };
  }
}

function scoreFromHtml(html) {
  const text = decode(html);
  const jsonPatterns = [
    /"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,240}?"bestRating"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,
    /"bestRating"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,240}?"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,
  ];
  for (let i = 0; i < jsonPatterns.length; i += 1) {
    const match = html.match(jsonPatterns[i]);
    if (!match) continue;
    const score = Number(i === 0 ? match[1] : match[2]);
    const scale = Number(i === 0 ? match[2] : match[1]);
    if (Number.isFinite(score) && Number.isFinite(scale) && scale > 0 && score >= 0 && score <= scale) return { score, scale };
  }
  const patterns = [
    /(?:overall\s+score|final\s+score|review\s+score|score|rating|grade)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*(5|10|20|100)\b/i,
    /\b([0-9]+(?:\.[0-9]+)?)\s*\/\s*(5|10|20|100)\b/i,
    /(?:overall\s+score|final\s+score|review\s+score|score|rating)\s*[:\-]?\s*([0-9]{1,3})\s*%\b/i,
  ];
  for (const rx of patterns) {
    const match = text.match(rx);
    if (!match) continue;
    const score = Number(match[1]);
    const scale = match[2] ? Number(match[2]) : 100;
    if (Number.isFinite(score) && Number.isFinite(scale) && scale > 0 && score >= 0 && score <= scale) return { score, scale };
  }
  return { score: null, scale: null };
}

function kindFor(value) {
  const text = String(value || '').toLowerCase();
  if (/retro|ретро/.test(text)) return 'retrospective_review';
  if (/opinion|мнение/.test(text)) return 'opinion';
  if (/longread|лонгрид/.test(text)) return 'longread';
  return 'review';
}

const candidateMap = new Map();
function addCandidate(raw, source = null, origin = 'search') {
  const url = canonical(raw.url);
  const identity = identityMatch(`${raw.title || ''} ${raw.description || ''} ${url}`);
  if (!url || aggregator(url) || badSignal(`${raw.title} ${url}`) || !identity.ok || !reviewSignal(`${raw.title} ${url} ${raw.description || ''}`)) return;
  const key = url.toLowerCase();
  if (candidateMap.has(key)) return;
  candidateMap.set(key, {
    publication: source?.name || raw.publication || host(url),
    configured_source_id: source?.id || raw.configured_source_id || '',
    title: raw.title || `${title} review`,
    url,
    source_kind: kindFor(`${raw.title} ${url}`),
    platform: '',
    version_context: '',
    published_at: '',
    author: '',
    score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : null,
    scale: Number.isFinite(Number(raw.scale)) ? Number(raw.scale) : null,
    grade: String(raw.grade || ''),
    matched_identity_alias: identity.alias,
    identity_evidence: `Discovered by ${origin}; matched alias: ${identity.alias}`,
  });
}

for (const item of seeds) {
  if (item?.url && !aggregator(item.url) && identityMatch(`${item.title || ''} ${item.url}`).ok) {
    addCandidate(item, { id: item.configured_source_id || '', name: item.publication || item.source || host(item.url) }, 'existing verified corpus');
  }
}

const queryAliases = aliases.slice(0, 3);
const preferredAlias = queryAliases[0] || title;
const checks = [];
let totalQueries = 0;
for (const source of registry) {
  const domain = sourceDomain(source);
  const queries = [];
  const alias = preferredAlias;
  if (domain) {
    queries.push(`"${alias}" review site:${domain}`);
    if (year) queries.push(`"${alias}" ${year} review site:${domain}`);
    queries.push(`"${alias}" обзор site:${domain}`);
  } else {
    queries.push(`"${alias}" review "${source.name}"`);
    if (year) queries.push(`"${alias}" ${year} "${source.name}" review`);
    queries.push(`"${alias}" обзор "${source.name}"`);
  }

  let searchAvailable = false;
  const before = candidateMap.size;
  for (const query of queries) {
    totalQueries += 1;
    const result = await bing(query);
    if (result.ok) searchAvailable = true;
    for (const item of result.items) {
      if (domain && host(item.url) !== domain && !host(item.url).endsWith(`.${domain}`)) continue;
      addCandidate(item, source, `registered-source search: ${query}`);
    }
  }
  checks.push({
    source_id: source.id,
    source_name: source.name,
    status: candidateMap.size > before ? 'found' : searchAvailable ? 'not_found' : 'unavailable',
    notes: candidateMap.size > before ? `${candidateMap.size - before} candidate(s) discovered` : searchAvailable ? 'search completed; no matching direct editorial material' : 'search provider unavailable',
  });
}

const broadQueries = [];
for (const alias of queryAliases.length ? queryAliases : [title]) {
  broadQueries.push(`"${alias}" review`, `"${alias}" retrospective`, `"${alias}" обзор`, `"${alias}" рецензия`);
  if (year) broadQueries.push(`"${alias}" review ${year}`);
}
const uniqueBroadQueries = [...new Set(broadQueries)].slice(0, 12);
let externalSearchAvailable = false;
for (const query of uniqueBroadQueries) {
  totalQueries += 1;
  const result = await bing(query);
  if (result.ok) externalSearchAvailable = true;
  for (const item of result.items) addCandidate(item, null, `broad web search: ${query}`);
}

const accepted = [];
const rejected = [];
for (const raw of candidateMap.values()) {
  const live = await probe(raw.url);
  if (!live.ok) {
    rejected.push({ publication: raw.publication, title: raw.title, url: raw.url, reasons: [`URL unavailable to verifier: ${live.status || live.error || 'network error'}`] });
    continue;
  }
  const resolved = canonical(live.url);
  const identity = identityMatch(`${raw.title} ${decode(live.html).slice(0, 8000)} ${resolved}`);
  if (!identity.ok) {
    rejected.push({ publication: raw.publication, title: raw.title, url: raw.url, reasons: ['resolved page failed canonical identity check'] });
    continue;
  }
  const extracted = scoreFromHtml(live.html);
  const score = raw.score ?? extracted.score;
  const scale = raw.scale ?? extracted.scale;
  accepted.push({
    ...raw,
    id: `source-${accepted.length + 1}`,
    url: raw.url,
    resolved_url: resolved,
    domain: host(resolved),
    score,
    scale,
    score_eligible: Number.isFinite(Number(score)) && Number.isFinite(Number(scale)) && Number(scale) > 0,
    validation: {
      status: 'accepted-readable-link',
      checked_at: checkedAt,
      http_status: live.status,
      method: 'registered-search-plus-live-http-v7-alias-aware',
    },
  });
}

const scoreSources = [];
const scoreSeen = new Set();
for (const item of [...seeds, ...accepted]) {
  const score = Number(item.score);
  const scale = Number(item.scale);
  const grade = String(item.grade || '').trim();
  if (!(Number.isFinite(score) && Number.isFinite(scale) && scale > 0) && !grade) continue;
  const publication = String(item.publication || item.source || '').trim();
  const key = publication.toLowerCase();
  if (!publication || scoreSeen.has(key)) continue;
  scoreSeen.add(key);
  scoreSources.push({
    publication,
    title: item.title || '',
    url: canonical(item.resolved_url || item.url),
    score: Number.isFinite(score) ? score : null,
    scale: Number.isFinite(scale) ? scale : null,
    grade,
    source_kind: item.source_kind || 'review',
  });
}

const registryComplete = checks.length === registry.length;
const searchComplete = registryComplete && externalSearchAvailable;
const matrix = {
  schema_version: 9,
  game_slug: slug,
  generated_at: checkedAt,
  policy: {
    maximum_readable_articles: null,
    collect_all_discovered: true,
    mandatory_registry_scan: true,
    broad_web_discovery: true,
    alias_aware_identity: true,
    ai_required: false,
    minimum_for_future_article: minimum,
    target_for_future_article: target,
    exact_identity_includes_numeric_tokens: true,
  },
  identity: {
    title,
    year: year || null,
    aliases,
    preferred_search_alias: preferredAlias,
  },
  source_registry_scan: {
    registered_sources: registry.length,
    settled_sources: checks.length,
    complete: registryComplete,
    checks,
  },
  external_search: {
    complete: externalSearchAvailable,
    provider: 'Bing RSS',
    queries: totalQueries,
  },
  accepted,
  rejected,
  score_sources: scoreSources,
  coverage: {
    accepted_readable_articles: accepted.length,
    scored_sources: scoreSources.length,
    page_material_scan_complete: searchComplete,
  },
  game_id: draft.identity?.game_id || draft.game_id || seed.game_id || null,
};

write(`data/research/${slug}-source-matrix.json`, matrix);
write(`data/reviews/${slug}.json`, {
  schema_version: 18,
  game_slug: slug,
  game_id: draft.identity?.game_id || draft.game_id || seed.game_id || null,
  updated_at: checkedAt,
  publication_gate: {
    minimum: 0,
    target: null,
    maximum: null,
    accepted: accepted.length,
    status: searchComplete ? 'green' : 'red-needs-revision',
    criterion: 'mandatory_registry_plus_broad_web_scan_complete',
    full_registry_scan: registryComplete,
    checked_registered_sources: registry.length,
  },
  source_registry_scan: matrix.source_registry_scan,
  external_search: matrix.external_search,
  reviews: accepted,
  score_sources: scoreSources,
  rejected,
});
write(`data/parser-runs/review-research-${slug}.json`, {
  parser: 'review-research-v7-alias-aware',
  status: searchComplete ? 'green' : 'needs_revision',
  game_slug: slug,
  checked_at: checkedAt,
  registered_sources: registry.length,
  registry_scan_complete: registryComplete,
  external_search_complete: externalSearchAvailable,
  accepted_readable_articles: accepted.length,
  scored_sources: scoreSources.length,
  rejected: rejected.length,
  collect_all_discovered: true,
  identity_aliases: aliases,
});

console.log(JSON.stringify({
  slug,
  status: searchComplete ? 'green' : 'red-needs-revision',
  aliases,
  preferred_search_alias: preferredAlias,
  registered_sources: registry.length,
  registry_scan_complete: registryComplete,
  external_search_complete: externalSearchAvailable,
  accepted_readable_articles: accepted.length,
  scored_sources: scoreSources.length,
  rejected: rejected.length,
  ai_required: false,
}, null, 2));
if (!searchComplete) process.exitCode = 2;
