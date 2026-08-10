import { GameRegistryApi, inferKind, isEmbeddedGameKind, normalizeExternalIds, normalizeAlias } from './game-registry.mjs';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function activeEntity(registry, gameId) {
  if (!gameId) return null;
  const entity = registry?.games?.[String(gameId)] ?? null;
  if (!entity || entity.workflow?.status === 'merged_into_another_game') return null;
  return entity;
}

function canonicalSlug(entity) {
  return String(entity?.identity?.slug?.value ?? '').trim();
}

export function findVariantOwner(registry, selector = {}) {
  const variantId = String(selector.variant_id ?? selector.variantId ?? selector.child_id ?? selector.childId ?? '').trim();
  const slug = String(selector.slug ?? selector.game_slug ?? '').trim();
  for (const entity of Object.values(registry?.games ?? {})) {
    if (entity.workflow?.status === 'merged_into_another_game') continue;
    const variant = (entity.variants ?? []).find(item =>
      (variantId && item.id === variantId) ||
      (slug && item.slug === slug)
    );
    if (variant) return {entity, variant};
  }
  return null;
}

function externalTargets(record, registry) {
  const external = normalizeExternalIds(record.externalIds ?? record.external_ids ?? record.identity ?? record);
  const ids = new Set();
  for (const [kind, raw] of Object.entries(external)) {
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (value === null || value === undefined || value === '') continue;
      const id = registry?.indexes?.external?.[`${kind}:${value}`];
      if (id) ids.add(id);
    }
  }
  return [...ids].map(id => activeEntity(registry, id)).filter(Boolean);
}

function aliasTargets(record, registry) {
  const title = record.title ?? record.name ?? record.game_title ?? null;
  if (!title) return [];
  const ids = registry?.indexes?.alias?.[normalizeAlias(title)] ?? [];
  return ids.map(id => activeEntity(registry, id)).filter(Boolean);
}

export function resolveSystemGameIdentity(record = {}, registry = {}) {
  const explicitId = String(record.game_id ?? record.gameId ?? '').trim();
  const slug = String(record.slug ?? record.game_slug ?? record.game?.slug ?? '').trim();
  const variantOwner = findVariantOwner(registry, record);
  const slugEntity = slug ? activeEntity(registry, registry?.indexes?.slug?.[slug]) : null;
  const explicitEntity = activeEntity(registry, explicitId);

  if (variantOwner) {
    const mismatch = explicitEntity && explicitEntity.id !== variantOwner.entity.id;
    return {
      status: mismatch ? 'mismatch' : 'embedded_variant',
      entity: variantOwner.entity,
      variant: variantOwner.variant,
      game_id: variantOwner.entity.id,
      canonical_slug: canonicalSlug(variantOwner.entity),
      variant_id: variantOwner.variant.id,
      reason: mismatch ? 'variant_base_game_id_mismatch' : 'embedded_variant'
    };
  }

  if (explicitId && !explicitEntity) {
    if (slugEntity) return {status: 'mismatch', entity: slugEntity, variant: null, game_id: slugEntity.id, canonical_slug: canonicalSlug(slugEntity), variant_id: null, reason: 'unknown_explicit_game_id'};
    return {status: 'unresolved', entity: null, variant: null, game_id: null, canonical_slug: null, variant_id: null, reason: 'unknown_explicit_game_id'};
  }

  if (explicitEntity && slugEntity && explicitEntity.id !== slugEntity.id) {
    return {status: 'mismatch', entity: slugEntity, variant: null, game_id: slugEntity.id, canonical_slug: canonicalSlug(slugEntity), variant_id: null, reason: 'game_id_slug_mismatch'};
  }

  if (explicitEntity) {
    return {status: 'matched', entity: explicitEntity, variant: null, game_id: explicitEntity.id, canonical_slug: canonicalSlug(explicitEntity), variant_id: null, reason: 'canonical_game_id'};
  }
  if (slugEntity) {
    return {status: 'matched', entity: slugEntity, variant: null, game_id: slugEntity.id, canonical_slug: canonicalSlug(slugEntity), variant_id: null, reason: 'canonical_slug'};
  }

  const byExternal = externalTargets(record, registry);
  if (byExternal.length === 1) {
    return {status: 'matched', entity: byExternal[0], variant: null, game_id: byExternal[0].id, canonical_slug: canonicalSlug(byExternal[0]), variant_id: null, reason: 'canonical_external_id'};
  }
  if (byExternal.length > 1) {
    return {status: 'unresolved', entity: null, variant: null, game_id: null, canonical_slug: null, variant_id: null, reason: 'ambiguous_external_id'};
  }

  const byAlias = aliasTargets(record, registry);
  if (byAlias.length === 1) {
    return {status: 'matched', entity: byAlias[0], variant: null, game_id: byAlias[0].id, canonical_slug: canonicalSlug(byAlias[0]), variant_id: null, reason: 'canonical_alias'};
  }
  return {status: 'unresolved', entity: null, variant: null, game_id: null, canonical_slug: null, variant_id: null, reason: byAlias.length > 1 ? 'ambiguous_alias' : 'not_found'};
}

export function registerPopularCandidates(registry = {}, snapshots = []) {
  const api = new GameRegistryApi(registry);
  const issues = [];
  let created = 0;
  let matched = 0;

  for (const snapshot of snapshots.filter(Boolean)) {
    for (const [index, item] of (snapshot.ranking ?? []).entries()) {
      const existing = resolveSystemGameIdentity(item, api.registry);
      if (existing.entity && existing.status !== 'mismatch') {
        matched += 1;
        continue;
      }
      if (existing.status === 'mismatch') {
        issues.push({index, slug: item?.slug ?? null, game_id: item?.game_id ?? null, status: 'mismatch', reason: existing.reason, expected_game_id: existing.game_id});
        continue;
      }
      const kind = inferKind(item);
      if (isEmbeddedGameKind(kind)) {
        issues.push({index, slug: item?.slug ?? null, game_id: item?.game_id ?? null, status: 'unresolved', reason: 'embedded_popular_candidate_requires_base_game', kind});
        continue;
      }
      const title = item.title ?? item.name ?? item.slug;
      if (!title || !item.slug) {
        issues.push({index, slug: item?.slug ?? null, game_id: item?.game_id ?? null, status: 'unresolved', reason: 'popular_candidate_missing_identity'});
        continue;
      }
      const result = api.registerCandidate({
        gameId: item.game_id ?? undefined,
        title,
        slug: item.slug,
        steamAppId: item.identity?.steam_appid ?? item.steam_appid ?? item.appid ?? null,
        igdbId: item.identity?.igdb_id ?? item.igdb_id ?? null,
        rawgId: item.identity?.rawg_id ?? item.rawg_id ?? null,
        source: {type: 'automated_inference', name: 'popular-feed'},
        discoveryReason: 'popular_feed_identity',
        status: 'discovered',
        statusReason: 'discovered in Popular ranking',
        confidence: 0.45
      }, {actor: 'popular-registry-adapter'});
      if (result.decision === 'created') created += 1;
      else if (result.decision === 'matched') matched += 1;
      else issues.push({index, slug: item.slug, game_id: item.game_id ?? null, status: 'unresolved', reason: 'popular_candidate_needs_review'});
    }
  }
  return {registry: api.registry, issues, created, matched};
}

export function registerReleaseCandidates(registry = {}, snapshots = []) {
  const api = new GameRegistryApi(registry);
  const issues = [];
  let created = 0;
  let matched = 0;
  for (const snapshot of snapshots.filter(Boolean)) {
    for (const [index, item] of (snapshot.releases ?? []).entries()) {
      const existing = resolveSystemGameIdentity(item, api.registry);
      if (existing.entity && existing.status !== 'mismatch') { matched += 1; continue; }
      if (existing.status === 'mismatch') {
        issues.push({index, slug:item?.slug??null, game_id:item?.game_id??null, status:'mismatch', reason:existing.reason, expected_game_id:existing.game_id});
        continue;
      }
      const kind=inferKind({...item,type:item.release_type});
      if(isEmbeddedGameKind(kind)){
        issues.push({index,slug:item?.slug??null,game_id:item?.game_id??null,status:'unresolved',reason:'embedded_release_candidate_requires_base_game',kind});
        continue;
      }
      const title=item.title??item.name??item.slug;
      if(!title||!item.slug){issues.push({index,slug:item?.slug??null,status:'unresolved',reason:'release_candidate_missing_identity'});continue;}
      const releases=(item.events??[]).map(event=>({id:event.id,platform:(event.platforms??[])[0]??null,region:event.region??'global',date:event.date??event.date_start??null,precision:event.precision??'unknown',status:event.status??'announced',confidence:event.confidence??0.7,source:{type:'official_platform_store',name:'release-feed'}}));
      const result=api.registerCandidate({
        gameId:item.game_id??undefined,
        title,
        slug:item.slug,
        aliases:item.aliases??[],
        kind,
        steamAppId:item.external_ids?.steam??item.steam_appid??null,
        igdbId:item.external_ids?.igdb??item.igdb_id??null,
        rawgId:item.external_ids?.rawg??item.rawg_id??null,
        releases,
        source:{type:'official_platform_store',name:'release-feed',url:item.sources?.[0]?.url??null},
        discoveryReason:'public_release_calendar',
        status:'discovered',
        statusReason:'discovered in validated public release feed',
        confidence:0.75
      },{actor:'release-registry-adapter'});
      if(result.decision==='created')created+=1;
      else if(result.decision==='matched')matched+=1;
      else issues.push({index,slug:item.slug,game_id:item.game_id??null,status:'unresolved',reason:'release_candidate_needs_review'});
    }
  }
  return {registry:api.registry,issues,created,matched};
}

export function canonicalCatalogRecord(record, registry) {
  const resolution = resolveSystemGameIdentity(record, registry);
  if (!resolution.entity) return {record: null, resolution};
  const kind = resolution.entity.identity?.kind?.value ?? 'unknown';
  if (resolution.variant || isEmbeddedGameKind(kind) || resolution.entity.presentation?.standalonePage === false) {
    return {record: null, resolution: {...resolution, status: 'embedded_variant', reason: 'not_a_standalone_catalog_game'}};
  }
  return {
    record: {
      ...clone(record),
      title: record.title ?? resolution.entity.identity?.canonicalTitle?.value ?? record.slug,
      year: record.year ?? null,
      slug: canonicalSlug(resolution.entity),
      game_id: resolution.entity.id
    },
    resolution
  };
}

export function projectPublicCatalog(records = [], registry = {}) {
  const output = [];
  const issues = [];
  const seen = new Set();
  for (const [index, source] of records.entries()) {
    const {record, resolution} = canonicalCatalogRecord(source, registry);
    if (!record) {
      issues.push({index, slug: source?.slug ?? null, game_id: source?.game_id ?? null, status: resolution.status, reason: resolution.reason});
      continue;
    }
    if (seen.has(record.game_id)) {
      issues.push({index, slug: source?.slug ?? null, game_id: record.game_id, status: 'duplicate', reason: 'duplicate_canonical_game'});
      continue;
    }
    seen.add(record.game_id);
    output.push(record);
    if (resolution.status === 'mismatch') issues.push({index, slug: source?.slug ?? null, game_id: source?.game_id ?? null, expected_game_id: record.game_id, status: 'mismatch', reason: resolution.reason});
  }
  return {records: output, issues};
}

export function bindPopularSnapshot(snapshot = {}, registry = {}) {
  const output = clone(snapshot) || {};
  const issues = [];
  output.ranking = (output.ranking ?? []).map((item, index) => {
    const resolution = resolveSystemGameIdentity(item, registry);
    if (!resolution.entity) {
      issues.push({index, slug: item?.slug ?? null, game_id: item?.game_id ?? null, status: resolution.status, reason: resolution.reason});
      return item;
    }
    if (resolution.status === 'mismatch') {
      issues.push({index, slug: item?.slug ?? null, game_id: item?.game_id ?? null, expected_game_id: resolution.game_id, status: 'mismatch', reason: resolution.reason});
    }
    const next = {
      ...item,
      game_id: resolution.game_id,
      canonical_slug: resolution.canonical_slug
    };
    if (resolution.variant_id) next.variant_id = resolution.variant_id;
    else delete next.variant_id;
    return next;
  });
  return {snapshot: output, issues};
}

export function canonicalGameRoute(record, registry = {}) {
  const resolution = resolveSystemGameIdentity(record, registry);
  return resolution.entity ? `/game/${resolution.canonical_slug}/` : null;
}
