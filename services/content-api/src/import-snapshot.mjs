import fs from 'node:fs/promises';
import path from 'node:path';
import { getPool, closePool, withTransaction } from './database.mjs';
import { runMigrations } from './migrate.mjs';
import { contentHash, parseSnapshot, revisionDocument } from './news-record.mjs';

function argumentsFrom(argv) {
  const result = {
    file: path.resolve(process.cwd(), '../../data/news-events.json'),
    snapshotVersion: '',
    channel: 'news',
    manifestUrl: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--file' && value) result.file = path.resolve(process.cwd(), value);
    if (name === '--snapshot-version' && value) result.snapshotVersion = value;
    if (name === '--channel' && value) result.channel = value;
    if (name === '--manifest-url' && value) result.manifestUrl = value;
    if (name.startsWith('--') && value && !value.startsWith('--')) index += 1;
  }
  return result;
}

async function upsertSource(client, source) {
  await client.query(`
    INSERT INTO sources(id, name, organization, kind, canonical_url, official)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      organization = EXCLUDED.organization,
      kind = EXCLUDED.kind,
      canonical_url = EXCLUDED.canonical_url,
      official = EXCLUDED.official,
      updated_at = NOW()
  `, [source.id, source.name, source.organization, source.kind, source.canonicalUrl, source.official]);
}

async function upsertMedia(client, media) {
  if (!media) return;
  await client.query(`
    INSERT INTO media_assets(
      id, public_url, source_url, storage_key, sha256, mime_type, width, height, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (id) DO UPDATE SET
      public_url = EXCLUDED.public_url,
      source_url = EXCLUDED.source_url,
      storage_key = EXCLUDED.storage_key,
      sha256 = COALESCE(EXCLUDED.sha256, media_assets.sha256),
      mime_type = COALESCE(NULLIF(EXCLUDED.mime_type, ''), media_assets.mime_type),
      width = COALESCE(EXCLUDED.width, media_assets.width),
      height = COALESCE(EXCLUDED.height, media_assets.height),
      status = EXCLUDED.status,
      updated_at = NOW()
  `, [
    media.id, media.publicUrl, media.sourceUrl, media.storageKey, media.sha256,
    media.mimeType, media.width, media.height, media.status
  ]);
}

async function ensureRevision(client, event, snapshotVersion) {
  const document = revisionDocument(event);
  const hash = contentHash(document);
  const existing = await client.query(`
    SELECT id, revision_no, content_hash
    FROM content_revisions
    WHERE entity_type = 'news_event' AND entity_id = $1
    ORDER BY revision_no DESC
    LIMIT 1
  `, [event.id]);

  if (existing.rows[0]?.content_hash === hash) return existing.rows[0].id;

  const nextRevision = Number(existing.rows[0]?.revision_no || 0) + 1;
  const inserted = await client.query(`
    INSERT INTO content_revisions(
      entity_type, entity_id, revision_no, snapshot_version, content, content_hash
    ) VALUES ('news_event', $1, $2, $3, $4::JSONB, $5)
    RETURNING id
  `, [event.id, nextRevision, snapshotVersion, JSON.stringify(document), hash]);
  return inserted.rows[0].id;
}

async function upsertEvent(client, event, revisionId) {
  await client.query(`
    INSERT INTO news_events(
      id, status, type, importance, official, title_ru, title_en, summary_ru, summary_en,
      body, published_at, homepage_until, primary_url, primary_source_id, image_id,
      game_ids, regions, global_eligible, regional_eligible, media_source_count,
      discussion_mentions, trend_score, global_score, regional_score, confidence,
      current_revision_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10::JSONB, $11, $12, $13, $14, $15,
      $16::TEXT[], $17::TEXT[], $18, $19, $20,
      $21, $22, $23, $24, $25, $26
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      type = EXCLUDED.type,
      importance = EXCLUDED.importance,
      official = EXCLUDED.official,
      title_ru = EXCLUDED.title_ru,
      title_en = EXCLUDED.title_en,
      summary_ru = EXCLUDED.summary_ru,
      summary_en = EXCLUDED.summary_en,
      body = EXCLUDED.body,
      published_at = EXCLUDED.published_at,
      homepage_until = EXCLUDED.homepage_until,
      primary_url = EXCLUDED.primary_url,
      primary_source_id = EXCLUDED.primary_source_id,
      image_id = EXCLUDED.image_id,
      game_ids = EXCLUDED.game_ids,
      regions = EXCLUDED.regions,
      global_eligible = EXCLUDED.global_eligible,
      regional_eligible = EXCLUDED.regional_eligible,
      media_source_count = EXCLUDED.media_source_count,
      discussion_mentions = EXCLUDED.discussion_mentions,
      trend_score = EXCLUDED.trend_score,
      global_score = EXCLUDED.global_score,
      regional_score = EXCLUDED.regional_score,
      confidence = EXCLUDED.confidence,
      current_revision_id = EXCLUDED.current_revision_id,
      updated_at = NOW()
  `, [
    event.id, event.status, event.type, event.importance, event.official,
    event.titleRu, event.titleEn, event.summaryRu, event.summaryEn,
    JSON.stringify(event.body), event.publishedAt, event.homepageUntil,
    event.primaryUrl, event.primarySourceId, event.media?.id || null,
    event.gameIds, event.regions, event.globalEligible, event.regionalEligible,
    event.mediaSourceCount, event.discussionMentions, event.trendScore,
    event.globalScore, event.regionalScore, event.confidence, revisionId
  ]);

  await client.query('DELETE FROM news_event_sources WHERE event_id = $1', [event.id]);
  for (const source of event.sources) {
    await client.query(`
      INSERT INTO news_event_sources(
        event_id, source_id, source_url, published_at, official, payload
      ) VALUES ($1, $2, $3, $4, $5, $6::JSONB)
    `, [
      event.id, source.id, source.canonicalUrl || event.primaryUrl,
      source.publishedAt, source.official, JSON.stringify(source.payload || {})
    ]);
  }
}

export async function importSnapshot({
  pool = getPool(),
  file,
  snapshotVersion,
  channel = 'news',
  manifestUrl = ''
}) {
  await runMigrations(pool);
  const payload = JSON.parse(await fs.readFile(file, 'utf8'));
  const snapshot = parseSnapshot(payload);
  const version = snapshotVersion || snapshot.generatedAt.replace(/[:.]/g, '-');

  const run = await pool.query(`
    INSERT INTO parser_runs(pipeline, snapshot_version, status)
    VALUES ('news-content-ledger-shadow-import', $1, 'running')
    RETURNING id
  `, [version]);
  const runId = run.rows[0].id;

  try {
    const summary = await withTransaction(pool, async client => {
      for (const event of snapshot.items) {
        for (const source of event.sources) await upsertSource(client, source);
        await upsertMedia(client, event.media);
        const revisionId = await ensureRevision(client, event, version);
        await upsertEvent(client, event, revisionId);
      }

      await client.query(`
        INSERT INTO publications(channel, snapshot_version, status, manifest_url, item_count, stats)
        VALUES ($1, $2, 'published', $3, $4, $5::JSONB)
        ON CONFLICT (channel, snapshot_version) DO UPDATE SET
          status = 'published',
          manifest_url = EXCLUDED.manifest_url,
          item_count = EXCLUDED.item_count,
          stats = EXCLUDED.stats,
          published_at = NOW()
      `, [channel, version, manifestUrl, snapshot.items.length, JSON.stringify({ shadow: true })]);

      return { version, itemCount: snapshot.items.length };
    });

    await pool.query(`
      UPDATE parser_runs
      SET status = 'success', finished_at = NOW(), item_count = $2,
          metrics = $3::JSONB
      WHERE id = $1
    `, [runId, summary.itemCount, JSON.stringify({ channel, file })]);
    return summary;
  } catch (error) {
    await pool.query(`
      UPDATE parser_runs
      SET status = 'failed', finished_at = NOW(), metrics = $2::JSONB
      WHERE id = $1
    `, [runId, JSON.stringify({ channel, file })]);
    await pool.query(`
      INSERT INTO parser_errors(parser_run_id, stage, code, message)
      VALUES ($1, 'shadow-import', $2, $3)
    `, [runId, error.code || '', String(error.message || error)]);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = argumentsFrom(process.argv.slice(2));
  try {
    const result = await importSnapshot(options);
    console.log(`Imported ${result.itemCount} news events into snapshot ${result.version}.`);
  } finally {
    await closePool();
  }
}
