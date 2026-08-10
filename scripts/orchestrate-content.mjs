import fs from 'node:fs';
import path from 'node:path';
import {migrateRepository, writeMigrationArtifacts} from './lib/game-registry-migration.mjs';
import {GameRegistryApi, validateForPublication} from './lib/game-registry.mjs';
import {registerPopularCandidates, registerReleaseCandidates, resolveSystemGameIdentity} from './lib/system-game-registry-adapter.mjs';

const root = process.cwd();
const now = new Date().toISOString();
const args = new Set(process.argv.slice(2));
const finalize = args.has('--finalize');
const readJSON = (relative, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); } catch { return fallback; } };
const writeJSON = (relative, value) => { const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`); };

const migration = migrateRepository(root, {
  dryRun: !finalize,
  baseCommit: process.env.GITHUB_SHA ?? null,
  publicBaseUrl: '/game'
});

const popularPaths = ['data/popular/current.json', 'data/popular/published.json']
  .filter(relative => fs.existsSync(path.join(root, relative)));
const popularSnapshots = popularPaths.map(relative => readJSON(relative, {}));
const popularDiscovery = registerPopularCandidates(migration.registry, popularSnapshots);
migration.registry = popularDiscovery.registry;

const releasePaths = ['data/releases/public.json', 'data/releases/current.json']
  .filter(relative => fs.existsSync(path.join(root, relative)));
const releaseSnapshots = releasePaths.map(relative => readJSON(relative, {}));
const releaseDiscovery = registerReleaseCandidates(migration.registry, releaseSnapshots);
migration.registry = releaseDiscovery.registry;

migration.report.canonicalGames = Object.values(migration.registry.games ?? {})
  .filter(game => game.workflow?.status !== 'merged_into_another_game').length;
migration.report.popularDiscovery = {
  created: popularDiscovery.created,
  matched: popularDiscovery.matched,
  issues: popularDiscovery.issues.length
};
migration.report.releaseDiscovery = {
  created: releaseDiscovery.created,
  matched: releaseDiscovery.matched,
  issues: releaseDiscovery.issues.length
};

if (finalize) writeMigrationArtifacts(root, migration);
const api = new GameRegistryApi(migration.registry);
const config = readJSON('config/content-pipeline.json', {});
const limits = config.execution_limits ?? {};
const queue = [];
const popularRankById = new Map();
const publicReleaseIds = new Set();

for (const snapshot of popularSnapshots) {
  for (const [index, item] of (snapshot?.ranking ?? []).entries()) {
    const resolution = resolveSystemGameIdentity(item, api.registry);
    const entity = resolution.entity;
    if (!entity) continue;
    const rank = index + 1;
    const current = popularRankById.get(entity.id);
    if (!current || rank < current) popularRankById.set(entity.id, rank);
  }
}
for (const snapshot of releaseSnapshots) {
  for (const item of (snapshot?.releases ?? [])) {
    const resolution = resolveSystemGameIdentity(item, api.registry);
    if (resolution.entity) publicReleaseIds.add(resolution.entity.id);
  }
}

const queuePriority = (game, extra = 0) => {
  const rank = popularRankById.get(game.id) ?? null;
  const popularBoost = rank ? Math.max(20, 140 - rank * 5) : 0;
  const releaseBoost = publicReleaseIds.has(game.id) ? 110 : 0;
  return Number(game.priority?.score ?? 0) + popularBoost + releaseBoost + extra;
};

for (const game of Object.values(migration.registry.games)) {
  if (['rejected', 'merged_into_another_game'].includes(game.workflow.status)) continue;
  const gate = validateForPublication(game, {allowNoRelease: false});
  const slug = game.identity.slug.value;
  const title = game.identity.canonicalTitle.value;
  const steamAppId = game.externalIds.steamAppId ? Number(game.externalIds.steamAppId) : null;
  const popularRank = popularRankById.get(game.id) ?? null;
  const releaseCandidate = publicReleaseIds.has(game.id);
  if (game.workflow.status === 'needs_review') {
    queue.push({type: 'resolve_identity', game_id: game.id, slug, title, popular_rank: popularRank, release_candidate: releaseCandidate, priority: queuePriority(game, 100), reason: game.workflow.statusReason});
    continue;
  }
  if (!api.isPublished(game)) {
    queue.push({
      type: gate.passed ? 'build_page' : 'enrich_game', game_id: game.id, slug, title, steam_appid: steamAppId,
      popular_rank: popularRank, release_candidate: releaseCandidate,
      priority: queuePriority(game, gate.passed ? 60 : 30),
      reason: gate.passed ? 'canonical publication gate passed' : gate.errors.join(', ')
    });
  }
  if (game.workflow.igropoiskReviewStatus !== 'published' && ['ready_for_page','page_draft','published'].includes(game.workflow.status)) {
    queue.push({type: 'build_review', game_id: game.id, slug, title, popular_rank: popularRank, release_candidate: releaseCandidate, priority: queuePriority(game, 40), reason: 'Игропоиск review is not published'});
  }
}
queue.sort((a,b) => b.priority - a.priority || a.slug.localeCompare(b.slug));

const runnablePages = queue
  .filter(item => item.type === 'build_page' || (item.type === 'enrich_game' && (item.popular_rank || item.release_candidate)))
  .slice(0, Number(limits.pages_per_run ?? 2));
const runnableReviews = queue.filter(item => item.type === 'build_review').slice(0, Number(limits.reviews_per_run ?? 1));
const games = Object.values(migration.registry.games);
const status = {
  schema_version: 3,
  generated_at: now,
  mode: finalize ? 'finalize' : 'plan',
  canonical_registry: 'data/game-registry/registry.transition.json',
  summary: {
    source_records: migration.report.sourceRecords,
    games: games.length,
    published_pages: migration.report.publishedPages,
    published_reviews: games.filter(item => item.workflow.igropoiskReviewStatus === 'published').length,
    ready_for_page: migration.report.readyForPage,
    awaiting_sources: migration.report.awaitingSources,
    queued: queue.length,
    runnable_pages: runnablePages.length,
    runnable_reviews: runnableReviews.length,
    blocked_identity: migration.report.ambiguousCases,
    popular_ranked_games: popularRankById.size,
    popular_registered: popularDiscovery.created,
    popular_unresolved: popularDiscovery.issues.length,
    public_release_games: publicReleaseIds.size,
    releases_registered: releaseDiscovery.created,
    releases_unresolved: releaseDiscovery.issues.length
  },
  next: {pages: runnablePages, reviews: runnableReviews}
};
const legacyItems = games.map(game => ({
  game_id: game.id,
  slug: game.identity.slug.value,
  title: game.identity.canonicalTitle.value,
  year: Number(String(game.releases?.[0]?.date?.value ?? '').match(/\d{4}/)?.[0] ?? 0),
  steam_appid: game.externalIds.steamAppId ? Number(game.externalIds.steamAppId) : null,
  origin: game.discovery.map(item => item.source.name).join('+'),
  state: game.workflow.status,
  page: {curated: game.workflow.pageStatus !== 'not_started', gate_passed: api.isPublished(game), missing: validateForPublication(game).errors},
  review: {published: game.workflow.igropoiskReviewStatus === 'published'},
  problems: game.conflicts.map(item => item.field)
}));
writeJSON('data/content-pipeline/registry.json', {schema_version: 3, generated_at: now, canonical_registry: 'data/game-registry/registry.transition.json', items: legacyItems});
writeJSON('data/content-pipeline/queue.json', {schema_version: 3, generated_at: now, items: queue});
writeJSON('data/content-pipeline/status.json', status);
writeJSON('data/content-pipeline/execution-plan.json', {schema_version: 3, generated_at: now, pages: runnablePages, reviews: runnableReviews});
writeJSON('data/parser-runs/content-pipeline.json', {parser: 'content-pipeline', status: 'success', checked_at: now, summary: status.summary, output: 'data/content-pipeline/status.json'});
console.log(JSON.stringify(status, null, 2));
