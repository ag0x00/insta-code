-- Canonical current schema for Reel Atlas (mirrors applied migrations).
-- Apply migrations with: bun run db:migrate:local  (or db:migrate for remote)

create table submissions (
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
create unique index idx_submissions_shortcode
  on submissions (reel_shortcode) where reel_shortcode is not null;
create index idx_submissions_content_hash
  on submissions (content_hash) where content_hash is not null;

create table findings (
  id              text primary key,
  submission_id   text not null references submissions (id),
  reel_shortcode  text,
  author_handle   text,
  caption         text,
  posted_at       text,
  duration_sec    real,
  media_key       text,
  audio_key       text,
  keyframe_keys   text not null default '[]',
  status          text not null default 'done',
  created_at      text not null default (datetime('now')),
  updated_at      text not null default (datetime('now'))
);
create unique index idx_findings_submission on findings (submission_id);
create index idx_findings_shortcode on findings (reel_shortcode);
