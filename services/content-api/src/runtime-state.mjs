export async function latestShadowSync(pool, channel = 'news') {
  const result = await pool.query(`
    SELECT id, channel, source_digest, ledger_digest, source_item_count,
      ledger_item_count, status, drift, started_at, finished_at
    FROM shadow_sync_runs
    WHERE channel = $1
    ORDER BY id DESC
    LIMIT 1
  `, [channel]);
  return result.rows[0] || null;
}

function asIso(value) {
  return value?.toISOString?.() || value || null;
}

export function serializeShadowSync(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    channel: row.channel,
    sourceDigest: String(row.source_digest),
    ledgerDigest: String(row.ledger_digest),
    sourceItemCount: Number(row.source_item_count),
    ledgerItemCount: Number(row.ledger_item_count),
    status: row.status,
    drift: row.drift || {},
    startedAt: asIso(row.started_at),
    finishedAt: asIso(row.finished_at)
  };
}

function syncIsExact(row) {
  return Boolean(
    row
    && row.status === 'exact'
    && row.finished_at
    && row.source_digest === row.ledger_digest
    && Number(row.source_item_count) === Number(row.ledger_item_count)
  );
}

export async function recordRuntimeState(pool, config, { channel = 'news' } = {}) {
  const latest = await latestShadowSync(pool, channel);

  if (config.readSource === 'content_api') {
    if (!syncIsExact(latest)) {
      throw new Error('Content API cutover blocked: latest shadow synchronization is not exact.');
    }
    const ageMs = Date.now() - new Date(latest.finished_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > config.maxSyncAgeMs) {
      throw new Error('Content API cutover blocked: latest exact shadow synchronization is stale.');
    }
  }

  await pool.query(`
    INSERT INTO content_runtime_state(
      singleton, runtime_mode, read_source, shadow_write_enabled,
      last_verified_sync_id, updated_by, updated_at
    ) VALUES (TRUE, $1, $2, $3, $4, $5, NOW())
    ON CONFLICT (singleton) DO UPDATE SET
      runtime_mode = EXCLUDED.runtime_mode,
      read_source = EXCLUDED.read_source,
      shadow_write_enabled = EXCLUDED.shadow_write_enabled,
      last_verified_sync_id = EXCLUDED.last_verified_sync_id,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
  `, [
    config.runtimeMode,
    config.readSource,
    config.shadowWriteEnabled,
    syncIsExact(latest) ? latest.id : null,
    `content-api:${config.serviceVersion}`
  ]);

  return serializeShadowSync(latest);
}
