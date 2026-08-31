import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const slug = String(process.argv[2] || '').trim();
if (!slug) throw new Error('Usage: node scripts/recover-historical-review-scores.mjs <slug>');

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
const publicationKey = value => normalize(value)
  .replace(/\b(the|magazine|online|журнал|сайт|us|usa|uk|рус(?:ская|ский)?|россия)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const canonical = value => {
  try {
    const url = new URL(decodeHtml(value));
    url.hash = '';
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ysclid']) url.searchParams.delete(key);
    return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch { return String(value || '').trim(); }
};
const host = value => {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
};
const forbiddenHosts = ['wikipedia.org', 'wikimedia.org', 'wikidata.org', 'metacritic.com', 'opencritic.com', 'gamerankings.com', 'mobygames.com'];
const forbidden = value => {
  const h = host(value);
  return !h || forbiddenHosts.some(domain => h === domain || h.endsWith(`.${domain}`));
};

const reviews = read(`data/reviews/${slug}.json`, { reviews: [], score_sources: [] });
const draft = read(`data/drafts/${slug}.json`, {});
const quality = read('config/game-page-quality-v2.json', {});
const gradeMap = quality.rating?.letter_grade_map || {};
const currentReviews = Array.isArray(reviews.reviews) ? reviews.reviews : [];
const currentScoreSources = Array.isArray(reviews.score_sources) ? reviews.score_sources : [];
const title = String(draft.identity?.title || slug).trim();
const aliases = [...new Set([
  ...(Array.isArray(draft.identity?.aliases) ? draft.identity.aliases : []),
  title,
  title.split(':')[0],
  slug.replace(/-/g, ' '),
].map(normalize).filter(Boolean))].sort((a, b) => a.split(' ').length - b.split(' ').length || a.length - b.length);
const alias = aliases[0] || normalize(title);
const checkedAt = new Date().toISOString();

async function fetchText(url, timeout = 15000) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; IgropoiskHistoricalScoreRecovery/1.0)',
        'accept-language': 'en-US,en;q=.9,ru;q=.8',
      },
    });
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const text = response.ok && /text|html|json/.test(contentType) ? await response.text() : '';
    return { ok: response.ok, status: response.status, url: response.url || url, text };
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
  const search = await fetchText(api.href);
  if (!search.ok) return null;
  let payload;
  try { payload = JSON.parse(search.text); } catch { return null; }
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
  const page = await fetchText(pageUrl);
  if (!page.ok || !page.text) return null;
  return { lang, url: page.url || pageUrl, html: page.text };
}

function scoreFromCell(cellHtml) {
  const raw = decodeHtml(cellHtml).replace(/,/g, '.').trim();
  const fraction = raw.match(/\b([0-9]+(?:\.[0-9]+)?)\s*\/\s*(5|10|20|100)\b/);
  if (fraction) {
    const score = Number(fraction[1]);
    const scale = Number(fraction[2]);
    if (score >= 0 && score <= scale) return { score, scale, grade: '' };
  }
  const percent = raw.match(/\b([0-9]+(?:\.[0-9]+)?)\s*%/);
  if (percent) {
    const score = Number(percent[1]);
    if (score >= 0 && score <= 100) return { score, scale: 100, grade: '' };
  }
  const grade = raw.match(/(?:^|\s)(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F)(?:\s|$|\()/i)?.[1]?.toUpperCase() || '';
  if (grade && Number.isFinite(Number(gradeMap[grade]))) return { score: null, scale: null, grade };
  return null;
}

function outboundLinks(html, base) {
  const links = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    let href = decodeHtml(match[1]);
    try { href = new URL(href, base).href; } catch { continue; }
    if (!/^https?:\/\//i.test(href) || forbidden(href)) continue;
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
    if (!/(издание|publication|review|critic|реценз|оценка|score)/i.test(tableText) || !/(оценка|score|rating)/i.test(tableText)) continue;
    for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = rowMatch[0];
      const cells = [...rowHtml.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(match => match[1]);
      if (cells.length < 2) continue;
      const publication = decodeHtml(cells[0]).replace(/^«|»$/g, '').trim();
      const score = scoreFromCell(cells[1]);
      if (!publication || !score || /metacritic|opencritic|gamerankings|mobyrank|moby\s*games/i.test(publication)) continue;
      const refs = [];
      for (const refMatch of rowHtml.matchAll(/#cite_note-([^"'<>\s]+)/gi)) refs.push(decodeHtml(refMatch[1]));
      rows.push({ publication, score, refs: [...new Set(refs)], row_text: decodeHtml(rowHtml) });
    }
  }
  return rows;
}

function hasValidScore(item) {
  const score = Number(item?.score), scale = Number(item?.scale), grade = String(item?.grade || '').trim().toUpperCase();
  return (Number.isFinite(score) && Number.isFinite(scale) && scale > 0 && score >= 0 && score <= scale)
    || (grade && Number.isFinite(Number(gradeMap[grade])));
}

function findReview(publication) {
  const exact = normalize(publication);
  const simplified = publicationKey(publication);
  return currentReviews.find(item => normalize(item.publication || item.source) === exact)
    || currentReviews.find(item => {
      const key = publicationKey(item.publication || item.source);
      if (!key || !simplified) return false;
      return key === simplified || (Math.min(key.length, simplified.length) >= 5 && (key.includes(simplified) || simplified.includes(key)));
    });
}

const recovered = [];
const diagnostics = [];
const alreadyScored = new Set([
  ...currentReviews.filter(hasValidScore).map(item => publicationKey(item.publication || item.source)),
  ...currentScoreSources.filter(hasValidScore).map(item => publicationKey(item.publication || item.source)),
].filter(Boolean));

for (const lang of ['ru', 'en']) {
  const page = await resolveWikipediaPage(lang);
  if (!page) {
    diagnostics.push({ lang, status: 'unavailable' });
    continue;
  }
  const refs = referenceMap(page.html, page.url);
  const rows = tableRows(page.html);
  let matches = 0;
  let added = 0;
  for (const row of rows) {
    const review = findReview(row.publication);
    if (!review) continue;
    matches += 1;
    const key = publicationKey(review.publication || review.source || row.publication);
    if (!key || alreadyScored.has(key)) continue;
    const refUrls = [];
    for (const ref of row.refs) {
      refUrls.push(...(refs.get(ref) || []));
      const stripped = ref.replace(/_\d+$/, '');
      if (stripped !== ref) refUrls.push(...(refs.get(stripped) || []));
    }
    const reviewUrl = canonical(review.resolved_url || review.url || '');
    const evidenceUrl = reviewUrl && !forbidden(reviewUrl)
      ? reviewUrl
      : [...new Set(refUrls)].find(url => !forbidden(url)) || '';
    if (!evidenceUrl) continue;
    const publication = String(review.publication || review.source || row.publication).trim();
    recovered.push({
      publication,
      title: review.title || title,
      url: evidenceUrl,
      resolved_url: evidenceUrl,
      score: row.score.score,
      scale: row.score.scale,
      grade: row.score.grade,
      source_kind: 'historical_professional_review_score',
      score_eligible: true,
      score_extraction_method: `wikipedia-${lang}-review-table-secondary-evidence`,
      validation: {
        status: 'accepted-historical-score-evidence',
        checked_at: checkedAt,
        method: `wikipedia-${lang}-review-table-secondary-evidence`,
        secondary_evidence_url: page.url,
        evidence_row: row.row_text,
      },
    });
    alreadyScored.add(key);
    added += 1;
  }
  diagnostics.push({ lang, status: 'complete', page: page.url, review_rows: rows.length, matched_existing_reviews: matches, recovered_scores: added });
}

reviews.score_sources = [...currentScoreSources, ...recovered];
reviews.historical_score_recovery = {
  checked_at: checkedAt,
  recovered_scores: recovered.length,
  diagnostics,
  policy: 'Historical score values may use Wikipedia review tables only as secondary evidence and only when bound to an already accepted direct professional review URL. Aggregator URLs remain forbidden as publication sources.',
};
reviews.updated_at = checkedAt;
write(`data/reviews/${slug}.json`, reviews);
write(`data/parser-runs/historical-score-recovery-${slug}.json`, {
  parser: 'historical-review-score-recovery-v1',
  status: recovered.length ? 'completed' : 'no-new-scores',
  game_slug: slug,
  checked_at: checkedAt,
  recovered_scores: recovered.length,
  total_score_sources: reviews.score_sources.length,
  diagnostics,
});
console.log(JSON.stringify({ slug, recovered_scores: recovered.length, total_score_sources: reviews.score_sources.length, diagnostics }, null, 2));
