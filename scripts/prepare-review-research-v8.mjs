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
const decode = value => String(value || '')
  .replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#x2F;/gi, '/')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const canonical = value => {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ysclid']) url.searchParams.delete(key);
    return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch { return String(value || '').trim(); }
};
const host = value => {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
};
const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/[®™©]/g, '')
  .replace(/[^a-z0-9а-яё]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const tokens = value => normalize(value).split(' ').filter(token => token.length > 1 || /^\d+$/.test(token));

const reviewConfig = read('config/parsers/review-synthesis.json', {});
const quality = read('config/game-page-quality-v2.json', {});
const corpus = quality.review_corpus || {};
const draft = read(`data/drafts/${slug}.json`);
if (!draft) throw new Error(`Missing data/drafts/${slug}.json`);
const previous = read(`data/reviews/${slug}.json`, {});
const seeds = Array.isArray(previous.reviews) ? previous.reviews : [];
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
  .map(source => ({ id: String(source.id || source.name), name: String(source.name || source.id), url: String(source.url || ''), type: String(source.type || 'review-search') }));
for (const extra of extras) if (!registry.some(source => source.id === extra.id)) registry.push(extra);

const aliasCandidates = [
  ...(Array.isArray(draft.identity?.aliases) ? draft.identity.aliases : []),
  title,
  title.split(':')[0],
  slug.replace(/-/g, ' '),
].map(value => String(value || '').trim()).filter(Boolean);
const aliases = [...new Set(aliasCandidates.map(normalize).filter(value => value.length >= 3))]
  .sort((a, b) => tokens(a).length - tokens(b).length || a.length - b.length);
const preferredAlias = aliases[0] || normalize(title);
const numericIdentity = tokens(title).filter(token => /^\d+$/.test(token));
const escapedPrimary = preferredAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
const sequelRx = numericIdentity.length === 0 && tokens(preferredAlias).length <= 4
  ? new RegExp(`\\b${escapedPrimary}\\s+(?:[2-9]\\d*|ii|iii|iv|v|vi|vii|viii|ix|x)\\b`, 'i')
  : null;
function identityMatch(value) {
  const normalized = normalize(value);
  const hay = ` ${normalized} `;
  const alias = aliases.find(candidate => {
    const required = tokens(candidate);
    return required.length > 0 && required.every(token => hay.includes(` ${token} `));
  });
  if (!alias) return { ok: false, alias: '' };
  if (sequelRx && sequelRx.test(normalized)) return { ok: false, alias };
  if (numericIdentity.length && !numericIdentity.every(token => hay.includes(` ${token} `))) return { ok: false, alias };
  return { ok: true, alias };
}

const reviewSignal = value => /(review|retro(?:spective|view)?|opinion|longread|recenz|реценз|обзор|ретро|мнение|вердикт|reviewed)/i.test(String(value || ''));
const badSignal = value => /(walkthrough|guide|wiki|tips|cheat|news|preview|interview|how to|прохожд|гайд|новост|превью|интервью|steamcommunity|reddit\.com|user[- ]?review)/i.test(String(value || ''));
const aggregator = value => /(metacritic\.com|opencritic\.com)/i.test(host(value));
const sourceDomain = source => {
  const domain = host(source.url);
  return domain === 'web.archive.org' ? '' : domain;
};

function parseRss(xml) {
  const out = [];
  for (const match of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const body = match[1];
    const pick = tag => decode((body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')) || [])[1] || '');
    const url = pick('link');
    if (url) out.push({ url, title: pick('title'), description: pick('description') });
  }
  return out;
}
function parseHtmlLinks(html, base) {
  const out = [];
  const text = String(html || '');
  for (const match of text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href = decode(match[1]);
    if (!href || /^javascript:|^mailto:|^#/.test(href)) continue;
    try { href = new URL(href, base).href; } catch { continue; }
    out.push({ url: canonical(href), title: decode(match[2]), description: '' });
  }
  return out;
}
function unwrapDuckDuckGo(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('duckduckgo.com') && parsed.searchParams.get('uddg')) return decodeURIComponent(parsed.searchParams.get('uddg'));
  } catch {}
  return url;
}

async function fetchText(url, timeout = 12000) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36',
        'accept-language': 'en-US,en;q=.9,ru;q=.8',
      },
    });
    if (!response.ok) return { ok: false, status: response.status, url: response.url || url, text: '' };
    return { ok: true, status: response.status, url: response.url || url, text: await response.text() };
  } catch (error) {
    return { ok: false, status: 0, url, error: error.message, text: '' };
  }
}
async function bingRss(query) {
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('format', 'rss');
  url.searchParams.set('count', '50');
  url.searchParams.set('q', query);
  const response = await fetchText(url.href);
  return { provider: 'bing-rss', ok: response.ok, status: response.status, items: response.ok ? parseRss(response.text) : [] };
}
async function duckDuckGo(query) {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);
  const response = await fetchText(url.href);
  if (!response.ok) return { provider: 'duckduckgo-html', ok: false, status: response.status, items: [] };
  const items = parseHtmlLinks(response.text, url.href)
    .map(item => ({ ...item, url: canonical(unwrapDuckDuckGo(item.url)) }))
    .filter(item => item.url.startsWith('http') && !host(item.url).endsWith('duckduckgo.com'));
  return { provider: 'duckduckgo-html', ok: true, status: response.status, items };
}
async function googleHtml(query) {
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('num', '30');
  url.searchParams.set('q', query);
  const response = await fetchText(url.href);
  if (!response.ok) return { provider: 'google-html', ok: false, status: response.status, items: [] };
  const items = [];
  for (const raw of parseHtmlLinks(response.text, url.href)) {
    let targetUrl = raw.url;
    try {
      const parsed = new URL(targetUrl);
      if (parsed.hostname.endsWith('google.com') && parsed.pathname === '/url' && parsed.searchParams.get('q')) targetUrl = parsed.searchParams.get('q');
    } catch {}
    if (targetUrl?.startsWith('http') && !host(targetUrl).endsWith('google.com')) items.push({ ...raw, url: canonical(targetUrl) });
  }
  return { provider: 'google-html', ok: true, status: response.status, items };
}
async function webSearch(query) {
  const merged = [];
  const seen = new Set();
  let available = false;
  const providers = [];
  for (const search of [bingRss, duckDuckGo, googleHtml]) {
    const result = await search(query);
    providers.push({ provider: result.provider, ok: result.ok, status: result.status, count: result.items.length });
    if (result.ok) available = true;
    for (const item of result.items) {
      const key = canonical(item.url).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    if (merged.length >= 20) break;
  }
  return { ok: available, items: merged, providers };
}

function scoreFromHtml(html) {
  const text = decode(html);
  const jsonPatterns = [
    /"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,320}?"bestRating"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,
    /"bestRating"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,320}?"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,
  ];
  for (let index = 0; index < jsonPatterns.length; index += 1) {
    const match = html.match(jsonPatterns[index]);
    if (!match) continue;
    const score = Number(index === 0 ? match[1] : match[2]);
    const scale = Number(index === 0 ? match[2] : match[1]);
    if (Number.isFinite(score) && Number.isFinite(scale) && scale > 0 && score >= 0 && score <= scale) return { score, scale, method: 'structured-rating' };
  }
  for (const rx of [
    /(?:overall\s+score|final\s+score|review\s+score|score|rating|grade)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*(5|10|20|100)\b/i,
    /\b([0-9]+(?:\.[0-9]+)?)\s*\/\s*(5|10|20|100)\b/i,
  ]) {
    const match = text.match(rx);
    if (!match) continue;
    const score = Number(match[1]);
    const scale = Number(match[2]);
    if (score >= 0 && score <= scale) return { score, scale, method: 'explicit-fraction' };
  }
  const percent = text.match(/(?:overall\s+score|final\s+score|review\s+score|score|rating)\s*[:\-]?\s*([0-9]{1,3})\s*%\b/i);
  if (percent) {
    const score = Number(percent[1]);
    if (score >= 0 && score <= 100) return { score, scale: 100, method: 'explicit-percent' };
  }
  const overall = text.match(/(?:overall\s+score|final\s+score|review\s+score)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)(?!\s*\/)/i);
  if (overall) {
    const score = Number(overall[1]);
    const scale = score > 10 ? 100 : 10;
    if (score >= 0 && score <= scale) return { score, scale, method: 'explicit-overall-score' };
  }
  return { score: null, scale: null, method: '' };
}
function kindFor(value) {
  const text = String(value || '').toLowerCase();
  if (/retro|ретро/.test(text)) return 'retrospective_review';
  if (/opinion|мнение/.test(text)) return 'opinion';
  if (/longread|лонгрид/.test(text)) return 'longread';
  return 'review';
}

const candidateMap = new Map();
function addCandidate(raw, source = null, origin = 'search', options = {}) {
  const url = canonical(raw.url);
  const identity = identityMatch(`${raw.title || ''} ${raw.description || ''} ${url}`);
  const sourceText = `${raw.title || ''} ${url} ${raw.description || ''}`;
  if (!url || aggregator(url) || badSignal(sourceText) || !identity.ok) return false;
  if (!options.trustedReviewPath && !reviewSignal(sourceText)) return false;
  const key = url.toLowerCase();
  if (candidateMap.has(key)) return false;
  candidateMap.set(key, {
    publication: source?.name || raw.publication || host(url),
    configured_source_id: source?.id || raw.configured_source_id || '',
    title: raw.title || `${title} review`,
    url,
    source_kind: kindFor(sourceText),
    platform: '', version_context: '', published_at: '', author: '',
    score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : null,
    scale: Number.isFinite(Number(raw.scale)) ? Number(raw.scale) : null,
    grade: String(raw.grade || ''),
    matched_identity_alias: identity.alias,
    identity_evidence: `Discovered by ${origin}; matched alias: ${identity.alias}`,
  });
  return true;
}

for (const item of seeds) {
  if (item?.url && !aggregator(item.url) && identityMatch(`${item.title || ''} ${item.url}`).ok) {
    addCandidate(item, { id: item.configured_source_id || '', name: item.publication || item.source || host(item.url) }, 'existing verified corpus');
  }
}

async function nativeHubDiscovery(source) {
  const hubs = [];
  if (source.id === 'gamespot') hubs.push(`https://www.gamespot.com/games/${slug}/reviews/`);
  if (source.id === 'rpgfan') hubs.push(`https://www.rpgfan.com/game/${slug}/`);
  if (source.id === 'gamepressure') hubs.push(`https://www.gamepressure.com/games/${slug}/z9`);
  if (!hubs.length) return { available: false, added: 0, hubs: [] };
  let available = false;
  let added = 0;
  const diagnostics = [];
  for (const hub of hubs) {
    const response = await fetchText(hub);
    diagnostics.push({ url: hub, ok: response.ok, status: response.status });
    if (!response.ok) continue;
    available = true;
    const hubIdentity = identityMatch(`${hub} ${decode(response.text).slice(0, 12000)}`);
    if (!hubIdentity.ok) continue;
    for (const item of parseHtmlLinks(response.text, response.url || hub)) {
      const candidateHost = host(item.url);
      const domain = sourceDomain(source);
      if (domain && candidateHost !== domain && !candidateHost.endsWith(`.${domain}`)) continue;
      const pathname = (() => { try { return new URL(item.url).pathname; } catch { return ''; } })();
      const trustedReviewPath = source.id === 'gamespot' ? /\/reviews\//i.test(pathname) : source.id === 'rpgfan' ? /\/review\//i.test(pathname) : /review|recenz/i.test(pathname);
      if (!trustedReviewPath) continue;
      if (addCandidate(item, source, `native publisher hub: ${hub}`, { trustedReviewPath: true })) added += 1;
    }
  }
  return { available, added, hubs: diagnostics };
}

const checks = [];
const providerDiagnostics = [];
const queryAlias = preferredAlias;
for (const source of registry) {
  const before = candidateMap.size;
  const domain = sourceDomain(source);
  let searchAvailable = false;
  const native = await nativeHubDiscovery(source);
  const queries = domain
    ? [`"${queryAlias}" review site:${domain}`, year ? `"${queryAlias}" ${year} review site:${domain}` : '', `"${queryAlias}" обзор site:${domain}`].filter(Boolean)
    : [`"${queryAlias}" review "${source.name}"`, year ? `"${queryAlias}" ${year} "${source.name}" review` : '', `"${queryAlias}" обзор "${source.name}"`].filter(Boolean);
  for (const query of queries) {
    const result = await webSearch(query);
    if (result.ok) searchAvailable = true;
    providerDiagnostics.push({ source_id: source.id, query, providers: result.providers });
    for (const item of result.items) {
      if (domain && host(item.url) !== domain && !host(item.url).endsWith(`.${domain}`)) continue;
      addCandidate(item, source, `multi-provider registered-source search: ${query}`);
    }
    if (candidateMap.size > before) break;
  }
  const found = candidateMap.size - before;
  checks.push({
    source_id: source.id,
    source_name: source.name,
    status: found > 0 ? 'found' : (searchAvailable || native.available) ? 'not_found' : 'unavailable',
    notes: found > 0 ? `${found} candidate(s) discovered` : (searchAvailable || native.available) ? 'publisher/search scan completed; no matching direct editorial material' : 'all discovery routes unavailable',
    native_hub: native,
  });
}

let externalSearchAvailable = false;
const broadQueries = [...new Set(aliases.slice(0, 3).flatMap(alias => [
  `"${alias}" review`,
  `"${alias}" retrospective`,
  `"${alias}" обзор`,
  `"${alias}" рецензия`,
  year ? `"${alias}" review ${year}` : '',
]).filter(Boolean))].slice(0, 12);
for (const query of broadQueries) {
  const result = await webSearch(query);
  if (result.ok) externalSearchAvailable = true;
  providerDiagnostics.push({ source_id: 'broad-web', query, providers: result.providers });
  for (const item of result.items) addCandidate(item, null, `multi-provider broad web search: ${query}`);
}

const accepted = [];
const rejected = [];
for (const raw of candidateMap.values()) {
  const live = await fetchText(raw.url);
  if (!live.ok) {
    rejected.push({ publication: raw.publication, title: raw.title, url: raw.url, reasons: [`URL unavailable to verifier: ${live.status || live.error || 'network error'}`] });
    continue;
  }
  const resolved = canonical(live.url);
  const pageText = decode(live.text);
  const identity = identityMatch(`${raw.title} ${resolved} ${pageText.slice(0, 20000)}`);
  if (!identity.ok) {
    rejected.push({ publication: raw.publication, title: raw.title, url: raw.url, reasons: ['resolved page failed canonical identity check'] });
    continue;
  }
  if (badSignal(`${raw.title} ${resolved}`)) {
    rejected.push({ publication: raw.publication, title: raw.title, url: raw.url, reasons: ['resolved page is not a professional review'] });
    continue;
  }
  const extracted = scoreFromHtml(live.text);
  const score = raw.score ?? extracted.score;
  const scale = raw.scale ?? extracted.scale;
  accepted.push({
    ...raw,
    id: `source-${accepted.length + 1}`,
    resolved_url: resolved,
    domain: host(resolved),
    score,
    scale,
    score_eligible: Number.isFinite(Number(score)) && Number.isFinite(Number(scale)) && Number(scale) > 0,
    score_extraction_method: extracted.method,
    validation: { status: 'accepted-readable-link', checked_at: checkedAt, http_status: live.status, method: 'publisher-hub-plus-multi-search-live-http-v8' },
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
  scoreSources.push({ publication, title: item.title || '', url: canonical(item.resolved_url || item.url), score: Number.isFinite(score) ? score : null, scale: Number.isFinite(scale) ? scale : null, grade, source_kind: item.source_kind || 'review' });
}

const registryComplete = checks.length === registry.length;
const searchComplete = registryComplete && (externalSearchAvailable || checks.some(check => check.status === 'found'));
const matrix = {
  schema_version: 10,
  game_slug: slug,
  generated_at: checkedAt,
  policy: {
    maximum_readable_articles: null,
    collect_all_discovered: true,
    mandatory_registry_scan: true,
    broad_web_discovery: true,
    multi_provider_discovery: true,
    publisher_native_hubs: true,
    alias_aware_identity: true,
    ai_required: false,
    minimum_for_future_article: minimum,
    target_for_future_article: target,
    exact_identity_includes_numeric_tokens: true,
  },
  identity: { title, year: year || null, aliases, preferred_search_alias: preferredAlias },
  source_registry_scan: { registered_sources: registry.length, settled_sources: checks.length, complete: registryComplete, checks },
  external_search: { complete: externalSearchAvailable, providers: ['bing-rss', 'duckduckgo-html', 'google-html'], queries: providerDiagnostics.length, diagnostics: providerDiagnostics },
  accepted,
  rejected,
  score_sources: scoreSources,
  coverage: { accepted_readable_articles: accepted.length, independent_publications: new Set(accepted.map(item => String(item.publication || '').toLowerCase()).filter(Boolean)).size, scored_sources: scoreSources.length, page_material_scan_complete: searchComplete },
  game_id: draft.identity?.game_id || draft.game_id || previous.game_id || null,
};
write(`data/research/${slug}-source-matrix.json`, matrix);
write(`data/reviews/${slug}.json`, {
  schema_version: 19,
  game_slug: slug,
  game_id: matrix.game_id,
  updated_at: checkedAt,
  publication_gate: { minimum: 0, target: null, maximum: null, accepted: accepted.length, status: searchComplete ? 'green' : 'red-needs-revision', criterion: 'mandatory_registry_plus_multi_provider_and_native_scan', full_registry_scan: registryComplete, checked_registered_sources: registry.length },
  source_registry_scan: matrix.source_registry_scan,
  external_search: matrix.external_search,
  reviews: accepted,
  score_sources: scoreSources,
  rejected,
});
write(`data/parser-runs/review-research-${slug}.json`, {
  parser: 'review-research-v8-multi-provider-native-hubs',
  status: searchComplete ? 'green' : 'needs_revision',
  game_slug: slug,
  checked_at: checkedAt,
  registered_sources: registry.length,
  registry_scan_complete: registryComplete,
  external_search_complete: externalSearchAvailable,
  accepted_readable_articles: accepted.length,
  independent_publications: matrix.coverage.independent_publications,
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
  independent_publications: matrix.coverage.independent_publications,
  scored_sources: scoreSources.length,
  rejected: rejected.length,
  ai_required: false,
}, null, 2));
if (!searchComplete) process.exitCode = 2;
