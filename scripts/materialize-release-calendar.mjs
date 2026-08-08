import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCandidates, buildPublicCalendar, validateCalendar } from './lib/release-calendar-policy.mjs';
import { migrateRepository } from './lib/game-registry-migration.mjs';
import { attachCanonicalGameIdsToPublicCalendar, linkReleaseCandidatesToRegistry } from './lib/release-game-registry-adapter.mjs';
import { attachAudienceAffinity, buildPersonalizedReleases, validatePersonalizedReleases } from './lib/release-audience-relevance.mjs';
import { enrichRawReleasesFromSteamEditorial } from './lib/release-steam-editorial-discovery.mjs';
import { ensureVisibleReleaseCovers, validateVisibleReleaseCovers } from './lib/release-cover-resolver.mjs';

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
const steamEditorial = await enrichRawReleasesFromSteamEditorial(
  Array.isArray(raw?.releases) ? raw.releases : [],
  policy,
  generatedAt,
);
const rawCandidates = buildCandidates({
  rawReleases: steamEditorial.releases,
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
let candidates = attachAudienceAffinity(linkage.candidates, newsEvents);

const personalizedPreview = buildPersonalizedReleases(candidates, policy);
const visibleIds = new Set([
  ...candidates.filter(candidate => candidate.moderation?.status === 'published' && !candidate.moderation?.publication_forbidden).map(candidate => candidate.id),
  ...personalizedPreview.map(release => release.id),
]);
const coverResolution = await ensureVisibleReleaseCovers(candidates, {
  root: ROOT,
  visibleIds,
  minimumBytes: 4_000,
  concurrency: 6,
});
candidates = coverResolution.candidates;

let publicCalendar = buildPublicCalendar(candidates, generatedAt);
publicCalendar.personalized_releases = buildPersonalizedReleases(candidates, policy);
publicCalendar.personalization = {
  model: 'user-context-region-v1',
  minimum_region_score: Number(policy.minimum_personalized_region_score || 160),
  client_minimum_score: Number(policy.personalized_client_minimum_score || 90),
};
publicCalendar.statistics.personalized = publicCalendar.personalized_releases.length;
publicCalendar.statistics.coverage_percent = coverResolution.statistics.coverage_percent;
publicCalendar = attachCanonicalGameIdsToPublicCalendar(publicCalendar, candidates);
const errors = [
  ...validateCalendar({ candidates, publicCalendar, policy }),
  ...validatePersonalizedReleases({ candidates, publicCalendar, policy }),
  ...validateVisibleReleaseCovers(publicCalendar),
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
  schema_version: 3,
  generated_at: generatedAt,
  sources: {
    active_discovery: [
      'Steam coming-soon/appdetails (PC only)',
      'Steam Popular Upcoming editorial discovery',
      'Steam Popular New Releases editorial discovery',
    ],
    steam_editorial_discovery: {
      discovered_candidates: steamEditorial.discovered,
      sources: steamEditorial.sources,
    },
    release_cover_resolution: {
      strategy: 'verified local asset required for every globally or personally visible release',
      preferred: 'Steam library 600x900 cover',
      fallbacks: ['existing official image', 'Steam capsule', 'Steam header', 'Steam background', 'Steam screenshot'],
      ...coverResolution.statistics,
      unresolved: coverResolution.unresolved,
    },
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
