CREATE TABLE IF NOT EXISTS content_revisions (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  snapshot_version TEXT NOT NULL,
  content JSONB NOT NULL,
  content_hash CHAR(64) NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'news-pipeline',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_id, revision_no),
  UNIQUE (entity_type, entity_id, content_hash)
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'media',
  canonical_url TEXT NOT NULL DEFAULT '',
  official BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  public_url TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL DEFAULT '',
  sha256 CHAR(64),
  mime_type TEXT NOT NULL DEFAULT '',
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'missing', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS news_events (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft', 'quarantine', 'published', 'archived')),
  type TEXT NOT NULL DEFAULT 'ranked',
  importance TEXT NOT NULL DEFAULT 'normal',
  official BOOLEAN NOT NULL DEFAULT FALSE,
  title_ru TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  summary_ru TEXT NOT NULL DEFAULT '',
  summary_en TEXT NOT NULL DEFAULT '',
  body JSONB NOT NULL DEFAULT '[]'::JSONB,
  published_at TIMESTAMPTZ NOT NULL,
  homepage_until TIMESTAMPTZ,
  primary_url TEXT NOT NULL,
  primary_source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  image_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  game_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  regions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  global_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  regional_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  media_source_count INTEGER NOT NULL DEFAULT 0 CHECK (media_source_count >= 0),
  discussion_mentions INTEGER NOT NULL DEFAULT 0 CHECK (discussion_mentions >= 0),
  trend_score NUMERIC NOT NULL DEFAULT 0,
  global_score NUMERIC NOT NULL DEFAULT 0,
  regional_score NUMERIC NOT NULL DEFAULT 0,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.500 CHECK (confidence >= 0 AND confidence <= 1),
  current_revision_id BIGINT REFERENCES content_revisions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS news_events_primary_url_unique
  ON news_events (primary_url);
CREATE INDEX IF NOT EXISTS news_events_publication_order
  ON news_events (status, published_at DESC);
CREATE INDEX IF NOT EXISTS news_events_game_ids_gin
  ON news_events USING GIN (game_ids);

CREATE TABLE IF NOT EXISTS news_event_sources (
  event_id TEXT NOT NULL REFERENCES news_events(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  source_url TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  official BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  PRIMARY KEY (event_id, source_id, source_url)
);

CREATE TABLE IF NOT EXISTS publications (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  snapshot_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'published', 'rolled_back', 'failed')),
  manifest_url TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  stats JSONB NOT NULL DEFAULT '{}'::JSONB,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rolled_back_from_id BIGINT REFERENCES publications(id) ON DELETE SET NULL,
  UNIQUE (channel, snapshot_version)
);

CREATE INDEX IF NOT EXISTS publications_current_channel
  ON publications (channel, published_at DESC)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS parser_runs (
  id BIGSERIAL PRIMARY KEY,
  pipeline TEXT NOT NULL,
  snapshot_version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'degraded', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  metrics JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS parser_errors (
  id BIGSERIAL PRIMARY KEY,
  parser_run_id BIGINT NOT NULL REFERENCES parser_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  source_id TEXT,
  code TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  config JSONB NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW published_news AS
SELECT
  event.*,
  media.public_url AS image_url,
  source.name AS primary_source_name
FROM news_events event
LEFT JOIN media_assets media ON media.id = event.image_id
LEFT JOIN sources source ON source.id = event.primary_source_id
WHERE event.status = 'published';
