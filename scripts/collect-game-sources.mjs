#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const slug = String(process.argv[2] || '').trim().toLowerCase();
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('Usage: node scripts/collect-game-sources.mjs <slug>');

const read = (relative, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); }
  catch { return fallback; }
};
const write = (relative, value) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};
const canonicalUrl = value => {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ysclid']) url.searchParams.delete(key);
    return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch { return String(value || '').trim(); }
};
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, ' ').replace(/\s+/g, ' ').trim();
const runDiscovery = () => {
  const child = spawnSync(process.execPath, ['scripts/prepare-review-research.mjs', slug], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  return child.status === 0;
};

const draft = read(`data/drafts/${slug}.json`);
if (!draft) throw new Error(`Missing data/drafts/${slug}.json`);

let matrix = read(`data/research/${slug}-source-matrix.json`, {});
let reviews = read(`data/reviews/${slug}.json`, {});
let discoveryComplete = matrix?.source_registry_scan?.complete === true && matrix?.coverage?.page_material_scan_complete === true;

// A page QC cycle must be able to build its own source corpus. The expensive web scan
// runs only when there is no already-complete scan for this game.
if (!discoveryComplete) {
  runDiscovery();
  matrix = read(`data/research/${slug}-source-matrix.json`, {});
  reviews = read(`data/reviews/${slug}.json`, {});
  discoveryComplete = matrix?.source_registry_scan?.complete === true && matrix?.coverage?.page_material_scan_complete === true;
}

const ratings = read(`data/ratings/${slug}.json`, {});
const professional = Array.isArray(reviews?.reviews) ? reviews.reviews : [];
const scoreRows = Array.isArray(ratings?.sources) ? ratings.sources : [];
const fallbackScoreRows = Array.isArray(reviews?.score_sources) ? reviews.score_sources : [];
const scoredPublications = new Set((scoreRows.length ? scoreRows : fallbackScoreRows)
  .map(item => normalize(item?.publication || item?.source))
  .filter(Boolean));
const publications = new Set(professional.map(item => normalize(item?.publication || item?.source)).filter(Boolean));

const sources = [];
const seen = new Set();
const add = source => {
  const url = canonicalUrl(source?.url || source?.resolved_url || '');
  const publication = String(source?.publication || source?.name || source?.source || '').trim();
  const key = `${url.toLowerCase()}|${normalize(publication)}|${source?.role || source?.type || ''}`;
  if ((!url && !publication) || seen.has(key)) return;
  seen.add(key);
  sources.push({ ...source, ...(url ? { url } : {}) });
};

for (const source of Array.isArray(draft?.sources) ? draft.sources : []) {
  if (typeof source === 'string') add({ name: source, role: 'structured_fact_source', type: 'structured_fact_source' });
  else add({ ...source, role: source?.role || 'structured_fact_source', type: source?.type || 'structured_fact_source' });
}
for (const item of professional) {
  const publication = String(item?.publication || item?.source || '').trim();
  add({
    publication,
    name: publication,
    title: item?.title || '',
    url: item?.resolved_url || item?.url || '',
    role: 'professional_review',
    type: 'professional_review',
    source_kind: item?.source_kind || 'review',
    score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null,
    scale: Number.isFinite(Number(item?.scale)) ? Number(item.scale) : null,
    grade: String(item?.grade || ''),
    score_eligible: scoredPublications.has(normalize(publication)),
    validation: item?.validation || null,
  });
}

const checkedAt = new Date().toISOString();
const output = {
  schema_version: 2,
  game_slug: slug,
  game_id: draft?.game_id || draft?.identity?.game_id || reviews?.game_id || null,
  checked_at: checkedAt,
  source_scan_complete: discoveryComplete,
  discovery: {
    complete: discoveryComplete,
    source_registry_complete: matrix?.source_registry_scan?.complete === true,
    page_material_scan_complete: matrix?.coverage?.page_material_scan_complete === true,
    external_search_complete: matrix?.external_search?.complete === true,
    method: 'registered-publications-plus-multi-provider-web-discovery',
  },
  counts: {
    total: sources.length,
    structured_fact_sources: sources.filter(item => item.role === 'structured_fact_source').length,
    professional_reviews: professional.length,
    independent_publications: publications.size,
    scored: scoredPublications.size,
  },
  sources,
  rejected: Array.isArray(reviews?.rejected) ? reviews.rejected : [],
  rating: {
    status: ratings?.status || 'not-calculated-yet',
    score_10: ratings?.calculation?.score_10 ?? null,
    source_count: Number(ratings?.calculation?.source_count || scoredPublications.size || 0),
  },
  research_matrix: `data/research/${slug}-source-matrix.json`,
  review_materials: `data/reviews/${slug}.json`,
  ratings: `data/ratings/${slug}.json`,
};
write(`data/game-sources/${slug}.json`, output);
write(`data/parser-runs/game-sources-${slug}.json`, {
  parser: 'game-page-source-corpus-v2',
  status: discoveryComplete ? 'green' : 'needs_revision',
  game_slug: slug,
  checked_at: checkedAt,
  professional_reviews: professional.length,
  independent_publications: publications.size,
  scored_sources: scoredPublications.size,
  source_scan_complete: discoveryComplete,
});

console.log(JSON.stringify({
  slug,
  status: discoveryComplete ? 'green' : 'red-needs-revision',
  sources: sources.length,
  professional_reviews: professional.length,
  independent_publications: publications.size,
  scored: scoredPublications.size,
  source_scan_complete: discoveryComplete,
}, null, 2));