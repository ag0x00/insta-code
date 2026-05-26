import type {
  EnrichStatus,
  Finding,
  IngestResult,
  Submission,
  SubmissionStatus,
  TranscriptResult,
  VisionResult,
} from "../shared/types";

export interface NewSubmission {
  id: string;
  telegramChatId: number;
  telegramMessageId: number;
  sourceUrl?: string | null;
  reelShortcode?: string | null;
  uploadedFileKey?: string | null;
  contentHash?: string | null;
}

export async function insertSubmission(db: D1Database, s: NewSubmission): Promise<string> {
  await db
    .prepare(
      `insert into submissions
        (id, telegram_chat_id, telegram_message_id, source_url, reel_shortcode,
         uploaded_file_key, content_hash, status)
       values (?, ?, ?, ?, ?, ?, ?, 'queued')`,
    )
    .bind(
      s.id,
      s.telegramChatId,
      s.telegramMessageId,
      s.sourceUrl ?? null,
      s.reelShortcode ?? null,
      s.uploadedFileKey ?? null,
      s.contentHash ?? null,
    )
    .run();
  return s.id;
}

export async function findSubmissionByShortcode(
  db: D1Database,
  shortcode: string,
): Promise<Submission | null> {
  return db
    .prepare(`select * from submissions where reel_shortcode = ? limit 1`)
    .bind(shortcode)
    .first<Submission>();
}

export async function findSubmissionByHash(
  db: D1Database,
  hash: string,
): Promise<Submission | null> {
  return db
    .prepare(`select * from submissions where content_hash = ? limit 1`)
    .bind(hash)
    .first<Submission>();
}

export async function getSubmission(
  db: D1Database,
  id: string,
): Promise<Submission | null> {
  return db.prepare(`select * from submissions where id = ? limit 1`).bind(id).first<Submission>();
}

export async function setSubmissionStatus(
  db: D1Database,
  id: string,
  status: SubmissionStatus,
  error: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `update submissions set status = ?, error = ?, updated_at = datetime('now') where id = ?`,
    )
    .bind(status, error, id)
    .run();
}

/**
 * Idempotent upsert of the Finding for a submission (safe on Queue retry).
 * Keyed by submission_id (unique index).
 */
export async function upsertFinding(
  db: D1Database,
  args: {
    id: string;
    submissionId: string;
    reelShortcode: string | null;
    result: IngestResult;
  },
): Promise<void> {
  const { metadata } = args.result;
  await db
    .prepare(
      `insert into findings
        (id, submission_id, reel_shortcode, author_handle, caption, posted_at,
         duration_sec, media_key, audio_key, keyframe_keys, status)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done')
       on conflict(submission_id) do update set
         reel_shortcode = excluded.reel_shortcode,
         author_handle  = excluded.author_handle,
         caption        = excluded.caption,
         posted_at      = excluded.posted_at,
         duration_sec   = excluded.duration_sec,
         media_key      = excluded.media_key,
         audio_key      = excluded.audio_key,
         keyframe_keys  = excluded.keyframe_keys,
         status         = 'done',
         updated_at     = datetime('now')`,
    )
    .bind(
      args.id,
      args.submissionId,
      args.reelShortcode,
      metadata.author_handle,
      metadata.caption,
      metadata.posted_at,
      metadata.duration_sec,
      args.result.mediaKey,
      args.result.audioKey,
      JSON.stringify(args.result.keyframeKeys),
      // keyframe_keys then status handled by default in values list
    )
    .run();
}

/** Hydrates a Finding row into the typed shape (parses JSON columns). */
export function rowToFinding(row: Record<string, unknown>): Finding {
  return {
    ...(row as unknown as Finding),
    keyframe_keys: JSON.parse((row.keyframe_keys as string) ?? "[]"),
    transcript_segments: JSON.parse((row.transcript_segments as string) ?? "[]"),
  };
}

export async function getFindingIdBySubmission(
  db: D1Database,
  submissionId: string,
): Promise<string | null> {
  const row = await db
    .prepare(`select id from findings where submission_id = ? limit 1`)
    .bind(submissionId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function getFinding(db: D1Database, id: string): Promise<Finding | null> {
  const row = await db
    .prepare(`select * from findings where id = ? limit 1`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? rowToFinding(row) : null;
}

export async function setEnrichStatus(
  db: D1Database,
  findingId: string,
  status: EnrichStatus,
): Promise<void> {
  await db
    .prepare(`update findings set enrich_status = ?, updated_at = datetime('now') where id = ?`)
    .bind(status, findingId)
    .run();
}

export async function updateFindingTranscript(
  db: D1Database,
  findingId: string,
  t: TranscriptResult,
): Promise<void> {
  await db
    .prepare(
      `update findings set transcript = ?, transcript_language = ?, transcript_segments = ?,
       updated_at = datetime('now') where id = ?`,
    )
    .bind(t.text, t.language, JSON.stringify(t.segments), findingId)
    .run();
}

export async function updateFindingVision(
  db: D1Database,
  findingId: string,
  v: VisionResult,
): Promise<void> {
  await db
    .prepare(
      `update findings set visual_summary = ?, onscreen_text = ?,
       updated_at = datetime('now') where id = ?`,
    )
    .bind(v.visual_summary, v.onscreen_text, findingId)
    .run();
}

/** Marks enrichment complete (status done + timestamp). */
export async function markEnriched(db: D1Database, findingId: string): Promise<void> {
  await db
    .prepare(
      `update findings set enrich_status = 'done', enriched_at = datetime('now'),
       updated_at = datetime('now') where id = ?`,
    )
    .bind(findingId)
    .run();
}
