import { isEmbeddedGameKind, normalizeExternalIds, normalizeAlias } from './game-registry.mjs';

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

function canonicalTitle(entity) {
  return String(entity?.identity?.canonicalTitle?.value ?? '').trim();
}

function releaseYear(entity) {
  for (const release of entity?.releases ?? []) {
    const match = String(release?.date?.value ?? '').match(/(?:19|20)\d{2}/);
    if (match) return Number(match[0]);
  }
  return null;
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

export function canonicalCatalogRecord(record, registry) {
  const resolution = resolveSystemGameIdentity(record, registry);
  if (!resolution.entity) return {record: null, resolution};
  const kind = resolution.entity.identity?.kind?.value ?? 'unknown';
  if (resolution.variant || isEmbeddedGameKind(kind) || resolution.entity.presentation?.standalonePage === false) {
    return {record: null, resolution: {...resolution, status: 'embedded_variant', reason: 'not_a_standalone_catalog_game'}};
  }
  const year = releaseYear(resolution.entity) ?? (Number(record.year) || null);
  return {
    record: {
      ...clone(record),
      title: canonicalTitle(resolution.entity) || record.title,
      year,
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
