export function hasMissingGamePage(item = {}) {
  if (Array.isArray(item?.gameReviewReasons) && item.gameReviewReasons.includes('missing-game-page')) return true;
  return (Array.isArray(item?.games) ? item.games : []).some(game => game && typeof game === 'object' && game.pageExists === false);
}

export function collectMissingGamePageRequests(items = []) {
  const requests = new Map();
  for (const item of items) {
    if (!hasMissingGamePage(item)) continue;
    for (const game of Array.isArray(item?.games) ? item.games : []) {
      if (!game || typeof game !== 'object' || game.pageExists !== false) continue;
      const gameId = String(game.gameId || game.game_id || '').trim();
      const slug = String(game.slug || '').trim();
      const title = String(game.title || item.game || '').trim();
      if (!slug || !title) continue;
      const key = gameId || `${slug}:${title}`;
      const candidate = {
        news_id: item.id || null,
        game_id: gameId || null,
        title,
        slug,
        confidence: Number(game.resolutionConfidence || game.confidence || 0),
        verified_external: Boolean(game.verifiedExternal),
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

export function filterUnreadyNewsItems(items = []) {
  return items.filter(item => !hasMissingGamePage(item));
}

export function filterNewsPayload(payload) {
  if (Array.isArray(payload)) return filterUnreadyNewsItems(payload);
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) return payload;
  return { ...payload, items: filterUnreadyNewsItems(payload.items) };
}
