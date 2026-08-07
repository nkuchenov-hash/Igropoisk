import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCandidates, buildPublicCalendar, validateCalendar } from './lib/release-calendar-policy.mjs';
import { migrateRepository } from './lib/game-registry-migration.mjs';
import { attachCanonicalGameIdsToPublicCalendar, linkReleaseCandidatesToRegistry } from './lib/release-game-registry-adapter.mjs';

const ROOT = process.cwd();
const paths = {
  raw: path.join(ROOT, 'data/releases/current.json'),
  editorial: path.join(ROOT, 'data/release-candidates/editorial.json'),
  claims: path.join(ROOT, 'config/release-official-claims.json'),
  policy: path.join(ROOT, 'config/release-calendar.json'),
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

const [raw, editorial, claimsDoc, policy] = await Promise.all([
  readJson(paths.raw, { releases: [] }),
  readJson(paths.editorial, { schema_version: 1, decisions: {} }),
  readJson(paths.claims, { schema_version: 1, claims: [] }),
  readJson(paths.policy, {}),
]);

const generatedAt = new Date().toISOString();
const rawCandidates = buildCandidates({
  rawReleases: Array.isArray(raw?.releases) ? raw.releases : [],
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
const candidates = linkage.candidates;
let publicCalendar = buildPublicCalendar(candidates, generatedAt);
publicCalendar = attachCanonicalGameIdsToPublicCalendar(publicCalendar, candidates);
const errors = validateCalendar({ candidates, publicCalendar, policy });
const candidateDocument = {
  schema_version: 2,
  generated_at: generatedAt,
  raw_generated_at: raw?.generated_at || null,
  candidates,
  statistics: publicCalendar.statistics,
};
const report = {
  schema_version: 1,
  generated_at: generatedAt,
  sources: {
    active_discovery: ['Steam coming-soon/appdetails (PC only)'],
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
