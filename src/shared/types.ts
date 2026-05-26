// Worker-side types: re-exports the plain DTOs and adds the Cloudflare bindings
// (which reference workers-types globals).

export type {
  EnrichJob,
  EnrichStatus,
  Finding,
  IngestResult,
  JobMessage,
  ReelMetadata,
  Submission,
  SubmissionStatus,
  TranscriptResult,
  TranscriptSegment,
  VisionResult,
} from "./dto";

import type { Container } from "@cloudflare/containers";
import type { EnrichJob, JobMessage } from "./dto";

/** Cloudflare Worker bindings (declared in wrangler.toml) + secrets. */
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  INGEST_QUEUE: Queue<JobMessage>;
  ENRICH_QUEUE: Queue<EnrichJob>;
  INGEST_CONTAINER: DurableObjectNamespace<Container<Env>>;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  // R2 S3 credentials forwarded to the ingest Container (see README).
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  // Phase 2 enrichment APIs.
  GROQ_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  CLAUDE_MODEL: string;
}
