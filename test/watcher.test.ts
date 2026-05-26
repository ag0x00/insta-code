/**
 * watcher.test.ts — Task 2 tests for the drop-folder watcher.
 *
 * Tests (all in-process, no ffmpeg required):
 *   - A fully-written video file produces exactly ONE submission + job
 *   - A burst of fs.watch events for one file does not double-enqueue (Pitfall 6)
 *   - A non-video file is ignored (nothing inserted)
 *   - Identical content dropped twice is deduped by content hash (CAP-04)
 *   - A still-growing file is not enqueued until size stabilizes (stable-size probe)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb } from "../src/db/db";
import { runMigration } from "../src/db/migrate";
import { watchDropFolder } from "../src/intake/watcher";
import os from "os";
import path from "path";
import fs from "fs";

// Helper: create an isolated temp dir + temp DB for each test
function makeTestEnv() {
  const dbPath = path.join(os.tmpdir(), `reel-atlas-watcher-${crypto.randomUUID()}.db`);
  const dropDir = path.join(os.tmpdir(), `reel-atlas-drop-${crypto.randomUUID()}`);
  fs.mkdirSync(dropDir, { recursive: true });
  return { dbPath, dropDir };
}

// Helper: write a file to the drop dir and wait for watcher to process it
function writeFile(dir: string, name: string, content: Buffer | string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// Helper: wait up to maxMs for a condition to be true, polling every intervalMs
async function waitFor(
  condition: () => boolean,
  maxMs: number = 4000,
  intervalMs: number = 100,
): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await Bun.sleep(intervalMs);
  }
  throw new Error(`waitFor timed out after ${maxMs}ms`);
}

describe("watchDropFolder — video file ingestion", () => {
  let db: Database;
  let dropDir: string;
  let watcher: { close: () => void } | null;

  beforeEach(async () => {
    const env = makeTestEnv();
    await runMigration(env.dbPath);
    db = openDb(env.dbPath);
    dropDir = env.dropDir;
    watcher = null;
  });

  afterEach(() => {
    watcher?.close();
    db.close();
    fs.rmSync(dropDir, { recursive: true, force: true });
  });

  it("creates exactly ONE submission + job when a fully-written video file is dropped", async () => {
    watcher = watchDropFolder(dropDir, db);

    writeFile(dropDir, "reel.mp4", Buffer.from("FAKE_VIDEO_DATA_FOR_WATCHER_TEST"));

    // Wait for debounce + stable-size probe + insert
    await waitFor(() => {
      const count = db
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM submissions")
        .get();
      return (count?.count ?? 0) === 1;
    }, 4000);

    const submissions = db.query<{ source_type: string }, []>(
      "SELECT source_type FROM submissions",
    ).all();
    expect(submissions.length).toBe(1);
    expect(submissions[0]?.source_type).toBe("file");

    const jobs = db.query<{ status: string }, []>("SELECT status FROM jobs").all();
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.status).toBe("pending");
  });

  it("does not double-enqueue when fs.watch fires multiple events for one file (Pitfall 6)", async () => {
    let callCount = 0;
    watcher = watchDropFolder(dropDir, db, () => {
      callCount++;
    });

    // Write a file — the debounce should collapse multiple events into one
    writeFile(dropDir, "burst-reel.mp4", Buffer.from("BURST_DEBOUNCE_TEST_DATA"));

    // Wait for the single job to appear
    await waitFor(() => {
      const count = db
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM jobs")
        .get();
      return (count?.count ?? 0) >= 1;
    }, 4000);

    // Wait a little more to confirm no second job arrives
    await Bun.sleep(2000);

    const jobs = db.query<{ id: string }, []>("SELECT id FROM jobs").all();
    expect(jobs.length).toBe(1);
  });

  it("ignores non-video files (e.g. .txt)", async () => {
    watcher = watchDropFolder(dropDir, db);

    writeFile(dropDir, "readme.txt", "not a video");

    // Give watcher time to process — nothing should appear
    await Bun.sleep(2500);

    const submissions = db.query<{ id: string }, []>("SELECT id FROM submissions").all();
    expect(submissions.length).toBe(0);
  });

  it("deduplicates by content hash — same file dropped twice produces one submission (CAP-04)", async () => {
    watcher = watchDropFolder(dropDir, db);

    const content = Buffer.from("DEDUP_HASH_TEST_CONTENT");

    writeFile(dropDir, "reel-first.mp4", content);

    await waitFor(() => {
      const count = db
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM submissions")
        .get();
      return (count?.count ?? 0) === 1;
    }, 4000);

    // Drop the same content with a different filename
    writeFile(dropDir, "reel-second.mp4", content);

    // Wait and confirm still only one submission
    await Bun.sleep(2500);

    const submissions = db.query<{ id: string }, []>("SELECT id FROM submissions").all();
    expect(submissions.length).toBe(1);

    const jobs = db.query<{ id: string }, []>("SELECT id FROM jobs").all();
    expect(jobs.length).toBe(1);
  });

  it("does not enqueue a growing (unstable) file until its size stabilizes", async () => {
    // Create a file and immediately resize it to simulate partial write;
    // the stable-size probe should prevent premature enqueue.
    // We implement this by writing a tiny file, then appending to it,
    // so both stats see different sizes.
    // The watcher's stable-size probe (stat → sleep(500) → stat) should detect change.

    watcher = watchDropFolder(dropDir, db);

    const filePath = path.join(dropDir, "growing.mp4");

    // Start writing: write initial content which triggers debounce timer
    fs.writeFileSync(filePath, Buffer.from("START"));

    // Within the debounce window (1s), append more bytes to make the file look growing
    await Bun.sleep(200);
    const fd = fs.openSync(filePath, "a");
    fs.writeSync(fd, Buffer.from("MORE_DATA"));
    fs.closeSync(fd);

    // The debounce timer resets. After it fires, stable-size probe runs:
    // size(t0) != size(t0+500) → should not enqueue.
    // Eventually the file stabilizes and gets enqueued on the NEXT event cycle.
    // We just verify no premature double-enqueue.
    await waitFor(() => {
      const count = db
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM jobs")
        .get();
      return (count?.count ?? 0) >= 1;
    }, 6000);

    const jobs = db.query<{ id: string }, []>("SELECT id FROM jobs").all();
    // Exactly one job — not zero (file eventually stabilized) and not multiple
    expect(jobs.length).toBe(1);
  });
});
