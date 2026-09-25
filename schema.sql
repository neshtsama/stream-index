-- StreamIndex API schema.
-- Run once with: npm run db:setup   (or paste this into any Postgres client)
--
-- Deliberately doesn't store anything about a film or show beyond its TMDB id
-- and the bits needed to redraw a card without an extra lookup (title,
-- poster, year, rating). TMDB stays the source of truth for everything else,
-- so this stays small and never goes stale.

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per movie, or per episode of a show.
-- progress_key mirrors what the frontend already uses locally:
--   "550"          — a movie (TMDB id 550)
--   "1399-s1-e3"   — season 1, episode 3 of TMDB show 1399
CREATE TABLE IF NOT EXISTS watch_progress (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    progress_key      TEXT NOT NULL,
    tmdb_id           INTEGER NOT NULL,
    media_type        TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    season            INTEGER,
    episode           INTEGER,
    position_seconds  NUMERIC NOT NULL,
    duration_seconds  NUMERIC NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, progress_key)
);

CREATE INDEX IF NOT EXISTS idx_watch_progress_user ON watch_progress(user_id);

-- Bookmarks ("Save to list") and Watch Later, in one table distinguished by list_name.
CREATE TABLE IF NOT EXISTS list_items (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_name   TEXT NOT NULL CHECK (list_name IN ('bookmarks', 'watchlater')),
    tmdb_id     INTEGER NOT NULL,
    media_type  TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    title       TEXT NOT NULL,
    poster      TEXT,
    year        TEXT,
    rating      TEXT,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, list_name, tmdb_id)
);

CREATE INDEX IF NOT EXISTS idx_list_items_user ON list_items(user_id, list_name);
