import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ARTICLE_TYPES, GameRegistryApi, calculatePriority, createRegistry,
  fieldValue, inferKind, normalizeAlias, normalizeExternalIds, rebuildIndexes, slugify
} from './game-registry.mjs';

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const listJson = directory => fs.existsSync(directory)
  ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort().map(name => path.join(directory, name))
  : [];
const listJsonRecursive = directory => {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true}).sort((a,b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) files.push(full);
    }
  };
  walk(directory);
  return files;
};
const source = (name, type = 'automated_inference', url = null) => ({name, type, url});

function migrationKind(candidate = {}) {
  const rawTitle = candidate.canonicalTitle ?? candidate.title ?? candidate.name ?? candidate.slug ?? '';
  const normalizedTitle = String(rawTitle).replace(/[-_]+/g, ' ');
  return inferKind({ ...candidate, kind: undefined, type: undefined, title: normalizedTitle });
}

function canonicalSeedId(candidate = {}) {
  const external = normalizeExternalIds(candidate.externalIds ?? candidate.external_ids ?? candidate);
  const identifiers = [
    ['igdb', external.igdbId], ['rawg', external.rawgId], ['steam', external.steamAppId],
    ['playstation', external.playstation?.length ? external.playstation.join(',') : null],
    ['xbox', external.xbox?.length ? external.xbox.join(',') : null],
    ['nintendo', external.nintendo?.length ? external.nintendo.join(',') : null]
  ];
  const strongest = identifiers.find(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');
  const basis = strongest
    ? `${strongest[0]}:${strongest[1]}`
    : `${normalizeAlias(candidate.canonicalTitle ?? candidate.title ?? candidate.name ?? candidate.slug)}:${candidate.releaseYear ?? candidate.year ?? ''}:${migrationKind(candidate)}`;
  return `game_${crypto.createHash('sha256').update(basis).digest('hex').slice(0, 20)}`;
}

function seeded(candidate) { return { ...candidate, kind: migrationKind(candidate), id: canonicalSeedId(candidate) }; }

function toRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const key of ['items','games','releases','articles','reviews','entries']) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && typeof payload[key] === 'object') return Object.entries(payload[key]).map(([slug, value]) => ({slug, ...value}));
  }
  return [];
}

function flattenGameContent(payload, file) {
  return Object.entries(payload?.games ?? {}).map(([slug, game]) => seeded({
    ...game, slug, title: game.identity?.title ?? game.title ?? slug,
    steamAppId: game.identity?.steam_appid ?? game.external_ids?.steam ?? null,
    source: source(`game-content:${path.basename(file)}`, 'manual'), discoveryReason: 'migrated_curated_game_content',
    pageStatus: game.publication?.status === 'published' ? 'published' : 'page_draft',
    status: game.publication?.status === 'published' ? 'published' : 'enriching', statusReason: 'curated game-content record', raw: game
  }));
}

function candidateFromCatalog(item) {
  return seeded({
    title: item.title ?? item.name, slug: item.slug ?? slugify(item.title ?? item.name), year: item.year ?? null,
    steamAppId: item.steam_appid ?? null, source: source('data/catalog-visible.json', 'manual'),
    discoveryReason: 'migrated_visible_catalog', status: 'identified', statusReason: 'present in visible catalog'
  });
}

function candidateFromPipeline(item) {
  return seeded({
    title: item.game_title ?? item.slug ?? item.title ?? item.name, slug: item.slug, year: item.year ?? null,
    steamAppId: item.steam_appid ?? null, source: source('data/content-pipeline/registry.json', 'automated_inference'),
    discoveryReason: `migrated_content_pipeline:${item.origin ?? 'unknown'}`,
    status: item.state === 'published' || item.state === 'review_published' ? 'published' : item.state === 'collecting' ? 'enriching' : 'discovered',
    statusReason: `legacy pipeline state: ${item.state ?? 'unknown'}`,
    pageStatus: item.page?.gate_passed ? 'published' : item.page?.curated ? 'page_draft' : 'not_started', raw: item
  });
}

function candidateFromLoose(item, origin, confidence = 0.45) {
  const title = item.title ?? item.name ?? item.identity?.title ?? item.slug;
  if (!title) return null;
  return seeded({
    title, slug: item.slug ?? slugify(title), aliases: item.aliases ?? item.alternative_titles ?? [],
    externalIds: normalizeExternalIds(item.externalIds ?? item.external_ids ?? item.identity ?? item),
    releases: item.events ?? item.releases ?? (item.release_date ? [{date: item.release_date, platform: item.platform ?? null}] : []),
    source: source(origin, origin.includes('release') ? 'platform_store' : 'automated_inference'),
    discoveryReason: `migrated_${origin.replace(/[^a-z0-9]+/gi, '_')}`, confidence, status: 'discovered', statusReason: `discovered in ${origin}`, raw: item
  });
}

function scanPublishedPages(root) {
  const gameRoot = path.join(root, 'game');
  if (!fs.existsSync(gameRoot)) return [];
  return fs.readdirSync(gameRoot, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && entry.name !== '_shared')
    .filter(entry => fs.existsSync(path.join(gameRoot, entry.name, 'index.html')))
    .map(entry => seeded({
      title: entry.name, slug: entry.name, source: source(`game/${entry.name}/index.html`, 'manual'),
      discoveryReason: 'migrated_published_page', status: 'published', statusReason: 'existing published page', pageStatus: 'published', confidence: 0.75
    }));
}

function scanCandidates(root) {
  const sources = [];
  const add = (origin, rows) => { for (const row of rows.filter(Boolean)) sources.push({origin, candidate: row}); };
  const catalog = readJson(path.join(root, 'data/catalog-visible.json'));
  add('catalog-visible', (Array.isArray(catalog) ? catalog : []).map(candidateFromCatalog));
  const pipeline = readJson(path.join(root, 'data/content-pipeline/registry.json'));
  add('content-pipeline-registry', toRows(pipeline).map(candidateFromPipeline));
  const publicGames = readJson(path.join(root, 'data/public/games.json'));
  const publicRows = toRows(publicGames).length ? toRows(publicGames) : (publicGames ? [publicGames] : []);
  add('public-games', publicRows.map(item => candidateFromLoose(item, 'public-games', 0.7)));
  for (const file of listJson(path.join(root, 'data/game-content'))) add('game-content', flattenGameContent(readJson(file), file));
  for (const [directory, origin, recursive] of [
    ['data/drafts','drafts',false], ['data/parser-output','parser-output',false],
    ['data/releases','release-calendar',true], ['data/popular','popular',true]
  ]) {
    const files = recursive ? listJsonRecursive(path.join(root, directory)) : listJson(path.join(root, directory));
    for (const file of files) {
      const payload = readJson(file); const rows = toRows(payload).length ? toRows(payload) : [payload].filter(Boolean);
      add(origin, rows.map(item => candidateFromLoose(item, `${origin}:${path.relative(root, file)}`)));
    }
  }
  add('published-pages', scanPublishedPages(root));
  return sources;
}

function enrichFromRaw(entity, candidate, now) {
  const raw = candidate.raw ?? {}; const src = candidate.source;
  const set = (name, value, confidence = 0.55) => {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return;
    if (!entity.fields[name] || !entity.fields[name].editorialLock) entity.fields[name] = fieldValue(value, src, {now, confidence});
  };
  set('developers', raw.companies?.developers ?? raw.developers); set('publishers', raw.companies?.publishers ?? raw.publishers);
  set('platforms', raw.classification?.platforms ?? raw.platforms); set('genres', raw.classification?.genres ?? raw.genres);
  set('subgenres', raw.classification?.subgenres ?? raw.subgenres); set('technicalModes', raw.classification?.modes ?? raw.modes);
  set('description', raw.editorial?.integrated_description ?? raw.description); set('shortDescription', raw.editorial?.short_description ?? raw.short_description);
  set('ageRatings', raw.age_ratings ?? raw.ageRatings); set('systemRequirements', raw.system_requirements ?? raw.systemRequirements); set('officialLinks', raw.official_links ?? raw.links);
  if (raw.media && !entity.media.length) for (const [kind, value] of Object.entries(raw.media)) for (const media of Array.isArray(value) ? value : [value]) {
    if (!media) continue;
    entity.media.push({
      id: `media_${crypto.createHash('sha1').update(`${entity.id}:${kind}:${JSON.stringify(media)}`).digest('hex').slice(0,12)}`,
      kind, url: typeof media === 'string' ? media : media.url ?? null,
      objectKey: typeof media === 'object' ? media.objectKey ?? media.object_key ?? null : null,
      checksum: typeof media === 'object' ? media.checksum ?? null : null, source: src, fetchedAt: now, revisions: []
    });
  }
  if (candidate.year && !entity.releases.length) entity.releases.push({
    id: `release_year_${candidate.year}`, platform: fieldValue(null, src, {now, confidence: 0.3}), region: fieldValue('global', src, {now, confidence: 0.3}),
    date: fieldValue(String(candidate.year), src, {now, confidence: 0.35}), precision: 'year', status: 'released'
  });
  if (candidate.pageStatus === 'published') { entity.workflow.pageStatus = 'published'; entity.workflow.status = 'published'; entity.workflow.statusReason = candidate.statusReason; }
  else if (candidate.pageStatus === 'page_draft' && entity.workflow.pageStatus !== 'published') entity.workflow.pageStatus = 'page_draft';
}

function candidateYear(candidate = {}) {
  return Number(candidate.releaseYear ?? candidate.year ?? String(candidate.releaseDate ?? candidate.release_date ?? candidate.releases?.[0]?.date ?? '').match(/(?:19|20)\d{2}/)?.[0] ?? 0);
}
function entityYear(entity = {}) { return Number(String(entity.releases?.[0]?.date?.value ?? '').match(/(?:19|20)\d{2}/)?.[0] ?? 0); }
function effectiveEntityKind(entity = {}) {
  const stored = entity.identity?.kind?.value ?? 'unknown';
  const inferred = migrationKind({ title: entity.identity?.canonicalTitle?.value ?? entity.identity?.slug?.value ?? '' });
  return inferred !== 'game' ? inferred : stored;
}
function compatibleIdentity(entity, candidate) {
  const existingYear = entityYear(entity); const incomingYear = candidateYear(candidate);
  if (existingYear && incomingYear && existingYear !== incomingYear) return false;
  const existingKind = effectiveEntityKind(entity); const incomingKind = migrationKind(candidate);
  return existingKind === 'unknown' || incomingKind === 'unknown' || existingKind === incomingKind;
}
function safeExactSlugTarget(api, candidate) {
  const slug = String(candidate.slug ?? '').trim(); if (!slug) return null;
  const entity = api.findBySlug(slug);
  return entity && entity.workflow?.status !== 'merged_into_another_game' && compatibleIdentity(entity, candidate) ? entity : null;
}
function externalIdentityTargets(api, candidate) {
  const external = normalizeExternalIds(candidate.externalIds ?? candidate.external_ids ?? candidate); const targets = [];
  for (const [kind, value] of [['steamAppId',external.steamAppId],['igdbId',external.igdbId],['rawgId',external.rawgId]]) {
    if (!value) continue; const entity = api.findByExternalId(kind, value); if (entity) targets.push(entity);
  }
  for (const [kind, values] of [['playstation',external.playstation],['xbox',external.xbox],['nintendo',external.nintendo]]) for (const value of values || []) {
    const entity = api.findByExternalId(kind, value); if (entity) targets.push(entity);
  }
  return [...new Map(targets.map(entity => [entity.id, entity])).values()];
}
function bridgeIdentityIfSafe(api, candidate, now) {
  const slugTarget = safeExactSlugTarget(api, candidate); if (!slugTarget) return null;
  const externalTargets = externalIdentityTargets(api, candidate).filter(entity => entity.id !== slugTarget.id);
  if (!externalTargets.length) return slugTarget;
  if (externalTargets.length > 1) throw new Error(`Candidate bridges canonical slug ${candidate.slug} to multiple external entities: ${externalTargets.map(entity => entity.id).join(', ')}`);
  const externalTarget = externalTargets[0];
  const slugYear = entityYear(slugTarget); const externalYear = entityYear(externalTarget);
  if (slugYear && externalYear && slugYear !== externalYear) throw new Error(`Canonical slug/external-ID year conflict for ${candidate.slug}: ${slugYear} vs ${externalYear}`);
  const slugKind = effectiveEntityKind(slugTarget); const externalKind = effectiveEntityKind(externalTarget);
  if (slugKind !== 'unknown' && externalKind !== 'unknown' && slugKind !== externalKind) throw new Error(`Canonical slug/external-ID kind conflict for ${candidate.slug}: ${slugKind} vs ${externalKind}`);
  const sourceWorkflow = structuredClone(externalTarget.workflow ?? {});
  const merged = api.mergeGames(externalTarget.id, slugTarget.id, {now, actor:'migration', reason:'canonical_slug_external_id_bridge'});
  if (sourceWorkflow.pageStatus === 'published') merged.workflow.pageStatus = 'published';
  if (sourceWorkflow.status === 'published') merged.workflow.status = 'published';
  return merged;
}
function assertUniqueActiveIdentity(registry) {
  const slugs = new Map(); const external = new Map();
  for (const entity of Object.values(registry.games ?? {})) {
    if (entity.workflow?.status === 'merged_into_another_game') continue;
    const slug = String(entity.identity?.slug?.value ?? '').trim(); if (slug) { const ids=slugs.get(slug)??[]; ids.push(entity.id); slugs.set(slug,ids); }
    for (const [kind, raw] of Object.entries(entity.externalIds ?? {})) for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (value === null || value === undefined || value === '') continue;
      const key=`${kind}:${value}`; const ids=external.get(key)??[]; ids.push(entity.id); external.set(key,ids);
    }
  }
  const slugCollisions=[...slugs.entries()].filter(([,ids])=>ids.length>1).map(([slug,ids])=>({slug,gameIds:ids.sort()}));
  const externalCollisions=[...external.entries()].filter(([,ids])=>ids.length>1).map(([externalId,ids])=>({externalId,gameIds:ids.sort()}));
  if (slugCollisions.length || externalCollisions.length) throw new Error(`Canonical Game Registry contains duplicate active identity: ${JSON.stringify({slugCollisions,externalCollisions})}`);
}

function attachArticles(root, registry) {
  let total = 0; const byStatus = {};
  for (const [directory, defaultType] of [
    ['data/articles','igropoisk_review'],['data/news-articles','news'],['data/reviews','professional_review'],
    ['content/articles/games','igropoisk_review'],['content/reviews/games','professional_review']
  ]) for (const file of listJsonRecursive(path.join(root, directory))) {
    const payload = readJson(file); const records = toRows(payload).length ? toRows(payload) : [payload].filter(Boolean);
    const payloadGameId = payload?.game_id ?? payload?.gameId ?? payload?.game?.game_id ?? null; const payloadSlug = payload?.game_slug ?? payload?.game?.slug ?? null;
    for (const record of records) {
      const gameId = record.game_id ?? record.gameId ?? record.game?.game_id ?? payloadGameId;
      const slug = record.game_slug ?? record.game?.slug ?? payloadSlug ?? record.slug ?? path.basename(file, '.json');
      const entity = gameId ? registry.games?.[gameId] ?? null : registry.indexes.slug[slug] ? registry.games[registry.indexes.slug[slug]] : null;
      if (!entity) continue;
      const type = ARTICLE_TYPES.includes(record.type) ? record.type : defaultType;
      const status = record.publication_status ?? record.status ?? (record.gate?.passed ? 'published' : 'draft');
      entity.articles.push({id: record.id ?? `article_${crypto.createHash('sha1').update(`${file}:${record.url ?? record.title ?? total}`).digest('hex').slice(0,12)}`, type, status, title: record.title ?? null, url: record.url ?? null, source: source(file, type === 'igropoisk_review' ? 'manual' : 'professional_publication')});
      if (type === 'igropoisk_review') entity.workflow.igropoiskReviewStatus = status === 'published' ? 'published' : 'draft';
      total += 1; byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
  }
  return {total, byStatus};
}

export function migrateRepository(root, options = {}) {
  const now = options.now ?? new Date().toISOString(); const registry = createRegistry({generatedAt: now});
  const api = new GameRegistryApi(registry, {publicBaseUrl: options.publicBaseUrl ?? '/game'}); const candidates = scanCandidates(root);
  const decisions = {created: 0, matched: 0, needs_review: 0}; const sourceCounts = {}; const duplicatePairs = [];
  for (const {origin, candidate} of candidates) {
    sourceCounts[origin] = (sourceCounts[origin] ?? 0) + 1; bridgeIdentityIfSafe(api, candidate, now);
    const slugTarget = safeExactSlugTarget(api, candidate); const resolvedCandidate = slugTarget ? { ...candidate, gameId: slugTarget.id } : candidate;
    const result = api.registerCandidate(resolvedCandidate, {now, actor: 'migration'}); decisions[result.decision] = (decisions[result.decision] ?? 0) + 1;
    if (result.entity) enrichFromRaw(result.entity, candidate, now);
    if (result.decision === 'matched') duplicatePairs.push({gameId: result.entity.id, slug: result.entity.identity.slug.value, reason: result.reasons});
  }
  assertUniqueActiveIdentity(registry); rebuildIndexes(registry); const articleStats = attachArticles(root, registry);
  for (const entity of Object.values(registry.games)) {
    const releaseYear = Number(String(entity.releases?.[0]?.date?.value ?? '').match(/\d{4}/)?.[0] ?? 0); const currentYear = new Date(now).getUTCFullYear(); const partialPage = entity.workflow.pageStatus === 'page_draft';
    calculatePriority(entity, {
      daysUntilRelease: releaseYear > currentYear ? Math.round((Date.UTC(releaseYear,0,1) - Date.parse(now))/86400000) : null,
      professionalReviewCount: entity.articles.filter(item => item.type === 'professional_review').length,
      partialPage, explicitRequest: ['the-witcher-3-wild-hunt','elden-ring'].includes(entity.identity.slug.value)
    }, {now});
    if (entity.workflow.status !== 'published') {
      const required = ['developers','publishers','platforms','genres','description']; const missing = required.filter(key => !entity.fields[key]?.value || (Array.isArray(entity.fields[key].value) && !entity.fields[key].value.length));
      if (!missing.length && entity.media.length && entity.releases.length) { entity.workflow.status = 'ready_for_page'; entity.workflow.statusReason = 'migration completeness gate passed'; }
      else if (entity.workflow.status !== 'needs_review') { entity.workflow.status = 'enriching'; entity.workflow.statusReason = `missing: ${missing.join(', ') || 'confirmed media or release'}`; }
    }
  }
  const games = Object.values(registry.games); const statusCounts = Object.fromEntries([...new Set(games.map(item => item.workflow.status))].sort().map(status => [status, games.filter(item => item.workflow.status === status).length]));
  const articleQueue = games
    .filter(item => ['ready_for_page','page_draft','published'].includes(item.workflow.status) || item.workflow.pageStatus === 'published')
    .filter(item => !item.articles.some(article => article.type === 'igropoisk_review' && article.status === 'published'))
    .sort((a,b) => b.priority.score - a.priority.score || a.identity.slug.value.localeCompare(b.identity.slug.value))
    .map(item => ({gameId: item.id, slug: item.identity.slug.value, type: 'igropoisk_review', status: item.workflow.igropoiskReviewStatus || 'researching', priority: item.priority.score, reason: 'canonical game lacks published Игропоиск review'}));
  const report = {
    schemaVersion: 'game-registry-migration-report/v1', generatedAt: now, dryRun: options.dryRun !== false,
    sourceRecords: candidates.length, canonicalGames: games.length, duplicateSourceRecords: decisions.matched, ambiguousCases: registry.reviewQueue.length,
    publishedPages: games.filter(item => item.workflow.pageStatus === 'published').length, readyForPage: games.filter(item => item.workflow.status === 'ready_for_page').length,
    awaitingSources: games.filter(item => ['discovered','identified','enriching','needs_review'].includes(item.workflow.status)).length,
    statuses: statusCounts, articles: articleStats, articleQueue, sources: sourceCounts,
    examples: { published: games.find(item => item.workflow.pageStatus === 'published')?.id ?? null, draft: games.find(item => item.workflow.pageStatus === 'page_draft' || item.workflow.status === 'ready_for_page')?.id ?? null, ambiguous: registry.reviewQueue[0]?.id ?? null },
    sourceFingerprint: crypto.createHash('sha256').update(JSON.stringify({sourceCounts, candidates: candidates.map(item => [item.origin,item.candidate.slug,item.candidate.steamAppId])})).digest('hex'),
    recoveryPoint: {baseCommit: options.baseCommit ?? null, originalsModified: false, sourceFilesDeleted: false}, duplicateExamples: duplicatePairs.slice(0, 20)
  };
  return {registry: rebuildIndexes(registry), report};
}

export function writeMigrationArtifacts(root, result, options = {}) {
  const registryOut = path.resolve(root, options.registryOut ?? 'data/game-registry/registry.transition.json'); const reportOut = path.resolve(root, options.reportOut ?? 'data/game-registry/migration-report.json');
  for (const file of [registryOut, reportOut]) fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(registryOut, `${JSON.stringify(result.registry, null, 2)}\n`); fs.writeFileSync(reportOut, `${JSON.stringify(result.report, null, 2)}\n`); return {registryOut, reportOut};
}