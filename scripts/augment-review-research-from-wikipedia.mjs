import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const slug = String(process.argv[2] || '').trim();
if (!slug) throw new Error('Usage: node scripts/augment-review-research-from-wikipedia.mjs <slug>');

const read = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch { return fallback; }
};
const write = (file, value) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};
const decodeHtml = value => String(value || '')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&#x2F;/gi, '/')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const normalize = value => decodeHtml(value)
  .normalize('NFKD')
  .toLowerCase()
  .replace(/[^a-z0-9а-яё+.-]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const host = value => {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
};
const canonical = value => {
  try {
    const url = new URL(decodeHtml(value));
    url.hash = '';
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ysclid']) url.searchParams.delete(key);
    return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch { return String(value || '').trim(); }
};
const badLeadHosts = [
  'wikipedia.org', 'wikimedia.org', 'wikidata.org',
  'metacritic.com', 'opencritic.com', 'gamerankings.com', 'mobygames.com',
  'google.com', 'bing.com', 'duckduckgo.com',
];
const isBadLeadUrl = value => {
  const h = host(value);
  return !h || badLeadHosts.some(domain => h === domain || h.endsWith(`.${domain}`));
};
const isArchiveHost = value => /(^|\.)(web\.archive\.org|archive\.org|webcitation\.org)$/i.test(host(value));

const draft = read(`data/drafts/${slug}.json`);
if (!draft) throw new Error(`Missing draft for ${slug}`);
const reviews = read(`data/reviews/${slug}.json`, { reviews: [], score_sources: [] });
const matrix = read(`data/research/${slug}-source-matrix.json`, { accepted: [], score_sources: [], source_registry_scan: {} });
const quality = read('config/game-page-quality-v2.json', {});
const gradeMap = quality.rating?.letter_grade_map || {};
const title = String(draft.identity?.title || slug).trim();
const aliases = [...new Set([
  ...(Array.isArray(draft.identity?.aliases) ? draft.identity.aliases : []),
  title,
  title.split(':')[0],
  slug.replace(/-/g, ' '),
].map(value => normalize(value)).filter(Boolean))].sort((a, b) => a.split(' ').length - b.split(' ').length || a.length - b.length);
const alias = aliases[0] || normalize(title);
const checkedAt = new Date().toISOString();

async function fetchText(url, timeout = 10000) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; IgropoiskHistoricalReviewRecovery/1.0)',
        'accept-language': 'en-US,en;q=.9,ru;q=.8',
      },
    });
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const text = response.ok && /text|html|json/.test(contentType) ? await response.text() : '';
    return { ok: response.ok, status: response.status, url: response.url || url, text, contentType };
  } catch (error) {
    return { ok: false, status: 0, url, text: '', error: error.message };
  }
}

async function resolveWikipediaPage(lang) {
  const api = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  api.searchParams.set('action', 'query');
  api.searchParams.set('list', 'search');
  api.searchParams.set('format', 'json');
  api.searchParams.set('formatversion', '2');
  api.searchParams.set('srlimit', '8');
  api.searchParams.set('srnamespace', '0');
  api.searchParams.set('srsearch', `${alias} ${lang === 'ru' ? 'игра' : 'video game'}`);
  const response = await fetchText(api.href);
  if (!response.ok) return null;
  let payload;
  try { payload = JSON.parse(response.text); } catch { return null; }
  const results = payload?.query?.search || [];
  if (!results.length) return null;
  const normalizedAlias = normalize(alias);
  const preferred = results.find(item => {
    const name = normalize(item.title);
    return name.includes(normalizedAlias) && (lang === 'ru' ? /\bигр/.test(name) : /\bvideo game\b|\bgame\b/.test(name));
  }) || results.find(item => normalize(item.title).includes(normalizedAlias)) || results[0];
  const pageTitle = String(preferred.title || '').trim();
  if (!pageTitle) return null;
  const pageUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`;
  const page = await fetchText(pageUrl, 15000);
  if (!page.ok || !page.text) return null;
  return { lang, title: pageTitle, url: page.url || pageUrl, html: page.text };
}

function scoreFromCell(cellHtml) {
  const raw = decodeHtml(cellHtml).replace(/,/g, '.').trim();
  const fraction = raw.match(/\b([0-9]+(?:\.[0-9]+)?)\s*\/\s*(5|10|20|100)\b/);
  if (fraction) {
    const score = Number(fraction[1]);
    const scale = Number(fraction[2]);
    if (score >= 0 && score <= scale) return { score, scale, grade: '', display: `${score}/${scale}` };
  }
  const percent = raw.match(/\b([0-9]+(?:\.[0-9]+)?)\s*%/);
  if (percent) {
    const score = Number(percent[1]);
    if (score >= 0 && score <= 100) return { score, scale: 100, grade: '', display: `${score}%` };
  }
  const grade = raw.match(/(?:^|\s)(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F)(?:\s|$|\()/i)?.[1]?.toUpperCase() || '';
  if (grade && Number.isFinite(Number(gradeMap[grade]))) return { score: null, scale: null, grade, display: grade };
  return null;
}

function outboundLinks(html, base) {
  const links = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    let href = decodeHtml(match[1]);
    try { href = new URL(href, base).href; } catch { continue; }
    if (!/^https?:\/\//i.test(href) || isBadLeadUrl(href)) continue;
    links.push(canonical(href));
  }
  return [...new Set(links)];
}

function referenceMap(html, base) {
  const map = new Map();
  for (const match of String(html || '').matchAll(/<li\b[^>]*id=["']cite_note-([^"']+)["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    map.set(decodeHtml(match[1]), outboundLinks(match[2], base));
  }
  return map;
}

function tableRows(html) {
  const rows = [];
  for (const tableMatch of String(html || '').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = tableMatch[0];
    const tableText = normalize(tableHtml);
    const looksLikeReviewTable = /(издание|publication|review|critic|реценз|оценка|score)/i.test(tableText)
      && /(оценка|score|rating)/i.test(tableText);
    if (!looksLikeReviewTable) continue;
    for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = rowMatch[0];
      const cells = [...rowHtml.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(match => match[1]);
      if (cells.length < 2) continue;
      const publication = decodeHtml(cells[0]).replace(/^«|»$/g, '').trim();
      const score = scoreFromCell(cells[1]);
      if (!publication || !score) continue;
      if (/metacritic|opencritic|gamerankings|mobyrank|moby\s*games/i.test(publication)) continue;
      const refs = [];
      for (const refMatch of rowHtml.matchAll(/#cite_note-([^"'<>\s]+)/gi)) refs.push(decodeHtml(refMatch[1]));
      if (!refs.length) {
        for (const refMatch of rowHtml.matchAll(/id=["']cite_ref-([^"']+)["']/gi)) {
          const id = decodeHtml(refMatch[1]).replace(/_\d+$/, '');
          if (id) refs.push(id);
        }
      }
      rows.push({ publication, score, refs: [...new Set(refs)], row_text: decodeHtml(rowHtml) });
    }
  }
  return rows;
}

async function firstReachable(urls) {
  const ordered = [...new Set(urls)].sort((a, b) => Number(isArchiveHost(a)) - Number(isArchiveHost(b)));
  for (const url of ordered) {
    const response = await fetchText(url, 10000);
    if (response.ok) return { url: canonical(response.url || url), status: response.status, contentType: response.contentType, html: response.text };
  }
  return null;
}

function safeScoreFromReviewHtml(html) {
  if (!html) return null;
  const structured = String(html).match(/"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,320}?"bestRating"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i);
  if (structured) {
    const score = Number(structured[1]);
    const scale = Number(structured[2]);
    if (scale > 0 && score >= 0 && score <= scale) return { score, scale, grade: '', method: 'structured-rating' };
  }
  const structuredReverse = String(html).match(/"bestRating"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,320}?"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i);
  if (structuredReverse) {
    const scale = Number(structuredReverse[1]);
    const score = Number(structuredReverse[2]);
    if (scale > 0 && score >= 0 && score <= scale) return { score, scale, grade: '', method: 'structured-rating-reverse' };
  }
  const text = decodeHtml(html).replace(/,/g, '.');
  const contextual = text.match(/(?:overall\s+score|final\s+score|review\s+score|verdict|score|rating|итог(?:овая)?\s+оценка|оценка)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*(5|10|20|100)\b/i);
  if (contextual) {
    const score = Number(contextual[1]);
    const scale = Number(contextual[2]);
    if (score >= 0 && score <= scale) return { score, scale, grade: '', method: 'contextual-fraction' };
  }
  const overall = text.match(/(?:overall\s+score|final\s+score|review\s+score|итог(?:овая)?\s+оценка)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)(?:\s*\/\s*(100|10|5))?/i);
  if (overall) {
    const score = Number(overall[1]);
    const scale = overall[2] ? Number(overall[2]) : score > 10 ? 100 : 10;
    if (score >= 0 && score <= scale) return { score, scale, grade: '', method: 'contextual-overall' };
  }
  return null;
}

// Re-validate scores found by broad HTML search. This intentionally drops uncontextualized
// fractions such as navigation/page counters that can otherwise look like critic scores.
const currentReviews = Array.isArray(reviews.reviews) ? reviews.reviews : [];
for (const item of currentReviews) {
  if (!Number.isFinite(Number(item.score)) || !Number.isFinite(Number(item.scale))) continue;
  if (String(item.validation?.method || '').includes('wikipedia')) continue;
  const live = await fetchText(item.resolved_url || item.url, 10000);
  const safe = live.ok ? safeScoreFromReviewHtml(live.text) : null;
  if (safe) {
    item.score = safe.score;
    item.scale = safe.scale;
    item.grade = safe.grade;
    item.score_eligible = true;
    item.score_extraction_method = safe.method;
  } else {
    item.score = null;
    item.scale = null;
    item.grade = '';
    item.score_eligible = false;
    item.score_extraction_method = 'dropped-uncontextualized-score';
  }
}

const existingPublication = new Set(currentReviews.map(item => normalize(item.publication || item.source)).filter(Boolean));
const existingUrl = new Set(currentReviews.map(item => canonical(item.resolved_url || item.url).toLowerCase()).filter(Boolean));
const added = [];
const wikiDiagnostics = [];

for (const lang of ['ru', 'en']) {
  const page = await resolveWikipediaPage(lang);
  if (!page) {
    wikiDiagnostics.push({ lang, status: 'unavailable' });
    continue;
  }
  const refs = referenceMap(page.html, page.url);
  const rows = tableRows(page.html);
  let acceptedRows = 0;
  for (const row of rows) {
    const publicationKey = normalize(row.publication);
    if (!publicationKey || existingPublication.has(publicationKey)) continue;
    const urls = [];
    for (const ref of row.refs) {
      const direct = refs.get(ref) || [];
      urls.push(...direct);
      // MediaWiki can suffix repeated references with _0/_1 while the note id stays unsuffixed.
      const stripped = ref.replace(/_\d+$/, '');
      if (stripped !== ref) urls.push(...(refs.get(stripped) || []));
    }
    const filtered = [...new Set(urls)].filter(url => !isBadLeadUrl(url));
    if (!filtered.length) continue;
    const live = await firstReachable(filtered);
    if (!live || existingUrl.has(live.url.toLowerCase())) continue;
    const item = {
      id: `historical-${lang}-${added.length + 1}`,
      publication: row.publication,
      configured_source_id: '',
      title: `${title} — ${row.publication} review`,
      url: live.url,
      resolved_url: live.url,
      domain: host(live.url),
      source_kind: 'historical_review',
      platform: '',
      version_context: '',
      published_at: '',
      author: '',
      score: row.score.score,
      scale: row.score.scale,
      grade: row.score.grade,
      score_eligible: true,
      score_extraction_method: `trusted-reception-table-${lang}`,
      matched_identity_alias: alias,
      identity_evidence: `Professional score row on ${page.url}; direct/archived publication citation resolved live`,
      discovery_evidence: {
        kind: 'secondary-index-to-primary-source',
        index_url: page.url,
        row_text: row.row_text,
        reference_ids: row.refs,
      },
      validation: {
        status: 'accepted-readable-or-archived-professional-reference',
        checked_at: checkedAt,
        http_status: live.status,
        method: 'wikipedia-reception-lead-direct-source-v1',
      },
    };
    currentReviews.push(item);
    added.push(item);
    existingPublication.add(publicationKey);
    existingUrl.add(live.url.toLowerCase());
    acceptedRows += 1;
  }
  wikiDiagnostics.push({ lang, status: 'complete', page: page.url, review_rows: rows.length, accepted_new_sources: acceptedRows });
}

const allReviews = currentReviews;
const scoreSources = [];
const scoreSeen = new Set();
for (const item of allReviews) {
  const publication = String(item.publication || item.source || '').trim();
  const key = normalize(publication);
  if (!publication || !key || scoreSeen.has(key)) continue;
  const score = Number(item.score);
  const scale = Number(item.scale);
  const grade = String(item.grade || '').trim().toUpperCase();
  const numeric = Number.isFinite(score) && Number.isFinite(scale) && scale > 0 && score >= 0 && score <= scale;
  const graded = grade && Number.isFinite(Number(gradeMap[grade]));
  if (!numeric && !graded) continue;
  scoreSeen.add(key);
  scoreSources.push({
    publication,
    title: item.title || '',
    url: canonical(item.resolved_url || item.url),
    score: numeric ? score : null,
    scale: numeric ? scale : null,
    grade,
    source_kind: item.source_kind || 'review',
  });
}

reviews.schema_version = Math.max(Number(reviews.schema_version || 0), 20);
reviews.updated_at = checkedAt;
reviews.reviews = allReviews;
reviews.score_sources = scoreSources;
reviews.publication_gate = {
  ...(reviews.publication_gate || {}),
  accepted: allReviews.length,
  wikipedia_historical_recovery: true,
};
reviews.historical_recovery = {
  strategy: 'wikipedia-reception-table-as-lead-only',
  wikipedia_is_never_the_final_review_url: true,
  aggregators_are_never_final_review_urls: true,
  checked_at: checkedAt,
  diagnostics: wikiDiagnostics,
  added_sources: added.length,
};

const matrixAccepted = [];
const matrixSeen = new Set();
for (const item of [...(Array.isArray(matrix.accepted) ? matrix.accepted : []), ...allReviews]) {
  const url = canonical(item.resolved_url || item.url);
  const key = `${normalize(item.publication || item.source)}|${url.toLowerCase()}`;
  if (!url || matrixSeen.has(key)) continue;
  matrixSeen.add(key);
  matrixAccepted.push(item);
}
matrix.schema_version = Math.max(Number(matrix.schema_version || 0), 11);
matrix.generated_at = checkedAt;
matrix.accepted = matrixAccepted;
matrix.score_sources = scoreSources;
matrix.historical_recovery = reviews.historical_recovery;
matrix.coverage = {
  ...(matrix.coverage || {}),
  accepted_readable_articles: matrixAccepted.length,
  independent_publications: new Set(matrixAccepted.map(item => normalize(item.publication || item.source)).filter(Boolean)).size,
  scored_sources: scoreSources.length,
};
if (Array.isArray(matrix.source_registry_scan?.checks)) {
  const found = new Set(matrixAccepted.map(item => normalize(item.publication || item.source)).filter(Boolean));
  matrix.source_registry_scan.checks = matrix.source_registry_scan.checks.map(check => {
    const key = normalize(check.source_name || check.name);
    return found.has(key) ? { ...check, status: 'found', notes: 'verified direct/archived professional review material found' } : check;
  });
}

write(`data/reviews/${slug}.json`, reviews);
write(`data/research/${slug}-source-matrix.json`, matrix);
write(`data/parser-runs/review-historical-recovery-${slug}.json`, {
  parser: 'review-historical-recovery-wikipedia-leads-v1',
  status: 'completed',
  game_slug: slug,
  checked_at: checkedAt,
  added_sources: added.length,
  total_reviews: matrix.coverage.accepted_readable_articles,
  independent_publications: matrix.coverage.independent_publications,
  scored_sources: scoreSources.length,
  diagnostics: wikiDiagnostics,
});

console.log(JSON.stringify({
  slug,
  added_sources: added.length,
  total_reviews: matrix.coverage.accepted_readable_articles,
  independent_publications: matrix.coverage.independent_publications,
  scored_sources: scoreSources.length,
  diagnostics: wikiDiagnostics,
}, null, 2));
