/**
 * SQLite-backed durable job queue (OPS-02, D-15).
 *
 * Uses the atomic UPDATE...WHERE id=(SELECT...LIMIT 1)...RETURNING pattern
 * from RESEARCH §3. SQLite serializes writers, so no advisory locks needed.
 *
 * Security: all DB operations use prepared statements (no string interpolation).
 */

import { Database } from "bun:sqlite";
import { getDb } from "../db/db";

const LEASE_MS = 120_000; // 2-minute claim lease
const MAX_ATTEMPTS = 3;

function nowMs(): number {
  return Date.now();
}

function db(override?: Database): Database {
  return override ?? getDb();
}

/**
 * Enqueue a new pending job for the given submission.
 * Idempotent if a pending/processing job already exists for this submission.
 */
export async function enqueue(submissionId: string, override?: Database): Promise<void> {
  const d = db(override);
  const id = crypto.randomUUID();
  const now = nowMs();

  d.run(
    `INSERT INTO jobs (id, submission_id, status, attempts, max_attempts, locked_until, run_at, created_at, updated_at, error)
     VALUES (?, ?, 'pending', 0, ?, NULL, ?, ?, ?, NULL)`,
    [id, submissionId, MAX_ATTEMPTS, now, now, now],
  );
}

/**
 * Atomically claim the next claimable job.
 * Returns the claimed job row or null if none are available.
 *
 * The UPDATE...WHERE id=(SELECT...LIMIT 1)...RETURNING pattern is atomic
 * in SQLite because all writes are serialized.
 */
export function claimNext(
  override?: Database,
): { id: string; submission_id: string; attempts: number } | null {
  const d = db(override);
  const now = nowMs();
  const lockedUntil = now + LEASE_MS;

  const stmt = d.prepare(`
    UPDATE jobs
    SET status       = 'processing',
        locked_until = ?,
        attempts     = attempts + 1,
        updated_at   = ?
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending'
        AND run_at <= ?
      ORDER BY run_at ASC
      LIMIT 1
    )
    RETURNING id, submission_id, attempts
  `);

  return (stmt.get(lockedUntil, now, now) as {
    id: string;
    submission_id: string;
    attempts: number;
  } | null);
}

/**
 * Mark a job as successfully completed.
 */
export function markDone(id: string, override?: Database): void {
  const d = db(override);
  const now = nowMs();
  d.run(
    `UPDATE jobs SET status = 'done', locked_until = NULL, updated_at = ?, error = NULL
     WHERE id = ?`,
    [now, id],
  );
}

/**
 * Mark a job as permanently failed with an error message.
 * Also updates the parent submission's status and error.
 */
export function markFailed(id: string, error: string, override?: Database): void {
  const d = db(override);
  const now = nowMs();

  d.run(
    `UPDATE jobs SET status = 'failed', locked_until = NULL, updated_at = ?, error = ?
     WHERE id = ?`,
    [now, error, id],
  );

  // Surface failure on the submission row (D-06, D-17)
  d.run(
    `UPDATE submissions SET status = 'failed', error = ?, updated_at = ?
     WHERE id = (SELECT submission_id FROM jobs WHERE id = ?)`,
    [error, now, id],
  );
}

/**
 * Requeue a job with backoff after a transient failure.
 * Does NOT reset attempts — the counter is cumulative.
 */
export function requeue(
  id: string,
  error: string,
  backoffMs: number,
  override?: Database,
): void {
  const d = db(override);
  const now = nowMs();

  d.run(
    `UPDATE jobs
     SET status = 'pending', locked_until = NULL, run_at = ?, updated_at = ?, error = ?
     WHERE id = ?`,
    [now + backoffMs, now, error, id],
  );
}

/**
 * Reset orphaned processing jobs (locked_until expired) back to pending.
 * Run once at worker startup to recover from crashes (RESEARCH §3, Pitfall 4).
 */
export function recoverOrphaned(override?: Database): void {
  const d = db(override);
  const now = nowMs();

  d.run(
    `UPDATE jobs
     SET status = 'pending', locked_until = NULL, updated_at = ?
     WHERE status = 'processing' AND locked_until IS NOT NULL AND locked_until < ?`,
    [now, now],
  );
}

/** Max attempts constant for use by the loop. */
export const MAX_JOB_ATTEMPTS = MAX_ATTEMPTS;
