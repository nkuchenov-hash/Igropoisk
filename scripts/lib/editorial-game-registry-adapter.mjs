import { GameRegistryApi, normalizeExternalIds } from './game-registry.mjs';
import { migrateRepository } from './game-registry-migration.mjs';

export function loadEditorialRegistry(root = process.cwd()) {
  const { registry } = migrateRepository(root, { dryRun: true, publicBaseUrl: '/game' });
  return { registry, api: new GameRegistryApi(registry, { publicBaseUrl: '/game' }) };
}

function unique(values) {
  return [...new Map(values.filter(Boolean).map(entity => [entity.id, entity])).values()];
}

export function resolveEditorialGame(input = {}, { root = process.cwd(), loaded } = {}) {
  const context = loaded || loadEditorialRegistry(root);
  const { api } = context;
  const explicitId = input.game_id ?? input.gameId ?? input.id;
  if (explicitId) {
    const entity = api.findById(String(explicitId));
    if (!entity) throw new Error(`Unknown canonical game_id: ${explicitId}`);
    return canonicalIdentity(entity, 'game_id');
  }

  const external = normalizeExternalIds(input.externalIds ?? input.external_ids ?? input.identity ?? input);
  const externalMatches = unique([
    external.igdbId ? api.findByExternalId('igdbId', external.igdbId) : null,
    external.rawgId ? api.findByExternalId('rawgId', external.rawgId) : null,
    external.steamAppId ? api.findByExternalId('steamAppId', external.steamAppId) : null
  ]);
  if (externalMatches.length > 1) throw new Error(`Conflicting external IDs resolve to multiple games: ${externalMatches.map(item => item.id).join(', ')}`);
  if (externalMatches.length === 1) return canonicalIdentity(externalMatches[0], 'external_id');

  const slug = String(input.slug ?? input.game_slug ?? input.game?.slug ?? '').trim();
  if (slug) {
    const entity = api.findBySlug(slug);
    if (entity) return canonicalIdentity(entity, 'slug');
  }

  const title = String(input.title ?? input.name ?? input.game?.title ?? '').trim();
  if (title) {
    const aliases = unique(api.findByExactAlias(title));
    if (aliases.length === 1) return canonicalIdentity(aliases[0], 'exact_alias');
    if (aliases.length > 1) throw new Error(`Ambiguous game title "${title}" resolves to ${aliases.length} canonical games`);
  }

  throw new Error(`Cannot resolve editorial game to canonical Game Registry entity: ${slug || title || 'missing identity'}`);
}

export function canonicalIdentity(entity, matchedBy = 'unknown') {
  if (!entity || entity.workflow?.status === 'merged_into_another_game') throw new Error('Invalid canonical game entity');
  return Object.freeze({
    game_id: entity.id,
    slug: String(entity.identity?.slug?.value || ''),
    title: String(entity.identity?.canonicalTitle?.value || ''),
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
  return next;
}
