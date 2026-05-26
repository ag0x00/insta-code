/**
 * Job processor: download -> media -> metadata -> findings upsert.
 * Implemented in Task 2. Stub satisfies type checker for Task 1 RED state.
 */

import type { Database } from "bun:sqlite";

/**
 * Process a submission: download (or use existing file), extract audio +
 * keyframes, parse metadata, and upsert a findings row.
 *
 * When INGEST_FAKE=1, writes placeholder media files (no yt-dlp/ffmpeg needed).
 */
export async function processJob(_submissionId: string, _db?: Database): Promise<void> {
  throw new Error("process.ts: processJob not implemented yet (Task 2)");
}
