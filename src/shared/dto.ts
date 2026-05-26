// Plain data types for Reel Atlas (local-first Bun app).
// No Cloudflare or Telegram dependencies.

export type SubmissionStatus = "queued" | "processing" | "done" | "failed";

export type SourceType = "url" | "file" | "sync";

export interface Submission {
  id: string;
  source_type: SourceType;
  source_url: string | null;
  reel_shortcode: string | null;
  file_path: string | null;
  content_hash: string | null;
  status: SubmissionStatus;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export type EnrichStatus = "pending" | "processing" | "done" | "failed";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Finding {
  id: string;
  submission_id: string;
  reel_shortcode: string | null;
  author_handle: string | null;
  caption: string | null;
  posted_at: string | null;
  duration_sec: number | null;
  media_key: string | null;
  audio_key: string | null;
  keyframe_keys: string[];
  status: SubmissionStatus;
  // Phase 2 enrichment
  transcript: string | null;
  transcript_language: string | null;
  transcript_segments: TranscriptSegment[];
  visual_summary: string | null;
  onscreen_text: string | null;
  enrich_status: EnrichStatus;
  enriched_at: string | null;
  created_at: number;
  updated_at: number;
}

/** Metadata parsed from yt-dlp's info JSON (all fields best-effort). */
export interface ReelMetadata {
  author_handle: string | null;
  caption: string | null;
  posted_at: string | null;
  duration_sec: number | null;
}

/** Result of transcription (Groq Whisper verbose_json). */
export interface TranscriptResult {
  text: string;
  language: string | null;
  segments: TranscriptSegment[];
}

/** Result of vision analysis (Claude over keyframes). */
export interface VisionResult {
  visual_summary: string;
  onscreen_text: string;
}

/** Result returned after the ingest pipeline completes. */
export interface IngestResult {
  mediaKey: string;
  audioKey: string;
  keyframeKeys: string[];
  metadata: ReelMetadata;
}
