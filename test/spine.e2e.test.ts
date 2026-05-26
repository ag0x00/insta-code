/**
 * End-to-end spine test (Task 1: RED state).
 *
 * Drives the ingest spine with yt-dlp/ffmpeg STUBBED so it runs in
 * CI/sandbox without a network or system binaries.
 *
 * RED at end of Task 1 (worker not built yet).
 * GREEN after Task 2 (processJob implemented with INGEST_FAKE=1 seam).
 *
 * The INGEST_FAKE=1 env flag causes process.ts to write placeholder
 * media files instead of spawning yt-dlp/ffmpeg.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { openDb, closeDb } from "../src/db/db";
import { runMigration } from "../src/db/migrate";

// We'll import these after Task 2 makes them available.
// For now this import will fail (RED state).
import { enqueue } from "../src/queue/queue";
import { processJob } from "../src/worker/process";

const TEST_URL_BASE = "https://www.instagram.com/reel/";

let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  // Create isolated temp directory for this test run
  tmpDir = await mkdtemp(join(tmpdir(), "reel-atlas-e2e-"));
  dbPath = join(tmpDir, "test.db");

  // Override config for test isolation
  process.env["DB_PATH"] = dbPath;
  process.env["MEDIA_DIR"] = join(tmpDir, "media");
  process.env["INGEST_FAKE"] = "1";

  // Run migration against the test DB
  await runMigration(dbPath);
});

afterAll(async () => {
  closeDb();
  await rm(tmpDir, { recursive: true, force: true });
  delete process.env["DB_PATH"];
  delete process.env["MEDIA_DIR"];
  delete process.env["INGEST_FAKE"];
});

describe("ingest spine (STUBBED binaries — RED until Task 2)", () => {
  test("submitting a reel URL creates a submission + pending job [RED: queue module not built yet]", async () => {
    const db = openDb(dbPath);

    const submissionId = crypto.randomUUID();
    const shortcode = "SPINE01_" + submissionId.substring(0, 8);
    const now = Date.now();

    // Insert submission directly (cli.ts wiring tested in Task 3)
    db.run(
      `INSERT INTO submissions (id, source_type, source_url, reel_shortcode, file_path, content_hash, status, created_at, updated_at)
       VALUES (?, 'url', ?, ?, NULL, NULL, 'queued', ?, ?)`,
      [submissionId, TEST_URL_BASE + shortcode + "/", shortcode, now, now],
    );

    // Enqueue the job — this is what fails in RED (module not built yet)
    await enqueue(submissionId, db);

    // Verify job was created
    const job = db.prepare("SELECT * FROM jobs WHERE submission_id = ?").get(submissionId) as {
      status: string;
      attempts: number;
    } | null;
    expect(job).not.toBeNull();
    expect(job?.status).toBe("pending");
    expect(job?.attempts).toBe(0);

    db.close();
  });

  test("processJob with INGEST_FAKE=1 creates a findings row with media/audio/keyframes [RED: process module not built yet]", async () => {
    const db = openDb(dbPath);

    const submissionId = crypto.randomUUID();
    const shortcode = "SPINE02_" + submissionId.substring(0, 8);
    const now = Date.now();

    db.run(
      `INSERT INTO submissions (id, source_type, source_url, reel_shortcode, file_path, content_hash, status, created_at, updated_at)
       VALUES (?, 'url', ?, ?, NULL, NULL, 'queued', ?, ?)`,
      [submissionId, TEST_URL_BASE + shortcode + "/", shortcode, now, now],
    );

    await enqueue(submissionId, db);

    // Process the job — uses INGEST_FAKE=1 seam (no real yt-dlp/ffmpeg)
    await processJob(submissionId, db);

    // Findings row must exist with non-null media/audio/keyframe keys
    const finding = db
      .prepare("SELECT * FROM findings WHERE submission_id = ?")
      .get(submissionId) as {
      media_key: string | null;
      audio_key: string | null;
      keyframe_keys: string;
      status: string;
    } | null;

    expect(finding).not.toBeNull();
    expect(finding?.media_key).not.toBeNull();
    expect(finding?.audio_key).not.toBeNull();

    const keyframes = JSON.parse(finding?.keyframe_keys ?? "[]") as string[];
    expect(keyframes.length).toBeGreaterThan(0);

    // Submission must be marked done
    const sub = db
      .prepare("SELECT status FROM submissions WHERE id = ?")
      .get(submissionId) as { status: string } | null;
    expect(sub?.status).toBe("done");

    db.close();
  });

  test("duplicate shortcode submission is a no-op (dedup via UNIQUE index) [RED: queue module not built yet]", async () => {
    const db = openDb(dbPath);

    const submissionId1 = crypto.randomUUID();
    const submissionId2 = crypto.randomUUID();
    const now = Date.now();
    const dupShortcode = "DUPTEST_" + submissionId1.substring(0, 8);

    db.run(
      `INSERT INTO submissions (id, source_type, source_url, reel_shortcode, file_path, content_hash, status, created_at, updated_at)
       VALUES (?, 'url', ?, ?, NULL, NULL, 'queued', ?, ?)`,
      [submissionId1, `${TEST_URL_BASE}${dupShortcode}/`, dupShortcode, now, now],
    );
    await enqueue(submissionId1, db);

    // Second insert with same shortcode should be silently ignored (ON CONFLICT DO NOTHING)
    db.run(
      `INSERT OR IGNORE INTO submissions (id, source_type, source_url, reel_shortcode, file_path, content_hash, status, created_at, updated_at)
       VALUES (?, 'url', ?, ?, NULL, NULL, 'queued', ?, ?)`,
      [submissionId2, `${TEST_URL_BASE}${dupShortcode}/`, dupShortcode, now, now],
    );

    // Only one submission row for this shortcode
    const count = db
      .prepare("SELECT COUNT(*) as n FROM submissions WHERE reel_shortcode = ?")
      .get(dupShortcode) as { n: number };
    expect(count.n).toBe(1);

    db.close();
  });

  test("PRAGMA journal_mode is WAL and all three tables exist [passes in Task 1]", async () => {
    const db = openDb(dbPath);

    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(row.journal_mode).toBe("wal");

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("submissions");
    expect(tableNames).toContain("jobs");
    expect(tableNames).toContain("findings");

    db.close();
  });
});
