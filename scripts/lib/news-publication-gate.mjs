export function hasMissingGamePage(item = {}) {
  if (Array.isArray(item?.gameReviewReasons) && item.gameReviewReasons.includes('missing-game-page')) return true;
  return (Array.isArray(item?.games) ? item.games : []).some(game => game && typeof game === 'object' && game.pageExists === false);
}

export function filterUnreadyNewsItems(items = []) {
  return items.filter(item => !hasMissingGamePage(item));
}

export function filterNewsPayload(payload) {
  if (Array.isArray(payload)) return filterUnreadyNewsItems(payload);
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) return payload;
  return { ...payload, items: filterUnreadyNewsItems(payload.items) };
}
