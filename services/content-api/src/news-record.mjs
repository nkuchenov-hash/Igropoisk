import crypto from 'node:crypto';

const validStatuses = new Set(['draft', 'quarantine', 'published', 'archived']);

function asString(value) {
  return String(value ?? '').trim();
}

function asDate(value, field) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be a valid date.`);
  return date.toISOString();
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(asString).filter(Boolean))];
}

export function stableId(prefix, value, length = 24) {
  return `${prefix}_${crypto.createHash('sha256').update(asString(value)).digest('hex').slice(0, length)}`;
}

export function contentHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function normalizeSource(raw = {}, fallback = {}) {
  const name = asString(raw.name || fallback.name);
  const url = asString(raw.url || fallback.url);
  if (!name) throw new Error('News source name is required.');
  return {
    id: stableId('source', `${name}\n${url}`),
    name,
    organization: asString(raw.organization || fallback.organization),
    kind: asString(raw.kind || fallback.kind || 'media'),
    canonicalUrl: url,
    official: Boolean(raw.official ?? fallback.official),
    publishedAt: raw.publishedAt ? asDate(raw.publishedAt, 'source.publishedAt') : null,
    payload: raw
  };
}

export function normalizeNewsEvent(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('News event must be an object.');

  const id = asString(raw.id);
  const primaryUrl = asString(raw.primaryUrl || raw.url);
  const titleRu = asString(raw.titleRu || raw.title);
  if (!id) throw new Error('News event id is required.');
  if (!/^https?:\/\//i.test(primaryUrl)) throw new Error(`News event ${id} has invalid primaryUrl.`);
  if (!titleRu) throw new Error(`News event ${id} has no titleRu.`);

  const official = Boolean(raw.official || raw.type === 'official');
  const primarySourceName = asString(raw.primarySource || raw.publisher || raw.organization || raw.source);
  const sourceInput = Array.isArray(raw.sources) && raw.sources.length
    ? raw.sources
    : [{
        name: primarySourceName || new URL(primaryUrl).hostname,
        url: primaryUrl,
        official
      }];
  const sources = sourceInput.map(source => normalizeSource(source, {
    name: primarySourceName,
    url: primaryUrl,
    official
  }));

  const imageUrl = asString(raw.image);
  const media = imageUrl ? {
    id: stableId('media', imageUrl),
    publicUrl: imageUrl,
    sourceUrl: asString(raw.imageSourceUrl),
    storageKey: imageUrl.startsWith('http') ? new URL(imageUrl).pathname.replace(/^\//, '') : imageUrl,
    sha256: /^[a-f0-9]{64}$/i.test(asString(raw.imageSha256)) ? asString(raw.imageSha256).toLowerCase() : null,
    mimeType: asString(raw.imageMimeType),
    width: Number.isInteger(raw.imageWidth) && raw.imageWidth > 0 ? raw.imageWidth : null,
    height: Number.isInteger(raw.imageHeight) && raw.imageHeight > 0 ? raw.imageHeight : null,
    status: 'ready'
  } : null;

  const gameIds = uniqueStrings(
    Array.isArray(raw.game_ids) ? raw.game_ids
      : Array.isArray(raw.gameIds) ? raw.gameIds
        : raw.game ? [raw.game] : []
  );
  const mediaSourceCount = Math.max(0, Number(raw.mediaSourceCount || raw.sourceCount || sources.length || 0));
  const confidence = Math.min(1, Math.max(0, Number(
    raw.confidence ?? (official ? 1 : 0.55 + Math.min(mediaSourceCount, 4) * 0.1)
  )));

  return {
    id,
    status: validStatuses.has(raw.status) ? raw.status : 'published',
    type: asString(raw.type || (official ? 'official' : 'ranked')),
    importance: asString(raw.importance || 'normal'),
    official,
    titleRu,
    titleEn: asString(raw.titleEn || raw.title),
    summaryRu: asString(raw.summaryRu || raw.summary),
    summaryEn: asString(raw.summaryEn || raw.summary),
    body: Array.isArray(raw.body) ? raw.body : [],
    publishedAt: asDate(raw.publishedAt, 'publishedAt'),
    homepageUntil: raw.homepageUntil || raw.homeUntil ? asDate(raw.homepageUntil || raw.homeUntil, 'homepageUntil') : null,
    primaryUrl,
    primarySourceId: sources[0]?.id || null,
    media,
    gameIds,
    regions: uniqueStrings(raw.regions),
    globalEligible: Boolean(raw.globalEligible),
    regionalEligible: Boolean(raw.regionalEligible),
    mediaSourceCount,
    discussionMentions: Math.max(0, Number(raw.discussionMentions || 0)),
    trendScore: Number(raw.trendScore || 0),
    globalScore: Number(raw.globalScore || 0),
    regionalScore: Number(raw.regionalScore || 0),
    confidence,
    sources,
    raw
  };
}

export function revisionDocument(event) {
  return {
    id: event.id,
    status: event.status,
    type: event.type,
    importance: event.importance,
    official: event.official,
    titleRu: event.titleRu,
    titleEn: event.titleEn,
    summaryRu: event.summaryRu,
    summaryEn: event.summaryEn,
    body: event.body,
    publishedAt: event.publishedAt,
    homepageUntil: event.homepageUntil,
    primaryUrl: event.primaryUrl,
    primarySourceId: event.primarySourceId,
    imageId: event.media?.id || null,
    gameIds: event.gameIds,
    regions: event.regions,
    globalEligible: event.globalEligible,
    regionalEligible: event.regionalEligible,
    mediaSourceCount: event.mediaSourceCount,
    discussionMentions: event.discussionMentions,
    trendScore: event.trendScore,
    globalScore: event.globalScore,
    regionalScore: event.regionalScore,
    confidence: event.confidence,
    sources: event.sources.map(source => ({
      id: source.id,
      url: source.canonicalUrl,
      official: source.official,
      publishedAt: source.publishedAt
    }))
  };
}

export function parseSnapshot(payload) {
  const items = Array.isArray(payload) ? payload : payload?.items;
  if (!Array.isArray(items)) throw new Error('News snapshot must contain an items array.');
  return {
    generatedAt: payload?.generatedAt || payload?.generated_at || new Date().toISOString(),
    items: items.map(normalizeNewsEvent)
  };
}
