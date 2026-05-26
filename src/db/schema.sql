-- Reel Atlas SQLite schema (local-first, bun:sqlite).
-- All timestamps are Unix epoch milliseconds (INTEGER).
-- Run via: bun run migrate

PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

-- ── submissions ──────────────────────────────────────────────────────────────
-- One row per captured reel: raw intake record + final status.
CREATE TABLE IF NOT EXISTS submissions (
  id             TEXT    PRIMARY KEY,
  source_type    TEXT    NOT NULL,          -- 'url' | 'file' | 'sync'
  source_url     TEXT,                      -- original Instagram URL (nullable for file drops)
  reel_shortcode TEXT,                      -- extracted IG shortcode (nullable for file-only)
  file_path      TEXT,                      -- local file path for dropped files
  content_hash   TEXT,                      -- SHA-256 of file content (dedup for file drops)
  status         TEXT    NOT NULL DEFAULT 'queued',  -- queued | processing | done | failed
  error          TEXT,                      -- last error message if failed
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- Dedup: same shortcode → skip re-enqueue (CAP-04, D-07)
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_shortcode
  ON submissions (reel_shortcode)
  WHERE reel_shortcode IS NOT NULL;

-- Dedup: same file content hash → skip re-enqueue (CAP-04, D-07)
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_content_hash
  ON submissions (content_hash)
  WHERE content_hash IS NOT NULL;

-- ── jobs ─────────────────────────────────────────────────────────────────────
-- Durable job queue (OPS-02, D-15).
-- Atomic claim: UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING
CREATE TABLE IF NOT EXISTS jobs (
  id             TEXT    PRIMARY KEY,       -- crypto.randomUUID()
  submission_id  TEXT    NOT NULL REFERENCES submissions(id),
  status         TEXT    NOT NULL DEFAULT 'pending',  -- pending | processing | done | failed
  attempts       INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 3,
  locked_until   INTEGER,                   -- epoch ms; NULL when not locked
  run_at         INTEGER NOT NULL,          -- epoch ms; supports deferred/retry scheduling
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  error          TEXT                       -- last error message
);

-- Partial index for efficient claimable-job queries
CREATE INDEX IF NOT EXISTS idx_jobs_claimable
  ON jobs (status, run_at, locked_until)
  WHERE status IN ('pending', 'processing');

-- ── findings ─────────────────────────────────────────────────────────────────
-- Structured output record for each processed reel (KB-01, D-13).
CREATE TABLE IF NOT EXISTS findings (
  id                   TEXT    PRIMARY KEY,
  submission_id        TEXT    NOT NULL REFERENCES submissions(id),
  reel_shortcode       TEXT,
  author_handle        TEXT,
  caption              TEXT,
  posted_at            TEXT,               -- YYYYMMDD from yt-dlp upload_date
  duration_sec         REAL,
  media_key            TEXT,               -- relative path to video file under MEDIA_DIR
  audio_key            TEXT,               -- relative path to .m4a audio file
  keyframe_keys        TEXT    NOT NULL DEFAULT '[]',  -- JSON array of relative paths
  status               TEXT    NOT NULL DEFAULT 'done',
  -- Phase 2 enrichment columns (nullable until enriched)
  transcript           TEXT,
  transcript_language  TEXT,
  transcript_segments  TEXT,               -- JSON array of {start,end,text}
  visual_summary       TEXT,
  onscreen_text        TEXT,
  enrich_status        TEXT    NOT NULL DEFAULT 'pending',
  enriched_at          INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_submission
  ON findings (submission_id);

CREATE INDEX IF NOT EXISTS idx_findings_shortcode
  ON findings (reel_shortcode);
