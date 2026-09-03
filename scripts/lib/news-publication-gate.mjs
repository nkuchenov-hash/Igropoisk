import { stableGameId } from './game-registry.mjs';

const GENERIC_NON_GAME_TITLES = new Set(['a', 'an', 'the', 'game', 'games', 'gaming']);

function isCanonicalGameId(value) {
  return /^game_[a-f0-9]{20}$/i.test(String(value || '').trim()) || /^game_[a-z0-9][a-z0-9_-]*$/i.test(String(value || '').trim());
}

function isSafeVerifiedGameIdentity({ title, slug }) {
  const normalizedTitle = String(title || '').trim().toLocaleLowerCase('en-US');
  const normalizedSlug = String(slug || '').trim().toLocaleLowerCase('en-US');
  return Boolean(normalizedTitle && normalizedSlug && !GENERIC_NON_GAME_TITLES.has(normalizedTitle) && !GENERIC_NON_GAME_TITLES.has(normalizedSlug));
}

export function hasMissingGamePage(item = {}) {
  if (Array.isArray(item?.gameReviewReasons) && item.gameReviewReasons.includes('missing-game-page')) return true;
  return (Array.isArray(item?.games) ? item.games : []).some(game => game && typeof game === 'object' && (
    game.pageExists === false || game.pageReady === false || game.assemblyRequired === true
  ));
}

export function collectMissingGamePageRequests(items = []) {
  const requests = new Map();
  for (const item of items) {
    if (!hasMissingGamePage(item)) continue;
    for (const game of Array.isArray(item?.games) ? item.games : []) {
      if (!game || typeof game !== 'object') continue;
      const needsAssembly = game.pageExists === false || game.pageReady === false || game.assemblyRequired === true;
      if (!needsAssembly) continue;
      const rawGameId = String(game.gameId || game.game_id || '').trim();
      const slug = String(game.slug || '').trim();
      const title = String(game.title || item.game || '').trim();
      const identityVerified = game.identityVerified === true;
      if (!slug || !title || !identityVerified || !isSafeVerifiedGameIdentity({ title, slug })) continue;
      const gameId = isCanonicalGameId(rawGameId) && !rawGameId.startsWith('news_game_')
        ? rawGameId
        : stableGameId({ canonicalTitle: title, title, slug });
      const key = gameId;
      const candidate = {
        news_id: item.id || null,
        game_id: gameId,
        title,
        slug,
        confidence: Number(game.resolutionConfidence || game.confidence || 0),
        verified_external: Boolean(game.verifiedExternal),
        identity_verified: identityVerified,
        verification_sources: Array.isArray(game.verificationSources) ? game.verificationSources : [],
        matched_by: game.matchedBy || null,
        source_url: item.primaryUrl || item.url || null,
        published_at: item.publishedAt || null
      };
      const previous = requests.get(key);
      if (!previous || Date.parse(candidate.published_at || '') > Date.parse(previous.published_at || '')) requests.set(key, candidate);
    }
  }
  return [...requests.values()];
}
