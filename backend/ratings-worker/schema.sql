PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ratings (
  game_slug TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_slug, voter_hash)
);

CREATE INDEX IF NOT EXISTS ratings_game_slug_idx ON ratings(game_slug);

CREATE TABLE IF NOT EXISTS rating_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_slug TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS rating_events_game_slug_idx ON rating_events(game_slug);
CREATE INDEX IF NOT EXISTS rating_events_voter_hash_idx ON rating_events(voter_hash);
