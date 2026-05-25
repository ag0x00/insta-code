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

/** Result returned by the ingest Container's POST /ingest. */
export interface IngestResult {
  mediaKey: string;
  audioKey: string;
  keyframeKeys: string[];
  metadata: ReelMetadata;
}
