// Plain data types shared between the Worker (workerd) and the Container (Bun).
// MUST NOT reference workers-types or bun-types globals so both can import it.

export type SubmissionStatus = "queued" | "processing" | "done" | "failed";

export interface Submission {
  id: string;
  telegram_chat_id: number;
  telegram_message_id: number;
  source_url: string | null;
  reel_shortcode: string | null;
  uploaded_file_key: string | null;
  content_hash: string | null;
  status: SubmissionStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at: string;
}

/** Metadata parsed from yt-dlp's info JSON (all fields best-effort). */
export interface ReelMetadata {
  author_handle: string | null;
  caption: string | null;
  posted_at: string | null;
  duration_sec: number | null;
}

/** The contract carried over the ingest Queue (webhook producer -> consumer). */
export interface JobMessage {
  submissionId: string;
  sourceUrl?: string;
  uploadedFileKey?: string;
  telegramChatId: number;
}

/** The contract carried over the enrich Queue (ingest consumer -> enrich consumer). */
export interface EnrichJob {
  findingId: string;
  telegramChatId: number;
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

/** Result returned by the ingest Container's POST /ingest. */
export interface IngestResult {
  mediaKey: string;
  audioKey: string;
  keyframeKeys: string[];
  metadata: ReelMetadata;
}
