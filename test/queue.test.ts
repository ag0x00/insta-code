/**
 * Tests for the SQLite-backed job queue.
 * Verifies atomic claim, backoff-preserving requeue, and orphan recovery.
 *
 * Each test uses its own isolated in-memory or temp DB to avoid cross-test
 * job ordering interference.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../src/db/db";
import type { Database } from "bun:sqlite";
import { runMigration } from "../src/db/migrate";
import {
  claimNext,
  enqueue,
  markDone,
  markFailed,
  recoverOrphaned,
  requeue,
} from "../src/queue/queue";

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "reel-atlas-queue-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Create a fresh isolated DB for each test to avoid ordering interference. */
async function makeDb(): Promise<{ db: Database; dbPath: string }> {
  const dbPath = join(tmpDir, `q-${crypto.randomUUID()}.db`);
  await runMigration(dbPath);
  const db = openDb(dbPath);
  return { db, dbPath };
}

function insertSubmission(d: Database, id: string): void {
  const now = Date.now();
  d.run(
    `INSERT INTO submissions (id, source_type, source_url, reel_shortcode, file_path, content_hash, status, created_at, updated_at)
     VALUES (?, 'url', 'https://www.instagram.com/reel/TEST/', ?, NULL, NULL, 'queued', ?, ?)`,
    [id, "TEST_" + id.substring(0, 8), now, now],
  );
}

describe("queue", () => {
  test("enqueue creates a pending job for a submission", async () => {
    const { db } = await makeDb();
    const subId = crypto.randomUUID();
    insertSubmission(db, subId);
    await enqueue(subId, db);

    const job = db.prepare("SELECT * FROM jobs WHERE submission_id = ?").get(subId) as {
      status: string;
      attempts: number;
      run_at: number;
    } | null;
    expect(job).not.toBeNull();
    expect(job?.status).toBe("pending");
    expect(job?.attempts).toBe(0);
    db.close();
  });

  test("claimNext flips status to processing and increments attempts", async () => {
    const { db } = await makeDb();
    const subId = crypto.randomUUID();
    insertSubmission(db, subId);
    await enqueue(subId, db);

    const claimed = claimNext(db);
    expect(claimed).not.toBeNull();
    expect(claimed?.submission_id).toBe(subId);
    expect(claimed?.attempts).toBe(1);

    const job = db
      .prepare("SELECT status, locked_until FROM jobs WHERE submission_id = ?")
      .get(subId) as { status: string; locked_until: number } | null;
    expect(job?.status).toBe("processing");
    expect(job?.locked_until).toBeGreaterThan(Date.now());
    db.close();
  });

  test("two claimNext calls return DIFFERENT jobs (atomic claim, no double-claim)", async () => {
    const { db } = await makeDb();
    const subId1 = crypto.randomUUID();
    const subId2 = crypto.randomUUID();
    insertSubmission(db, subId1);
    insertSubmission(db, subId2);
    await enqueue(subId1, db);
    await enqueue(subId2, db);

    const job1 = claimNext(db);
    const job2 = claimNext(db);

    expect(job1).not.toBeNull();
    expect(job2).not.toBeNull();
    expect(job1?.id).not.toBe(job2?.id);
    db.close();
  });

  test("requeue sets status=pending with future run_at and preserves attempts", async () => {
    const { db } = await makeDb();
    const subId = crypto.randomUUID();
    insertSubmission(db, subId);
    await enqueue(subId, db);

    const claimed = claimNext(db);
    expect(claimed).not.toBeNull();
    const jobId = claimed!.id;
    const beforeRequeue = Date.now();

    requeue(jobId, "transient error", 30_000, db);

    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as {
      status: string;
      attempts: number;
      run_at: number;
      error: string;
    } | null;
    expect(job?.status).toBe("pending");
    // attempts must be preserved (not reset)
    expect(job?.attempts).toBe(1);
    // run_at must be in the future
    expect(job?.run_at).toBeGreaterThan(beforeRequeue);
    expect(job?.error).toBe("transient error");
    db.close();
  });

  test("markDone sets status=done", async () => {
    const { db } = await makeDb();
    const subId = crypto.randomUUID();
    insertSubmission(db, subId);
    await enqueue(subId, db);

    const claimed = claimNext(db);
    expect(claimed).not.toBeNull();
    markDone(claimed!.id, db);

    const job = db.prepare("SELECT status FROM jobs WHERE id = ?").get(claimed!.id) as {
      status: string;
    } | null;
    expect(job?.status).toBe("done");
    db.close();
  });

  test("markFailed sets status=failed and surfaces error on submission", async () => {
    const { db } = await makeDb();
    const subId = crypto.randomUUID();
    insertSubmission(db, subId);
    await enqueue(subId, db);

    const claimed = claimNext(db);
    expect(claimed).not.toBeNull();
    markFailed(claimed!.id, "unrecoverable error", db);

    const job = db.prepare("SELECT status, error FROM jobs WHERE id = ?").get(claimed!.id) as {
      status: string;
      error: string;
    } | null;
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("unrecoverable error");

    const sub = db.prepare("SELECT status, error FROM submissions WHERE id = ?").get(subId) as {
      status: string;
      error: string;
    } | null;
    expect(sub?.status).toBe("failed");
    expect(sub?.error).toBe("unrecoverable error");
    db.close();
  });

  test("recoverOrphaned resets stale processing jobs to pending", async () => {
    const { db } = await makeDb();
    const subId = crypto.randomUUID();
    insertSubmission(db, subId);
    await enqueue(subId, db);

    // Manually set to processing with an expired lock (in the past)
    const expiredLock = Date.now() - 60_000; // 60 seconds ago
    const now = Date.now();
    db.run(
      `UPDATE jobs SET status = 'processing', locked_until = ?, updated_at = ?
       WHERE submission_id = ?`,
      [expiredLock, now, subId],
    );

    const before = db
      .prepare("SELECT status FROM jobs WHERE submission_id = ?")
      .get(subId) as { status: string } | null;
    expect(before?.status).toBe("processing");

    recoverOrphaned(db);

    const after = db
      .prepare("SELECT status, locked_until FROM jobs WHERE submission_id = ?")
      .get(subId) as { status: string; locked_until: number | null } | null;
    expect(after?.status).toBe("pending");
    expect(after?.locked_until).toBeNull();
    db.close();
  });

  test("claimNext returns null when no pending jobs exist", async () => {
    const { db } = await makeDb();
    // Empty DB — no submissions, no jobs
    const result = claimNext(db);
    expect(result).toBeNull();
    db.close();
  });
});
