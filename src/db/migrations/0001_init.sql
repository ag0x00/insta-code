-- Phase 1: capture & ingest spine
-- submissions: raw intake from Telegram + processing status
create table if not exists submissions (
  id                  text primary key,
  telegram_chat_id    integer not null,
  telegram_message_id integer not null,
  source_url          text,
  reel_shortcode      text,
  uploaded_file_key   text,
  content_hash        text,
  status              text not null default 'queued',
  error               text,
  created_at          text not null default (datetime('now')),
  updated_at          text not null default (datetime('now'))
);

-- Dedupe by reel shortcode (only enforced when a shortcode is present).
create unique index if not exists idx_submissions_shortcode
  on submissions (reel_shortcode) where reel_shortcode is not null;

-- Dedupe file-only submissions by content hash.
create index if not exists idx_submissions_content_hash
  on submissions (content_hash) where content_hash is not null;

-- findings: the durable, media-complete record produced by ingestion
create table if not exists findings (
  id              text primary key,
  submission_id   text not null references submissions (id),
  reel_shortcode  text,
  author_handle   text,
  caption         text,
  posted_at       text,
  duration_sec    real,
  media_key       text,
  audio_key       text,
  keyframe_keys   text not null default '[]', -- JSON array of R2 keys
  status          text not null default 'done',
  created_at      text not null default (datetime('now')),
  updated_at      text not null default (datetime('now'))
);

create unique index if not exists idx_findings_submission
  on findings (submission_id);

create index if not exists idx_findings_shortcode
  on findings (reel_shortcode);
