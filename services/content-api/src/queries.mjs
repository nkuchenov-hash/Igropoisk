import { latestShadowSync, serializeShadowSync } from './runtime-state.mjs';

function newsSelect() {
  return `
    SELECT
      event.id,
      event.status,
      event.type,
      event.importance,
      event.official,
      event.title_ru,
      event.title_en,
      event.summary_ru,
      event.summary_en,
      event.body,
      event.published_at,
      event.homepage_until,
      event.primary_url,
      COALESCE(primary_source.name, '') AS primary_source,
      COALESCE(media.public_url, '') AS image,
      event.game_ids,
      event.regions,
      event.global_eligible,
      event.regional_eligible,
      event.media_source_count,
      event.discussion_mentions,
      event.trend_score,
      event.global_score,
      event.regional_score,
      event.confidence,
      COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'name', source.name,
          'organization', source.organization,
          'kind', source.kind,
          'url', link.source_url,
          'official', link.official,
          'publishedAt', link.published_at
        ) ORDER BY link.official DESC, source.name)
        FROM news_event_sources link
        JOIN sources source ON source.id = link.source_id
        WHERE link.event_id = event.id
      ), '[]'::JSONB) AS sources
    FROM news_events event
    LEFT JOIN sources primary_source ON primary_source.id = event.primary_source_id
    LEFT JOIN media_assets media ON media.id = event.image_id
  `;
}

function serialize(row) {
  return {
    id: row.id,
    status: row.status,
    type: row.type,
    importance: row.importance,
    official: row.official,
    titleRu: row.title_ru,
    titleEn: row.title_en,
    summaryRu: row.summary_ru,
    summaryEn: row.summary_en,
    body: row.body,
    publishedAt: row.published_at?.toISOString?.() || row.published_at,
    homepageUntil: row.homepage_until?.toISOString?.() || row.homepage_until,
    primaryUrl: row.primary_url,
    primarySource: row.primary_source,
    image: row.image,
    gameIds: row.game_ids || [],
    regions: row.regions || [],
    globalEligible: row.global_eligible,
    regionalEligible: row.regional_eligible,
    mediaSourceCount: row.media_source_count,
    discussionMentions: row.discussion_mentions,
    trendScore: Number(row.trend_score || 0),
    globalScore: Number(row.global_score || 0),
    regionalScore: Number(row.regional_score || 0),
    confidence: Number(row.confidence || 0),
    sources: row.sources || []
  };
}

export async function listPublishedNews(pool, { limit = 30, offset = 0 } = {}) {
  const result = await pool.query(`
    ${newsSelect()}
    WHERE event.status = 'published'
    ORDER BY event.published_at DESC, event.id
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return result.rows.map(serialize);
}

export async function getPublishedNews(pool, id) {
  const result = await pool.query(`
    ${newsSelect()}
    WHERE event.status = 'published' AND event.id = $1
    LIMIT 1
  `, [id]);
  return result.rows[0] ? serialize(result.rows[0]) : null;
}

export async function currentPublication(pool, channel = 'news') {
  const result = await pool.query(`
    SELECT id, channel, snapshot_version, status, manifest_url, item_count, stats, published_at
    FROM publications
    WHERE channel = $1 AND status = 'published'
    ORDER BY published_at DESC, id DESC
    LIMIT 1
  `, [channel]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    channel: row.channel,
    snapshotVersion: row.snapshot_version,
    status: row.status,
    manifestUrl: row.manifest_url,
    itemCount: row.item_count,
    stats: row.stats,
    publishedAt: row.published_at?.toISOString?.() || row.published_at
  };
}

export async function ledgerHealth(pool) {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'published')::INTEGER AS published_count,
      COUNT(*) FILTER (WHERE status = 'quarantine')::INTEGER AS quarantine_count,
      MAX(updated_at) AS last_content_update
    FROM news_events
  `);
  const [publication, latestSyncRow] = await Promise.all([
    currentPublication(pool, 'news'),
    latestShadowSync(pool, 'news')
  ]);
  const latestSync = serializeShadowSync(latestSyncRow);
  const synchronized = Boolean(
    latestSync
    && latestSync.status === 'exact'
    && latestSync.sourceDigest === latestSync.ledgerDigest
    && latestSync.sourceItemCount === latestSync.ledgerItemCount
  );
  const row = result.rows[0];
  return {
    status: publication && synchronized ? 'ready' : 'not_ready',
    database: 'postgresql',
    publishedCount: row.published_count,
    quarantineCount: row.quarantine_count,
    lastContentUpdate: row.last_content_update?.toISOString?.() || row.last_content_update || null,
    publication,
    latestSync
  };
}
