/**
 * SQLite-backed job queue.
 * Implemented in Task 2. Stub satisfies type checker for Task 1 RED state.
 */

import type { Database } from "bun:sqlite";

/** Enqueue a new pending job for the given submission. */
export async function enqueue(_submissionId: string, _db?: Database): Promise<void> {
  throw new Error("queue.ts: enqueue not implemented yet (Task 2)");
}

/** Atomically claim the next pending job. Returns null if none available. */
export function claimNext(_db?: Database): { id: string; submission_id: string; attempts: number } | null {
  throw new Error("queue.ts: claimNext not implemented yet (Task 2)");
}

/** Mark a job as done. */
export function markDone(_id: string, _db?: Database): void {
  throw new Error("queue.ts: markDone not implemented yet (Task 2)");
}

/** Mark a job as permanently failed with an error message. */
export function markFailed(_id: string, _error: string, _db?: Database): void {
  throw new Error("queue.ts: markFailed not implemented yet (Task 2)");
}

/** Requeue a job with backoff (does NOT reset attempts). */
export function requeue(_id: string, _error: string, _backoffMs: number, _db?: Database): void {
  throw new Error("queue.ts: requeue not implemented yet (Task 2)");
}

/** Reset orphaned processing jobs (locked_until expired) back to pending. */
export function recoverOrphaned(_db?: Database): void {
  throw new Error("queue.ts: recoverOrphaned not implemented yet (Task 2)");
}
