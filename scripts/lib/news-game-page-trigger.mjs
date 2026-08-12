function newsItems(payload = {}) {
  return Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : []);
}

function gameReference(value) {
  if (typeof value === 'string') return { slug: value };
  return value && typeof value === 'object' ? value : {};
}

function recordReference(output, entity, item = {}) {
  if (!entity?.id) return;
  const publishedAt = String(item?.publishedAt || '').trim();
  const previous = output.get(entity.id);
  const nextTime = Date.parse(publishedAt || '');
  const previousTime = Date.parse(previous?.latestPublishedAt || '');
  output.set(entity.id, {
    gameId: entity.id,
    slug: String(entity.identity?.slug?.value || ''),
    title: String(entity.identity?.canonicalTitle?.value || ''),
    mentions: Number(previous?.mentions || 0) + 1,
    latestPublishedAt: Number.isFinite(nextTime) && (!Number.isFinite(previousTime) || nextTime > previousTime)
      ? publishedAt
      : (previous?.latestPublishedAt || publishedAt || '')
  });
}

export function collectNewsGamePageReferences(payload, api, { requestedGameIds = [] } = {}) {
  const output = new Map();
  for (const item of newsItems(payload)) {
    for (const value of Array.isArray(item?.games) ? item.games : []) {
      const reference = gameReference(value);
      const gameId = String(reference?.gameId || reference?.game_id || '').trim();
      const slug = String(reference?.slug || '').trim();
      const entity = (gameId && api.findById(gameId)) || (slug && api.findBySlug(slug));
      if (entity) recordReference(output, entity, item);
    }
    for (const value of Array.isArray(item?.gameIds) ? item.gameIds : []) {
      const entity = api.findById(String(value || '').trim());
      if (entity) recordReference(output, entity, item);
    }
  }
  for (const value of requestedGameIds) {
    const gameId = String(value || '').trim();
    if (!gameId) continue;
    const entity = api.findById(gameId) || api.findBySlug(gameId);
    if (entity) recordReference(output, entity, { publishedAt: new Date().toISOString() });
  }
  return output;
}

export function selectRunnablePageTasks(queue = [], { regularLimit = 2 } = {}) {
  const isPageTask = item => item?.type === 'build_page' || item?.type === 'enrich_game';
  const newsTasks = queue.filter(item => isPageTask(item) && item.news_reference === true);
  const newsSlugs = new Set(newsTasks.map(item => item.slug));
  const regularTasks = queue
    .filter(item => isPageTask(item) && !newsSlugs.has(item.slug))
    .slice(0, Math.max(0, Number(regularLimit || 0)));
  return [...newsTasks, ...regularTasks]
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || String(a.slug || '').localeCompare(String(b.slug || '')));
}
