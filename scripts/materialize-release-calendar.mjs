import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCandidates, buildPublicCalendar, validateCalendar } from './lib/release-calendar-policy.mjs';
import { migrateRepository } from './lib/game-registry-migration.mjs';
import { attachCanonicalGameIdsToPublicCalendar, linkReleaseCandidatesToRegistry } from './lib/release-game-registry-adapter.mjs';
import { attachAudienceAffinity, buildPersonalizedReleases, validatePersonalizedReleases } from './lib/release-audience-relevance.mjs';

const ROOT = process.cwd();
const paths = {
  raw: path.join(ROOT, 'data/releases/current.json'),
  editorial: path.join(ROOT, 'data/release-candidates/editorial.json'),
  claims: path.join(ROOT, 'config/release-official-claims.json'),
  policy: path.join(ROOT, 'config/release-calendar.json'),
  news: path.join(ROOT, 'data/news-events.json'),
  rankedNews: path.join(ROOT, 'data/news.json'),
  candidates: path.join(ROOT, 'data/release-candidates/current.json'),
  public: path.join(ROOT, 'data/releases/public.json'),
  report: path.join(ROOT, 'data/releases/materialization-report.json'),
};

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${path.relative(ROOT, file)}: ${error.message}`);
  }
}

async function fetchSteamPopularUpcomingIds(limit = 200) {
  const url = `https://store.steampowered.com/search/results/?query&start=0&count=${limit}&dynamic_data=&filter=popularcomingsoon&cc=us&l=english&json=1`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'user-agent': 'Mozilla/5.0 IgropoiskReleaseMaterializer/1.0', 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const html = String(payload?.results_html || '');
    return new Set([...html.matchAll(/data-ds-appid="([^"]+)"/gi)]
      .flatMap(match => String(match[1]).split(','))
      .map(value => Number(value.trim()))
      .filter(Number.isFinite));
  } catch (error) {
    console.warn(`Steam popular-coming-soon signal unavailable: ${error.message}`);
    return new Set();
  }
}

function attachSteamPopularity(rawReleases, popularIds) {
  if (!popularIds.size) return rawReleases;
  return (rawReleases || []).map(release => {
    const steamId = Number(release?.external_ids?.steam);
    if (!Number.isFinite(steamId) || !popularIds.has(steamId)) return release;
    const quality = release.editorial_quality || {};
    return {
      ...release,
      editorial_quality: {
        ...quality,
        signals: [...new Set([...(quality.signals || []), 'steam_popular_upcoming'])],
      },
    };
  });
}

function deduplicateCandidates(candidates) {
  const byId = new Map();
  const statusRank = { rejected: 0, review: 1, published: 2 };
  for (const candidate of candidates) {
    const previous = byId.get(candidate.id);
    if (!previous) {
      byId.set(candidate.id, candidate);
      continue;
    }
    const previousScore = Number(previous.significance?.score || 0);
    const candidateScore = Number(candidate.significance?.score || 0);
    const previousRank = statusRank[previous.moderation?.status] ?? 0;
    const candidateRank = statusRank[candidate.moderation?.status] ?? 0;
    if (candidateScore > previousScore || (candidateScore === previousScore && candidateRank > previousRank)) {
      byId.set(candidate.id, candidate);
    }
  }
  return [...byId.values()];
}

const [raw, editorial, claimsDoc, policy, newsDoc, rankedNewsDoc] = await Promise.all([
  readJson(paths.raw, { releases: [] }),
  readJson(paths.editorial, { schema_version: 1, decisions: {} }),
  readJson(paths.claims, { schema_version: 1, claims: [] }),
  readJson(paths.policy, {}),
  readJson(paths.news, { items: [] }),
  readJson(paths.rankedNews, { items: [] }),
]);

const generatedAt = new Date().toISOString();
const popularUpcomingIds = await fetchSteamPopularUpcomingIds(Number(policy.steam_popular_upcoming_limit || 200));
const releaseInput = attachSteamPopularity(Array.isArray(raw?.releases) ? raw.releases : [], popularUpcomingIds);
const rawCandidates = buildCandidates({
  rawReleases: releaseInput,
  editorial,
  officialClaims: Array.isArray(claimsDoc?.claims) ? claimsDoc.claims : [],
  policy,
});
const deduplicatedCandidates = deduplicateCandidates(rawCandidates);
const registryMigration = migrateRepository(ROOT, {
  dryRun: true,
  now: generatedAt,
  baseCommit: process.env.GITHUB_SHA || null,
  publicBaseUrl: '/game',
});
const linkage = linkReleaseCandidatesToRegistry(deduplicatedCandidates, registryMigration.registry);
const eventNews = Array.isArray(newsDoc) ? newsDoc : (Array.isArray(newsDoc?.items) ? newsDoc.items : []);
const rankedNews = Array.isArray(rankedNewsDoc) ? rankedNewsDoc : (Array.isArray(rankedNewsDoc?.items) ? rankedNewsDoc.items : []);
const newsEvents = [...eventNews, ...rankedNews];
const candidates = attachAudienceAffinity(linkage.candidates, newsEvents);
let publicCalendar = buildPublicCalendar(candidates, generatedAt);
publicCalendar.personalized_releases = buildPersonalizedReleases(candidates, policy);
publicCalendar.personalization = {
  model: 'user-context-region-v1',
  minimum_region_score: Number(policy.minimum_personalized_region_score || 160),
  client_minimum_score: Number(policy.personalized_client_minimum_score || 90),
};
publicCalendar.statistics.personalized = publicCalendar.personalized_releases.length;
publicCalendar = attachCanonicalGameIdsToPublicCalendar(publicCalendar, candidates);
const errors = [
  ...validateCalendar({ candidates, publicCalendar, policy }),
  ...validatePersonalizedReleases({ candidates, publicCalendar, policy }),
];

const candidateDocument = {
  schema_version: 3,
  generated_at: generatedAt,
  raw_generated_at: raw?.generated_at || null,
  news_generated_at: newsDoc?.generatedAt || null,
  candidates,
  statistics: publicCalendar.statistics,
};
const report = {
  schema_version: 2,
  generated_at: generatedAt,
  sources: {
    active_discovery: ['Steam coming-soon/appdetails (PC only)', 'Steam popular-coming-soon relevance signal'],
    audience_relevance: ['News event and ranked-news regional scores linked by canonical game slug or title evidence'],
    optional_auxiliary: ['RAWG enrichment when RAWG_API_KEY is configured'],
    supported_auxiliary: ['IGDB/RAWG claims are discovery/cross-check only and cannot confirm a date alone'],
    console_authority: ['Official platform stores', 'publisher/developer sites', 'official announcements via config/release-official-claims.json'],
  },
  statistics: publicCalendar.statistics,
  game_registry_linkage: {
    canonical_games_considered: registryMigration.report.canonicalGames,
    ...linkage.statistics,
  },
  validation_errors: errors,
};
await Promise.all([
  fs.mkdir(path.dirname(paths.candidates), { recursive: true }),
  fs.mkdir(path.dirname(paths.public), { recursive: true }),
]);
await Promise.all([
  fs.writeFile(paths.candidates, `${JSON.stringify(candidateDocument, null, 2)}\n`),
  fs.writeFile(paths.public, `${JSON.stringify(publicCalendar, null, 2)}\n`),
  fs.writeFile(paths.report, `${JSON.stringify(report, null, 2)}\n`),
]);
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
