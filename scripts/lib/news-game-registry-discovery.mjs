import { GameRegistryApi } from './game-registry.mjs';
import { resolveSystemGameIdentity } from './system-game-registry-adapter.mjs';

function clampConfidence(value, floor = 0.78) {
  const number = Number(value);
  return Math.max(floor, Math.min(0.99, Number.isFinite(number) ? number : floor));
}

export function decodeNewsGameRequests(encoded = '') {
  const value = String(encoded || '').trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : [];
  } catch (error) {
    throw new Error(`Invalid NEWS_GAME_REQUESTS_B64 payload: ${error.message}`);
  }
}

export function registerNewsGameCandidates(registry = {}, requests = []) {
  const api = new GameRegistryApi(registry);
  const resolved = [];
  const issues = [];
  let created = 0;
  let matched = 0;

  for (const [index, request] of requests.entries()) {
    const title = String(request.title || '').trim();
    const slug = String(request.slug || '').trim();
    const temporaryGameId = String(request.game_id || request.gameId || '').trim();
    if (!title || !slug) {
      issues.push({ index, game_id: temporaryGameId || null, slug: slug || null, status: 'unresolved', reason: 'news_candidate_missing_identity' });
      continue;
    }

    const existing = resolveSystemGameIdentity({ title, slug }, api.registry);
    let entity = existing.entity;
    let decision = entity ? 'matched' : '';
    if (!entity) {
      const registration = api.registerCandidate({
        title,
        slug,
        source: {
          type: 'automated_inference',
          name: request.verified_external ? 'news-game-context-verified' : 'news-game-context',
          url: request.source_url || null
        },
        sourceRecordId: temporaryGameId || request.news_id || null,
        discoveryReason: 'resolved_primary_game_in_public_news',
        status: 'discovered',
        statusReason: 'resolved as the primary game of a public news item',
        confidence: clampConfidence(request.confidence, request.verified_external ? 0.9 : 0.78)
      }, { actor: 'news-registry-adapter' });
      entity = registration.entity || null;
      decision = registration.decision || '';
    }

    if (!entity || decision === 'ambiguous' || decision === 'needs_review') {
      issues.push({ index, game_id: temporaryGameId || null, slug, title, status: decision || 'unresolved', reason: 'news_candidate_needs_identity_review' });
      continue;
    }
    if (decision === 'created') created += 1;
    else matched += 1;
    resolved.push({
      request_game_id: temporaryGameId || null,
      game_id: entity.id,
      slug: String(entity.identity?.slug?.value || slug),
      title: String(entity.identity?.canonicalTitle?.value || title),
      news_id: request.news_id || null,
      source_url: request.source_url || null,
      verified_external: Boolean(request.verified_external),
      confidence: clampConfidence(request.confidence, request.verified_external ? 0.9 : 0.78)
    });
  }

  return { registry: api.registry, resolved, issues, created, matched };
}
