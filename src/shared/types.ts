/**
 * Local runtime types for the Reel Atlas Bun app.
 * No Cloudflare bindings, no Telegram types.
 */

export type { Config } from "./config";
export type {
  EnrichStatus,
  Finding,
  IngestResult,
  ReelMetadata,
  SourceType,
  Submission,
  SubmissionStatus,
  TranscriptResult,
  TranscriptSegment,
  VisionResult,
} from "./dto";

/** A row from the jobs table. */
export interface Job {
  id: string;
  submission_id: string;
  status: "pending" | "processing" | "done" | "failed";
  attempts: number;
  max_attempts: number;
  locked_until: number | null;
  run_at: number;
  created_at: number;
  updated_at: number;
  error: string | null;
}
