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
    const identityVerified = request.identity_verified === true || request.identityVerified === true;
    const verifiedExternal = Boolean(request.verified_external || request.verifiedExternal);
    if (!title || !slug) {
      issues.push({ index, game_id: temporaryGameId || null, slug: slug || null, status: 'unresolved', reason: 'news_candidate_missing_identity' });
      continue;
    }
    if (!identityVerified) {
      issues.push({ index, game_id: temporaryGameId || null, slug, title, status: 'rejected', reason: 'news_candidate_identity_not_verified' });
      continue;
    }
    if (temporaryGameId.startsWith('news_game_') && !verifiedExternal) {
      issues.push({ index, game_id: temporaryGameId, slug, title, status: 'rejected', reason: 'temporary_news_candidate_requires_external_verification' });
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
          name: verifiedExternal ? 'news-game-web-identity-verified' : 'news-game-canonical-identity-verified',
          url: request.source_url || request.verification_sources?.[0]?.url || null
        },
        sourceRecordId: temporaryGameId || request.news_id || null,
        discoveryReason: 'web_verified_primary_game_in_public_news',
        status: 'discovered',
        statusReason: 'verified as a primary video-game identity of a public news item',
        confidence: clampConfidence(request.confidence, verifiedExternal ? 0.9 : 0.88)
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
      verified_external: verifiedExternal,
      identity_verified: true,
      verification_sources: Array.isArray(request.verification_sources) ? request.verification_sources : [],
      confidence: clampConfidence(request.confidence, verifiedExternal ? 0.9 : 0.88)
    });
  }

  return { registry: api.registry, resolved, issues, created, matched };
}
