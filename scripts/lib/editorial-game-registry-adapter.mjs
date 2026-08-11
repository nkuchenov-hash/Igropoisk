import { GameRegistryApi, normalizeAlias, normalizeExternalIds } from './game-registry.mjs';
import { migrateRepository } from './game-registry-migration.mjs';

export function loadEditorialRegistry(root = process.cwd()) {
  const { registry } = migrateRepository(root, { dryRun: true, publicBaseUrl: '/game' });
  return { registry, api: new GameRegistryApi(registry, { publicBaseUrl: '/game' }) };
}

function unique(values) {
  return [...new Map(values.filter(Boolean).map(entity => [entity.id, entity])).values()];
}

function activeEntity(registry, entityOrId) {
  let entity = typeof entityOrId === 'string' ? registry.games?.[entityOrId] ?? null : entityOrId;
  const seen = new Set();
  while (entity?.workflow?.status === 'merged_into_another_game') {
    if (seen.has(entity.id)) throw new Error(`Game Registry merge cycle at ${entity.id}`);
    seen.add(entity.id);
    const nextId = entity.mergedIntoGameId ?? entity.merged_into_game_id ?? null;
    if (!nextId) return null;
    entity = registry.games?.[nextId] ?? null;
  }
  return entity ?? null;
}

function variantOwnerById(registry, variantId) {
  if (!variantId) return null;
  for (const raw of Object.values(registry.games || {})) {
    const game = activeEntity(registry, raw);
    if (!game || game.id !== raw.id) continue;
    const variant = (game.variants || []).find(item => item.id === variantId);
    if (variant) return { game, variant };
  }
  return null;
}

function variantOwnerBySlug(registry, slug) {
  if (!slug) return null;
  for (const raw of Object.values(registry.games || {})) {
    const game = activeEntity(registry, raw);
    if (!game || game.id !== raw.id) continue;
    const variant = (game.variants || []).find(item => item.slug === slug);
    if (variant) return { game, variant };
  }
  return null;
}

function variantOwnersByTitle(registry, title) {
  const key = normalizeAlias(title);
  if (!key) return [];
  const matches = [];
  for (const raw of Object.values(registry.games || {})) {
    const game = activeEntity(registry, raw);
    if (!game || game.id !== raw.id) continue;
    for (const variant of game.variants || []) {
      if (normalizeAlias(variant.title) === key) matches.push({ game, variant });
    }
  }
  return matches;
}

export function resolveEditorialGame(input = {}, { root = process.cwd(), loaded } = {}) {
  const context = loaded || loadEditorialRegistry(root);
  const { api, registry } = context;
  const explicitId = input.game_id ?? input.gameId ?? input.id;
  const explicitVariantId = input.variant_id ?? input.variantId ?? input.variant?.id;
  let staleExplicitId = null;
  if (explicitId) {
    const rawEntity = api.findById(String(explicitId));
    const entity = activeEntity(registry, rawEntity);
    if (entity) {
      if (explicitVariantId) {
        const owner = variantOwnerById(registry, String(explicitVariantId));
        if (!owner || owner.game.id !== entity.id) throw new Error(`Unknown variant_id ${explicitVariantId} for canonical game ${explicitId}`);
        return canonicalIdentity(entity, rawEntity?.id === entity.id ? 'game_id+variant_id' : 'merged_game_id+variant_id', owner.variant);
      }
      return canonicalIdentity(entity, rawEntity?.id === entity.id ? 'game_id' : 'merged_game_id');
    }
    staleExplicitId = String(explicitId);
  }

  const slug = String(input.variant_slug ?? input.slug ?? input.game_slug ?? input.game?.slug ?? '').trim();
  if (slug) {
    const owner = variantOwnerBySlug(registry, slug);
    if (owner) return canonicalIdentity(owner.game, staleExplicitId ? 'stale_game_id+variant_slug' : 'variant_slug', owner.variant);
    const entity = activeEntity(registry, api.findBySlug(slug));
    if (entity) return canonicalIdentity(entity, staleExplicitId ? 'stale_game_id+slug' : 'slug');
  }

  const title = String(input.variant_title ?? input.title ?? input.name ?? input.game?.title ?? '').trim();
  if (title) {
    const variantMatches = variantOwnersByTitle(registry, title);
    if (variantMatches.length === 1) return canonicalIdentity(variantMatches[0].game, staleExplicitId ? 'stale_game_id+variant_title' : 'variant_title', variantMatches[0].variant);
    if (variantMatches.length > 1) throw new Error(`Ambiguous embedded content title "${title}" resolves to ${variantMatches.length} variants`);
  }

  const external = normalizeExternalIds(input.externalIds ?? input.external_ids ?? input.identity ?? input);
  const externalMatches = unique([
    external.igdbId ? activeEntity(registry, api.findByExternalId('igdbId', external.igdbId)) : null,
    external.rawgId ? activeEntity(registry, api.findByExternalId('rawgId', external.rawgId)) : null,
    external.steamAppId ? activeEntity(registry, api.findByExternalId('steamAppId', external.steamAppId)) : null
  ]);
  if (externalMatches.length > 1) throw new Error(`Conflicting external IDs resolve to multiple games: ${externalMatches.map(item => item.id).join(', ')}`);
  if (externalMatches.length === 1) return canonicalIdentity(externalMatches[0], staleExplicitId ? 'stale_game_id+external_id' : 'external_id');

  if (title) {
    const aliases = unique(api.findByExactAlias(title).map(entity => activeEntity(registry, entity)));
    if (aliases.length === 1) return canonicalIdentity(aliases[0], staleExplicitId ? 'stale_game_id+exact_alias' : 'exact_alias');
    if (aliases.length > 1) throw new Error(`Ambiguous game title "${title}" resolves to ${aliases.length} canonical games`);
  }

  if (staleExplicitId) throw new Error(`Unknown canonical game_id ${staleExplicitId} and no secondary identity resolved it`);
  throw new Error(`Cannot resolve editorial game to canonical Game Registry entity: ${slug || title || 'missing identity'}`);
}

export function canonicalIdentity(entity, matchedBy = 'unknown', variant = null) {
  if (!entity || entity.workflow?.status === 'merged_into_another_game') throw new Error('Invalid canonical game entity');
  return Object.freeze({
    game_id: entity.id,
    slug: String(entity.identity?.slug?.value || ''),
    title: String(entity.identity?.canonicalTitle?.value || ''),
    variant_id: variant?.id ?? null,
    variant_kind: variant?.kind ?? null,
    variant_slug: variant?.slug ?? null,
    variant_title: variant?.title ?? null,
    matched_by: matchedBy
  });
}

export function applyCanonicalGameIdentity(document, identity) {
  const next = structuredClone(document || {});
  next.game_id = identity.game_id;
  if (Object.hasOwn(next, 'game_slug')) next.game_slug = identity.slug;
  if (next.game && typeof next.game === 'object' && !Array.isArray(next.game)) {
    next.game.game_id = identity.game_id;
    next.game.slug = identity.slug;
  }
  if (next.game_identity && typeof next.game_identity === 'object' && !Array.isArray(next.game_identity)) {
    next.game_identity.game_id = identity.game_id;
  }
  if (identity.variant_id) {
    next.variant_id = identity.variant_id;
    next.variant_kind = identity.variant_kind;
    next.variant_slug = identity.variant_slug;
    next.variant_title = identity.variant_title;
  }
  return next;
}
