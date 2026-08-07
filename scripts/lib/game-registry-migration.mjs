import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ARTICLE_TYPES, GameRegistryApi, calculatePriority, createRegistry,
  fieldValue, inferKind, normalizeAlias, normalizeExternalIds, rebuildIndexes, slugify
} from './game-registry.mjs';
import {buildGamePageSections} from './game-registry-page-sections.mjs';

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
const EMBEDDED_KINDS = new Set(['edition','remaster','dlc','expansion']);

function migrationKind(candidate = {}) {
  const editorialEvidence = JSON.stringify({
    editorial: candidate.raw?.editorial ?? candidate.editorial ?? null,
    features: candidate.raw?.features ?? candidate.features ?? null,
    description: candidate.raw?.description ?? candidate.description ?? null
  }).toLocaleLowerCase('ru-RU');
  if (/\bremake\b|ремейк|полностью\s+переработ/iu.test(editorialEvidence)) return 'remake';
  const rawTitle = candidate.canonicalTitle ?? candidate.title ?? candidate.name ?? candidate.slug ?? '';
  const normalizedTitle = String(rawTitle).replace(/[-_]+/g, ' ');
  return inferKind({...candidate, kind: undefined, type: undefined, title: normalizedTitle});
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

function seeded(candidate) { return {...candidate, kind: migrationKind(candidate), id: canonicalSeedId(candidate)}; }

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
    ...game,
    slug,
    title: game.identity?.title ?? game.title ?? slug,
    steamAppId: game.identity?.steam_appid ?? game.external_ids?.steam ?? null,
    source: source(`game-content:${path.basename(file)}`, 'manual'),
    discoveryReason: 'migrated_curated_game_content',
    pageStatus: game.publication?.status === 'published' ? 'published' : 'page_draft',
    status: game.publication?.status === 'published' ? 'published' : 'enriching',
    statusReason: 'curated game-content record',
    raw: game
  }));
}

function candidateFromCatalog(item) {
  return seeded({
    title: item.title ?? item.name,
    slug: item.slug ?? slugify(item.title ?? item.name),
    year: item.year ?? null,
    steamAppId: item.steam_appid ?? null,
    source: source('data/catalog-visible.json', 'manual'),
    discoveryReason: 'migrated_visible_catalog',
    status: 'identified',
    statusReason: 'present in visible catalog',
    raw: item
  });
}

function candidateFromPipeline(item) {
  return seeded({
    title: item.game_title ?? item.slug ?? item.title ?? item.name,
    slug: item.slug,
    year: item.year ?? null,
    steamAppId: item.steam_appid ?? null,
    source: source('data/content-pipeline/registry.json', 'automated_inference'),
    discoveryReason: `migrated_content_pipeline:${item.origin ?? 'unknown'}`,
    status: item.state === 'published' || item.state === 'review_published' ? 'published' : item.state === 'collecting' ? 'enriching' : 'discovered',
    statusReason: `legacy pipeline state: ${item.state ?? 'unknown'}`,
    pageStatus: item.page?.gate_passed ? 'published' : item.page?.curated ? 'page_draft' : 'not_started',
    raw: item
  });
}

function candidateFromLoose(item, origin, confidence = 0.45) {
  const title = item.title ?? item.name ?? item.identity?.title ?? item.slug;
  if (!title) return null;
  return seeded({
    title,
    slug: item.slug ?? slugify(title),
    aliases: item.aliases ?? item.alternative_titles ?? [],
    externalIds: normalizeExternalIds(item.externalIds ?? item.external_ids ?? item.identity ?? item),
    releases: item.events ?? item.releases ?? (item.release_date ? [{date: item.release_date, platform: item.platform ?? null}] : []),
    source: source(origin, origin.includes('release') ? 'platform_store' : 'automated_inference'),
    discoveryReason: `migrated_${origin.replace(/[^a-z0-9]+/gi, '_')}`,
    confidence,
    status: 'discovered',
    statusReason: `discovered in ${origin}`,
    raw: item
  });
}

function scanPublishedPages(root) {
  const gameRoot = path.join(root, 'game');
  if (!fs.existsSync(gameRoot)) return [];
  return fs.readdirSync(gameRoot, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && entry.name !== '_shared')
    .filter(entry => fs.existsSync(path.join(gameRoot, entry.name, 'index.html')))
    .map(entry => seeded({
      title: entry.name,
      slug: entry.name,
      source: source(`game/${entry.name}/index.html`, 'manual'),
      discoveryReason: 'migrated_published_page',
      status: 'published',
      statusReason: 'existing published page',
      pageStatus: 'published',
      confidence: 0.75
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
    ['data/drafts','drafts',false],
    ['data/parser-output','parser-output',false],
    ['data/releases','release-calendar',true],
    ['data/popular','popular',true]
  ]) {
    const files = recursive ? listJsonRecursive(path.join(root, directory)) : listJson(path.join(root, directory));
    for (const file of files) {
      const payload = readJson(file);
      const rows = toRows(payload).length ? toRows(payload) : [payload].filter(Boolean);
      add(origin, rows.map(item => candidateFromLoose(item, `${origin}:${path.relative(root, file)}`)));
    }
  }
  add('published-pages', scanPublishedPages(root));
  return sources;
}

function enrichFromRaw(entity, candidate, now) {
  const raw = candidate.raw ?? {};
  const src = candidate.source;
  const set = (name, value, confidence = 0.55) => {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return;
    if (!entity.fields[name] || !entity.fields[name].editorialLock) entity.fields[name] = fieldValue(value, src, {now, confidence});
  };
  set('developers', raw.companies?.developers ?? raw.developers);
  set('publishers', raw.companies?.publishers ?? raw.publishers);
  set('platforms', raw.classification?.platforms ?? raw.platforms);
  set('genres', raw.classification?.genres ?? raw.genres);
  set('subgenres', raw.classification?.subgenres ?? raw.subgenres);
  set('technicalModes', raw.classification?.modes ?? raw.modes);
  set('description', raw.editorial?.integrated_description ?? raw.description);
  set('shortDescription', raw.editorial?.short_description ?? raw.short_description);
  set('ageRatings', raw.age_ratings ?? raw.ageRatings);
  set('systemRequirements', raw.system_requirements ?? raw.systemRequirements);
  set('officialLinks', raw.official_links ?? raw.links);
  if (raw.media && !entity.media.length) {
    for (const [kind, value] of Object.entries(raw.media)) {
      for (const media of Array.isArray(value) ? value : [value]) {
        if (!media) continue;
        entity.media.push({
          id: `media_${crypto.createHash('sha1').update(`${entity.id}:${kind}:${JSON.stringify(media)}`).digest('hex').slice(0,12)}`,
          kind,
          url: typeof media === 'string' ? media : media.url ?? null,
          objectKey: typeof media === 'object' ? media.objectKey ?? media.object_key ?? null : null,
          checksum: typeof media === 'object' ? media.checksum ?? null : null,
          source: src,
          fetchedAt: now,
          revisions: []
        });
      }
    }
  }
  if (candidate.year && !entity.releases.length) entity.releases.push({
    id: `release_year_${candidate.year}`,
    platform: fieldValue(null, src, {now, confidence: 0.3}),
    region: fieldValue('global', src, {now, confidence: 0.3}),
    date: fieldValue(String(candidate.year), src, {now, confidence: 0.35}),
    precision: 'year',
    status: 'released'
  });
  if (candidate.pageStatus === 'published') {
    entity.workflow.pageStatus = 'published';
    entity.workflow.status = 'published';
    entity.workflow.statusReason = candidate.statusReason;
  } else if (candidate.pageStatus === 'page_draft' && entity.workflow.pageStatus !== 'published') {
    entity.workflow.pageStatus = 'page_draft';
  }
}

function candidateYear(candidate = {}) {
  return Number(candidate.releaseYear ?? candidate.year ?? String(
    candidate.releaseDate ?? candidate.release_date ?? candidate.raw?.release?.date_text ?? candidate.raw?.release?.date ?? candidate.releases?.[0]?.date ?? ''
  ).match(/(?:19|20)\d{2}/)?.[0] ?? 0);
}
function entityYear(entity = {}) {
  return Number(String(entity.releases?.[0]?.date?.value ?? '').match(/(?:19|20)\d{2}/)?.[0] ?? 0);
}
function effectiveEntityKind(entity = {}) {
  const stored = entity.identity?.kind?.value ?? 'unknown';
  if (stored && stored !== 'unknown') return stored;
  return migrationKind({title: entity.identity?.canonicalTitle?.value ?? entity.identity?.slug?.value ?? ''});
}
function compatibleIdentity(entity, candidate) {
  const existingYear = entityYear(entity);
  const incomingYear = candidateYear(candidate);
  if (existingYear && incomingYear && existingYear !== incomingYear) return false;
  const existingKind = effectiveEntityKind(entity);
  const incomingKind = migrationKind(candidate);
  return existingKind === 'unknown' || incomingKind === 'unknown' || existingKind === incomingKind;
}
function exactSlugTarget(api, candidate) {
  const slug = String(candidate.slug ?? '').trim();
  if (!slug) return null;
  const entity = api.findBySlug(slug);
  return entity && entity.workflow?.status !== 'merged_into_another_game' ? entity : null;
}
function safeExactSlugTarget(api, candidate) {
  const entity = exactSlugTarget(api, candidate);
  return entity && compatibleIdentity(entity, candidate) ? entity : null;
}
function externalIdentityTargets(api, candidate) {
  const external = normalizeExternalIds(candidate.externalIds ?? candidate.external_ids ?? candidate);
  const targets = [];
  for (const [kind, value] of [['steamAppId',external.steamAppId],['igdbId',external.igdbId],['rawgId',external.rawgId]]) {
    if (!value) continue;
    const entity = api.findByExternalId(kind, value);
    if (entity) targets.push(entity);
  }
  for (const [kind, values] of [['playstation',external.playstation],['xbox',external.xbox],['nintendo',external.nintendo]]) {
    for (const value of values || []) {
      const entity = api.findByExternalId(kind, value);
      if (entity) targets.push(entity);
    }
  }
  return [...new Map(targets.map(entity => [entity.id, entity])).values()];
}

function variantRelease(candidate = {}) {
  const raw = candidate.raw ?? {};
  const date = candidate.releaseDate ?? candidate.release_date ?? raw.release?.date ?? raw.release?.date_text ?? candidate.releases?.[0]?.date ?? candidate.year ?? null;
  return date === null || date === undefined || date === '' ? null : String(date);
}
function scalarValue(value) {
  return value && typeof value === 'object' && Object.hasOwn(value, 'value') ? value.value : value;
}
function variantReleases(candidate = {}) {
  const raw = candidate.raw ?? {};
  const sourceRows = candidate.releases ?? candidate.events ?? raw.releases ?? raw.events ?? raw.release ?? candidate.release ?? [];
  const rows = (Array.isArray(sourceRows) ? sourceRows : [sourceRows]).filter(Boolean);
  if (!rows.length) {
    const release = variantRelease(candidate);
    return release ? [{date: release, platform: null, region: 'global', precision: /^\d{4}$/.test(release) ? 'year' : 'unknown', status: 'released'}] : [];
  }
  return rows.map((release, index) => {
    const item = typeof release === 'string' ? {date: release} : release;
    const date = scalarValue(item.date ?? item.date_start ?? item.release_date ?? item.date_text ?? null);
    const platform = scalarValue(item.platform ?? null);
    const region = scalarValue(item.region ?? 'global');
    const precision = item.precision ?? (date && /^\d{4}$/.test(String(date)) ? 'year' : date ? 'day' : 'unknown');
    return {
      id: item.id ?? `variant_release_${index}_${crypto.createHash('sha1').update(JSON.stringify(item)).digest('hex').slice(0, 8)}`,
      date: date === null || date === undefined || date === '' ? null : String(date),
      platform: platform === null || platform === undefined || platform === '' ? null : String(platform),
      region: region === null || region === undefined || region === '' ? null : String(region),
      precision,
      status: item.status ?? 'released'
    };
  }).filter(item => item.date || item.platform);
}
function variantPlatforms(candidate = {}, releases = []) {
  const raw = candidate.raw ?? {};
  const explicit = raw.classification?.platforms ?? raw.platforms ?? candidate.platforms ?? candidate.platform ?? [];
  const values = [...(Array.isArray(explicit) ? explicit : [explicit]), ...releases.map(release => release.platform)];
  return [...new Set(values.filter(Boolean).map(String))].sort();
}
function variantId(baseId, candidate = {}) {
  const basis = `${baseId}:${migrationKind(candidate)}:${candidate.slug ?? normalizeAlias(candidate.title ?? candidate.name ?? '')}`;
  return `variant_${crypto.createHash('sha256').update(basis).digest('hex').slice(0, 18)}`;
}
function findVariantOwner(registry, slug) {
  if (!slug) return null;
  for (const game of Object.values(registry.games ?? {})) {
    if (game.workflow?.status === 'merged_into_another_game') continue;
    const variant = (game.variants ?? []).find(item => item.slug === slug);
    if (variant) return {game, variant};
  }
  return null;
}
function embeddedBaseAliasCandidates(candidate = {}) {
  const title = String(candidate.title ?? candidate.name ?? candidate.raw?.identity?.title ?? '').trim();
  if (!title) return [];
  const values = new Set();
  const stripped = title
    .replace(/\s*[:\-–—]?\s*(?:definitive\s+edition|remaster(?:ed)?|hd\s+collection|anniversary\s+edition|deluxe\s+edition|ultimate\s+edition|gold\s+edition|complete\s+edition|collector'?s\s+edition|digital\s+deluxe\s+edition|goty|game\s+of\s+the\s+year\s+edition)\s*$/iu, '')
    .trim();
  if (stripped && normalizeAlias(stripped) !== normalizeAlias(title)) values.add(stripped);
  if (['dlc','expansion'].includes(migrationKind(candidate)) && title.includes(':')) {
    const prefix = title.split(':')[0].trim();
    if (prefix) values.add(prefix);
  }
  return [...values];
}
function attachEmbeddedVariant(base, candidate, now) {
  base.variants ??= [];
  const raw = candidate.raw ?? {};
  const slug = String(candidate.slug ?? slugify(candidate.title ?? candidate.name ?? '')).trim();
  const title = String(candidate.title ?? candidate.name ?? raw.identity?.title ?? slug).trim();
  const id = variantId(base.id, {...candidate, slug, title});
  const existing = base.variants.find(item => item.id === id || (slug && item.slug === slug));
  const externalIds = normalizeExternalIds(candidate.externalIds ?? candidate.external_ids ?? candidate);
  const releases = variantReleases(candidate);
  const platforms = variantPlatforms(candidate, releases);
  const src = candidate.source ?? source('unknown');
  const next = existing ?? {
    schemaVersion: 'game-variant/v1',
    id,
    baseGameId: base.id,
    kind: migrationKind(candidate),
    title,
    slug,
    release: releases[0]?.date ?? variantRelease(candidate),
    releases,
    platforms,
    description: raw.editorial?.short_description ?? raw.editorial?.integrated_description ?? candidate.description ?? '',
    externalIds,
    sources: [],
    articles: [],
    pagePolicy: 'embedded'
  };
  next.schemaVersion = 'game-variant/v1';
  next.baseGameId = base.id;
  next.kind = migrationKind(candidate);
  next.title = title || next.title;
  next.slug = slug || next.slug;
  next.releases = [...new Map([...(next.releases ?? []), ...releases].map(item => [`${item.date ?? ''}:${item.platform ?? ''}:${item.region ?? ''}:${item.status ?? ''}`, item])).values()];
  next.platforms = [...new Set([...(next.platforms ?? []), ...platforms])].sort();
  next.release = next.releases[0]?.date ?? variantRelease(candidate) ?? next.release;
  next.description = raw.editorial?.short_description ?? raw.editorial?.integrated_description ?? candidate.description ?? next.description ?? '';
  next.externalIds = {
    ...next.externalIds,
    ...Object.fromEntries(Object.entries(externalIds).filter(([,value]) => Array.isArray(value) ? value.length : value))
  };
  next.sources ??= [];
  if (!next.sources.some(item => item?.name === src?.name && item?.url === src?.url)) next.sources.push(src);
  if (!existing) base.variants.push(next);
  base.relations ??= {series: [], baseGameId: null, relatedGameIds: []};
  base.relations.embeddedContentIds = [...new Set([...(base.relations.embeddedContentIds ?? []), next.id])];
  base.auditLog?.push({at: now, action: 'embedded_content_upserted', actor: 'migration', variantId: next.id, kind: next.kind});
  return next;
}
function explicitBaseTarget(api, candidate) {
  const raw = candidate.raw ?? {};
  const id = candidate.baseGameId ?? candidate.base_game_id ?? candidate.relations?.baseGameId ?? raw.relations?.baseGameId ?? raw.base_game_id ?? null;
  if (id) {
    const entity = api.findById(String(id));
    if (entity && entity.workflow?.status !== 'merged_into_another_game') return entity;
  }
  const slug = candidate.baseGameSlug ?? candidate.base_game_slug ?? candidate.relations?.baseGameSlug ?? raw.relations?.baseGameSlug ?? raw.base_game_slug ?? null;
  if (slug) {
    const entity = api.findBySlug(String(slug));
    if (entity && entity.workflow?.status !== 'merged_into_another_game') return entity;
  }
  return null;
}
function embeddedBaseTarget(api, registry, candidate) {
  const known = findVariantOwner(registry, candidate.slug);
  if (known) return known.game;
  const explicit = explicitBaseTarget(api, candidate);
  if (explicit) return explicit;
  const external = externalIdentityTargets(api, candidate).filter(entity => !EMBEDDED_KINDS.has(effectiveEntityKind(entity)));
  if (external.length === 1) return external[0];
  if (external.length > 1) throw new Error(`Embedded content ${candidate.slug ?? candidate.title} matches multiple base games: ${external.map(item => item.id).join(', ')}`);
  const aliasTargets = uniqueEntities(embeddedBaseAliasCandidates(candidate).flatMap(alias => api.findByExactAlias(alias)))
    .filter(entity => !EMBEDDED_KINDS.has(effectiveEntityKind(entity)));
  if (aliasTargets.length === 1) return aliasTargets[0];
  if (aliasTargets.length > 1) throw new Error(`Embedded content ${candidate.slug ?? candidate.title} matches multiple base games by title: ${aliasTargets.map(item => item.id).join(', ')}`);
  return null;
}
function uniqueEntities(entities = []) {
  return [...new Map(entities.filter(Boolean).map(entity => [entity.id, entity])).values()];
}
function queueEmbeddedReview(registry, candidate, now) {
  const key = `${candidate.slug ?? candidate.title ?? 'embedded'}:${migrationKind(candidate)}`;
  if (registry.reviewQueue.some(item => item.identityKey === key && item.status === 'open')) return;
  registry.reviewQueue.push({
    id: `review_${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`,
    identityKey: key,
    candidate,
    possibleGameIds: [],
    reasons: ['embedded_content_requires_base_game'],
    status: 'open',
    createdAt: now
  });
}
function handleEmbeddedCandidate(api, registry, candidate, now) {
  const kind = migrationKind(candidate);
  if (!EMBEDDED_KINDS.has(kind)) return {handled: false, candidate};

  const slugTarget = exactSlugTarget(api, candidate);
  const slugTargetKind = effectiveEntityKind(slugTarget);
  const sameYear = !slugTarget || !entityYear(slugTarget) || !candidateYear(candidate) || entityYear(slugTarget) === candidateYear(candidate);
  if (slugTarget && !EMBEDDED_KINDS.has(slugTargetKind) && (compatibleIdentity(slugTarget, candidate) || (slugTargetKind === 'remake' && sameYear))) {
    return {handled: false, candidate: {...candidate, gameId: slugTarget.id, kind: slugTargetKind}};
  }

  const base = embeddedBaseTarget(api, registry, candidate);
  if (!base) {
    queueEmbeddedReview(registry, candidate, now);
    return {handled: true, decision: 'needs_review', review: registry.reviewQueue.at(-1)};
  }
  const variant = attachEmbeddedVariant(base, candidate, now);
  return {handled: true, decision: 'matched', entity: base, variant, reasons: ['embedded_content']};
}

function bridgePrimaryIdentityIfSafe(api, candidate, now) {
  const slugTarget = safeExactSlugTarget(api, candidate);
  if (!slugTarget) return null;
  const externalTargets = externalIdentityTargets(api, candidate).filter(entity => entity.id !== slugTarget.id);
  if (!externalTargets.length) return slugTarget;
  if (externalTargets.length > 1) throw new Error(`Candidate bridges canonical slug ${candidate.slug} to multiple external entities: ${externalTargets.map(entity => entity.id).join(', ')}`);
  const externalTarget = externalTargets[0];
  const slugYear = entityYear(slugTarget);
  const externalYear = entityYear(externalTarget);
  if (slugYear && externalYear && slugYear !== externalYear) throw new Error(`Canonical slug/external-ID year conflict for ${candidate.slug}: ${slugYear} vs ${externalYear}`);
  const slugKind = effectiveEntityKind(slugTarget);
  const externalKind = effectiveEntityKind(externalTarget);
  if (slugKind !== 'unknown' && externalKind !== 'unknown' && slugKind !== externalKind) throw new Error(`Canonical slug/external-ID kind conflict for ${candidate.slug}: ${slugKind} vs ${externalKind}`);
  const sourceWorkflow = structuredClone(externalTarget.workflow ?? {});
  const merged = api.mergeGames(externalTarget.id, slugTarget.id, {now, actor:'migration', reason:'canonical_slug_external_id_bridge'});
  if (sourceWorkflow.pageStatus === 'published') merged.workflow.pageStatus = 'published';
  if (sourceWorkflow.status === 'published') merged.workflow.status = 'published';
  return merged;
}

function assertUniqueActiveIdentity(registry) {
  const slugs = new Map();
  const external = new Map();
  const standaloneEmbedded = [];
  for (const entity of Object.values(registry.games ?? {})) {
    if (entity.workflow?.status === 'merged_into_another_game') continue;
    const kind = effectiveEntityKind(entity);
    if (EMBEDDED_KINDS.has(kind)) standaloneEmbedded.push({gameId: entity.id, slug: entity.identity?.slug?.value ?? null, kind});
    const slug = String(entity.identity?.slug?.value ?? '').trim();
    if (slug) {
      const ids = slugs.get(slug) ?? [];
      ids.push(entity.id);
      slugs.set(slug, ids);
    }
    for (const [kind, raw] of Object.entries(entity.externalIds ?? {})) {
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (value === null || value === undefined || value === '') continue;
        const key = `${kind}:${value}`;
        const ids = external.get(key) ?? [];
        ids.push(entity.id);
        external.set(key, ids);
      }
    }
  }
  const slugCollisions = [...slugs.entries()].filter(([,ids]) => ids.length > 1).map(([slug,ids]) => ({slug,gameIds:ids.sort()}));
  const externalCollisions = [...external.entries()].filter(([,ids]) => ids.length > 1).map(([externalId,ids]) => ({externalId,gameIds:ids.sort()}));
  if (slugCollisions.length || externalCollisions.length || standaloneEmbedded.length) {
    throw new Error(`Canonical Game Registry identity invariant failed: ${JSON.stringify({slugCollisions,externalCollisions,standaloneEmbedded})}`);
  }
}

function articleTarget(registry, record, payload, file) {
  const gameId = record.game_id ?? record.gameId ?? record.game?.game_id ?? payload?.game_id ?? payload?.gameId ?? payload?.game?.game_id ?? null;
  const slug = record.game_slug ?? record.game?.slug ?? payload?.game_slug ?? payload?.game?.slug ?? record.slug ?? path.basename(file, '.json');
  let game = gameId ? registry.games?.[gameId] ?? null : null;
  let variant = null;
  if (game?.workflow?.status === 'merged_into_another_game' && game.mergedIntoGameId) game = registry.games?.[game.mergedIntoGameId] ?? null;
  if (!game) {
    const directId = registry.indexes.slug?.[slug];
    game = directId ? registry.games?.[directId] ?? null : null;
  }
  const variantId = record.variant_id ?? record.variantId ?? record.child_id ?? record.childId ?? payload?.variant_id ?? payload?.variantId ?? payload?.child_id ?? payload?.childId ?? null;
  if (game && variantId) variant = (game.variants ?? []).find(item => item.id === variantId) ?? null;
  if (!variant && slug) {
    const owner = findVariantOwner(registry, slug);
    if (owner) {
      game = owner.game;
      variant = owner.variant;
    }
  }
  return {game, variant, slug};
}

function attachArticles(root, registry) {
  let total = 0;
  const byStatus = {};
  for (const [directory, defaultType] of [
    ['data/articles','igropoisk_review'],
    ['data/news-articles','news'],
    ['data/reviews','professional_review'],
    ['content/articles/games','igropoisk_review'],
    ['content/reviews/games','professional_review']
  ]) {
    for (const file of listJsonRecursive(path.join(root, directory))) {
      const payload = readJson(file);
      const records = toRows(payload).length ? toRows(payload) : [payload].filter(Boolean);
      for (const record of records) {
        const {game, variant} = articleTarget(registry, record, payload, file);
        if (!game) continue;
        const type = ARTICLE_TYPES.includes(record.type) ? record.type : defaultType;
        const status = record.publication_status ?? record.status ?? (record.gate?.passed ? 'published' : 'draft');
        const article = {
          id: record.id ?? `article_${crypto.createHash('sha1').update(`${file}:${record.url ?? record.title ?? total}`).digest('hex').slice(0,12)}`,
          type,
          status,
          title: record.title ?? null,
          url: record.url ?? null,
          source: source(file, type === 'igropoisk_review' ? 'manual' : 'professional_publication'),
          variantId: variant?.id ?? null
        };
        if (variant) {
          variant.articles ??= [];
          if (!variant.articles.some(item => item.id === article.id)) variant.articles.push(article);
        } else {
          game.articles.push(article);
          if (type === 'igropoisk_review') game.workflow.igropoiskReviewStatus = status === 'published' ? 'published' : 'draft';
        }
        total += 1;
        byStatus[status] = (byStatus[status] ?? 0) + 1;
      }
    }
  }
  return {total, byStatus};
}

export function migrateRepository(root, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const registry = createRegistry({generatedAt: now});
  const api = new GameRegistryApi(registry, {publicBaseUrl: options.publicBaseUrl ?? '/game'});
  const candidates = scanCandidates(root)
    .map((item, index) => ({...item, index, embedded: EMBEDDED_KINDS.has(migrationKind(item.candidate))}))
    .sort((a,b) => Number(a.embedded) - Number(b.embedded) || a.index - b.index);
  const decisions = {created: 0, matched: 0, needs_review: 0};
  const sourceCounts = {};
  const duplicatePairs = [];

  for (const {origin, candidate} of candidates) {
    sourceCounts[origin] = (sourceCounts[origin] ?? 0) + 1;
    const embedded = handleEmbeddedCandidate(api, registry, candidate, now);
    if (embedded.handled) {
      decisions[embedded.decision] = (decisions[embedded.decision] ?? 0) + 1;
      if (embedded.entity && !embedded.variant) enrichFromRaw(embedded.entity, candidate, now);
      if (embedded.decision === 'matched') duplicatePairs.push({gameId: embedded.entity.id, slug: embedded.entity.identity.slug.value, reason: embedded.reasons});
      continue;
    }
    const effectiveCandidate = embedded.candidate ?? candidate;
    const bridgeTarget = bridgePrimaryIdentityIfSafe(api, effectiveCandidate, now);
    const slugTarget = bridgeTarget ?? safeExactSlugTarget(api, effectiveCandidate);
    const resolvedCandidate = slugTarget ? {...effectiveCandidate, gameId: slugTarget.id} : effectiveCandidate;
    const result = api.registerCandidate(resolvedCandidate, {now, actor: 'migration'});
    decisions[result.decision] = (decisions[result.decision] ?? 0) + 1;
    if (result.entity) enrichFromRaw(result.entity, effectiveCandidate, now);
    if (result.decision === 'matched') duplicatePairs.push({gameId: result.entity.id, slug: result.entity.identity.slug.value, reason: result.reasons});
  }

  assertUniqueActiveIdentity(registry);
  rebuildIndexes(registry);
  const articleStats = attachArticles(root, registry);
  const activeGames = Object.values(registry.games).filter(item => item.workflow.status !== 'merged_into_another_game');

  for (const entity of activeGames) {
    const releaseYear = Number(String(entity.releases?.[0]?.date?.value ?? '').match(/\d{4}/)?.[0] ?? 0);
    const currentYear = new Date(now).getUTCFullYear();
    const partialPage = entity.workflow.pageStatus === 'page_draft';
    calculatePriority(entity, {
      daysUntilRelease: releaseYear > currentYear ? Math.round((Date.UTC(releaseYear,0,1) - Date.parse(now))/86400000) : null,
      professionalReviewCount: entity.articles.filter(item => item.type === 'professional_review').length,
      partialPage,
      explicitRequest: ['the-witcher-3-wild-hunt','elden-ring'].includes(entity.identity.slug.value)
    }, {now});
    if (entity.workflow.status !== 'published') {
      const required = ['developers','publishers','platforms','genres','description'];
      const missing = required.filter(key => !entity.fields[key]?.value || (Array.isArray(entity.fields[key].value) && !entity.fields[key].value.length));
      if (!missing.length && entity.media.length && entity.releases.length) {
        entity.workflow.status = 'ready_for_page';
        entity.workflow.statusReason = 'migration completeness gate passed';
      } else if (entity.workflow.status !== 'needs_review') {
        entity.workflow.status = 'enriching';
        entity.workflow.statusReason = `missing: ${missing.join(', ') || 'confirmed media or release'}`;
      }
    }
  }

  const statusCounts = Object.fromEntries([...new Set(activeGames.map(item => item.workflow.status))].sort().map(status => [status, activeGames.filter(item => item.workflow.status === status).length]));
  const articleQueue = activeGames
    .filter(item => ['ready_for_page','page_draft','published'].includes(item.workflow.status) || item.workflow.pageStatus === 'published')
    .filter(item => !item.articles.some(article => article.type === 'igropoisk_review' && article.status === 'published'))
    .sort((a,b) => b.priority.score - a.priority.score || a.identity.slug.value.localeCompare(b.identity.slug.value))
    .map(item => ({gameId: item.id, slug: item.identity.slug.value, type: 'igropoisk_review', status: item.workflow.igropoiskReviewStatus || 'researching', priority: item.priority.score, reason: 'canonical game lacks published Игропоиск review'}));

  const report = {
    schemaVersion: 'game-registry-migration-report/v1',
    generatedAt: now,
    dryRun: options.dryRun !== false,
    sourceRecords: candidates.length,
    canonicalGames: activeGames.length,
    embeddedContent: activeGames.reduce((sum, game) => sum + (game.variants?.length ?? 0), 0),
    duplicateSourceRecords: decisions.matched,
    ambiguousCases: registry.reviewQueue.length,
    publishedPages: activeGames.filter(item => item.workflow.pageStatus === 'published').length,
    readyForPage: activeGames.filter(item => item.workflow.status === 'ready_for_page').length,
    awaitingSources: activeGames.filter(item => ['discovered','identified','enriching','needs_review'].includes(item.workflow.status)).length,
    statuses: statusCounts,
    articles: articleStats,
    articleQueue,
    sources: sourceCounts,
    examples: {
      published: activeGames.find(item => item.workflow.pageStatus === 'published')?.id ?? null,
      draft: activeGames.find(item => item.workflow.pageStatus === 'page_draft' || item.workflow.status === 'ready_for_page')?.id ?? null,
      ambiguous: registry.reviewQueue[0]?.id ?? null
    },
    sourceFingerprint: crypto.createHash('sha256').update(JSON.stringify({sourceCounts, candidates: candidates.map(item => [item.origin,item.candidate.slug,item.candidate.steamAppId])})).digest('hex'),
    recoveryPoint: {baseCommit: options.baseCommit ?? null, originalsModified: false, sourceFilesDeleted: false},
    duplicateExamples: duplicatePairs.slice(0, 20)
  };
  return {registry: rebuildIndexes(registry), report};
}

export function writeMigrationArtifacts(root, result, options = {}) {
  const registryOut = path.resolve(root, options.registryOut ?? 'data/game-registry/registry.transition.json');
  const reportOut = path.resolve(root, options.reportOut ?? 'data/game-registry/migration-report.json');
  const pageSectionsOut = path.resolve(root, options.pageSectionsOut ?? 'data/game-registry/page-sections.json');
  for (const file of [registryOut, reportOut, pageSectionsOut]) fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(registryOut, `${JSON.stringify(result.registry, null, 2)}\n`);
  fs.writeFileSync(reportOut, `${JSON.stringify(result.report, null, 2)}\n`);
  fs.writeFileSync(pageSectionsOut, `${JSON.stringify(buildGamePageSections(result.registry, {root}), null, 2)}\n`);
  return {registryOut, reportOut, pageSectionsOut};
}