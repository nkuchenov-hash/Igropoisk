CREATE TABLE IF NOT EXISTS shadow_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'news',
  source_generated_at TIMESTAMPTZ,
  source_digest TEXT NOT NULL CHECK (length(source_digest) = 64),
  ledger_digest TEXT NOT NULL CHECK (length(ledger_digest) = 64),
  source_item_count INTEGER NOT NULL CHECK (source_item_count >= 0),
  ledger_item_count INTEGER NOT NULL CHECK (ledger_item_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('exact', 'drift', 'failed')),
  drift JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS shadow_sync_runs_channel_time
  ON shadow_sync_runs(channel, started_at DESC);

CREATE TABLE IF NOT EXISTS content_runtime_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  runtime_mode TEXT NOT NULL DEFAULT 'shadow' CHECK (runtime_mode IN ('shadow', 'canary', 'live')),
  read_source TEXT NOT NULL DEFAULT 'object_storage' CHECK (read_source IN ('object_storage', 'content_api')),
  shadow_write_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_verified_sync_id BIGINT REFERENCES shadow_sync_runs(id) ON DELETE SET NULL,
  updated_by TEXT NOT NULL DEFAULT 'migration',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (runtime_mode <> 'shadow' OR read_source = 'object_storage')
);

INSERT INTO content_runtime_state(singleton, runtime_mode, read_source, shadow_write_enabled)
VALUES (TRUE, 'shadow', 'object_storage', FALSE)
ON CONFLICT (singleton) DO NOTHING;
