/**
 * saved-sync.test.ts — Tests for the opt-in saved-collection sync (CAP-05).
 *
 * Gallery-dl is STUBBED throughout — an injectable enumerator function is
 * passed into runSync() so tests do not require live Instagram or a real
 * gallery-dl installation. The off-by-default behaviour, dedup, batch cap,
 * and graceful failure are all testable in-sandbox.
 *
 * Test isolation: each test uses its own temp DB to avoid cross-test ordering
 * interference (same pattern as queue.test.ts from 01-01).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import os from "os";
import path from "path";
import { openDb } from "../src/db/db";
import { runMigration } from "../src/db/migrate";
import { runSync } from "../src/sync/saved-sync";
import type { Enumerator, SyncResult } from "../src/sync/saved-sync";

// Helper: create an isolated temp DB, run migration, return DB + cleanup fn.
async function makeTempDb(): Promise<{ db: Database; cleanup: () => void }> {
  const dbPath = path.join(
    os.tmpdir(),
    `reel-atlas-sync-test-${crypto.randomUUID()}.db`,
  );
  await runMigration(dbPath);
  const db = openDb(dbPath);
  return {
    db,
    cleanup: () => {
      db.close();
    },
  };
}

// A canned list of three reel URLs — two distinct shortcodes + one duplicate
const URL_A = "https://www.instagram.com/reel/SYNCTEST_A/";
const URL_B = "https://www.instagram.com/reel/SYNCTEST_B/";
const URL_DUP = "https://www.instagram.com/reel/SYNCTEST_A/"; // same as URL_A

/** Enumerator stub that returns a fixed list of URLs (simulates gallery-dl output). */
const stubEnumerator3: Enumerator = async (_collectionUrl: string, _browser: string) => [
  URL_A,
  URL_B,
  URL_DUP,
];

/** Enumerator stub that throws (simulates a gallery-dl 572 / exit-code failure). */
const stubEnumeratorFails: Enumerator = async (_collectionUrl: string, _browser: string) => {
  throw new Error("gallery-dl exited with code 1: 572 Unexpected server error");
};

/** Enumerator stub that returns 15 URLs (more than the default batch cap of 10). */
const stubEnumeratorMany: Enumerator = async (_collectionUrl: string, _browser: string) => {
  return Array.from(
    { length: 15 },
    (_, i) => `https://www.instagram.com/reel/SYNCTEST_MANY${String(i).padStart(2, "0")}/`,
  );
};

describe("runSync — off-by-default guard (D-08)", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(async () => {
    ({ db, cleanup } = await makeTempDb());
  });

  afterEach(() => {
    cleanup();
  });

  it("returns a disabled result immediately when SYNC_ENABLED=false (default)", async () => {
    const result = await runSync({
      db,
      syncEnabled: false,
      collectionUrl: "https://www.instagram.com/testuser/saved/col/12345678",
      browser: "chrome",
      batchSize: 10,
      delayMinMs: 0,
      delayMaxMs: 0,
      enumerator: stubEnumerator3,
    });

    expect(result.status).toBe("disabled");
    expect(result.enumerated).toBe(0);
    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(0);

    // Verify nothing was inserted into DB
    const rows = db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM submissions")
      .get();
    expect(rows?.count).toBe(0);
  });
});

describe("runSync — dedup + batch cap (SYNC_ENABLED=true)", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(async () => {
    ({ db, cleanup } = await makeTempDb());
  });

  afterEach(() => {
    cleanup();
  });

  it("inserts + enqueues only new submissions (dedup via ON CONFLICT) with 3-URL stub containing one duplicate", async () => {
    const result: SyncResult = await runSync({
      db,
      syncEnabled: true,
      collectionUrl: "https://www.instagram.com/testuser/saved/col/12345678",
      browser: "chrome",
      batchSize: 10,
      delayMinMs: 0,
      delayMaxMs: 0,
      enumerator: stubEnumerator3,
    });

    expect(result.status).toBe("ok");
    // URL_A, URL_B, URL_DUP — URL_DUP is duplicate of URL_A; only 2 unique shortcodes
    expect(result.enumerated).toBe(3);
    expect(result.enqueued).toBe(2);
    // URL_DUP is a dup of URL_A, so 1 skipped
    expect(result.skipped).toBe(1);

    // Verify exactly 2 submission rows in DB
    const subRows = db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM submissions")
      .get();
    expect(subRows?.count).toBe(2);

    // Verify exactly 2 job rows in DB
    const jobRows = db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM jobs")
      .get();
    expect(jobRows?.count).toBe(2);
  });

  it("respects SYNC_BATCH_SIZE cap — stops after batchSize items", async () => {
    const result: SyncResult = await runSync({
      db,
      syncEnabled: true,
      collectionUrl: "https://www.instagram.com/testuser/saved/col/12345678",
      browser: "chrome",
      batchSize: 5, // cap at 5 even though enumerator returns 15
      delayMinMs: 0,
      delayMaxMs: 0,
      enumerator: stubEnumeratorMany,
    });

    expect(result.status).toBe("ok");
    expect(result.enumerated).toBe(15); // all enumerated URLs are reported
    expect(result.enqueued).toBeLessThanOrEqual(5); // batch cap applied
    expect(result.enqueued).toBe(5);

    // Verify only 5 rows were inserted
    const subRows = db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM submissions")
      .get();
    expect(subRows?.count).toBe(5);
  });

  it("inserts submissions with source_type='sync'", async () => {
    await runSync({
      db,
      syncEnabled: true,
      collectionUrl: "https://www.instagram.com/testuser/saved/col/12345678",
      browser: "chrome",
      batchSize: 10,
      delayMinMs: 0,
      delayMaxMs: 0,
      enumerator: stubEnumerator3,
    });

    const rows = db
      .query<{ source_type: string }, []>(
        "SELECT DISTINCT source_type FROM submissions",
      )
      .all();
    expect(rows.length).toBe(1);
    expect(rows[0]?.source_type).toBe("sync");
  });
});

describe("runSync — graceful failure on gallery-dl error (Pitfall 5)", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(async () => {
    ({ db, cleanup } = await makeTempDb());
  });

  afterEach(() => {
    cleanup();
  });

  it("returns a failed result and does NOT throw when the enumerator throws", async () => {
    let threw = false;
    let result: SyncResult | null = null;

    try {
      result = await runSync({
        db,
        syncEnabled: true,
        collectionUrl: "https://www.instagram.com/testuser/saved/col/12345678",
        browser: "chrome",
        batchSize: 10,
        delayMinMs: 0,
        delayMaxMs: 0,
        enumerator: stubEnumeratorFails,
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false); // must NOT throw (worker resilience — Pitfall 5)
    expect(result).not.toBeNull();
    expect(result?.status).toBe("failed");
    expect(result?.enumerated).toBe(0);
    expect(result?.enqueued).toBe(0);

    // Nothing was inserted
    const rows = db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM submissions")
      .get();
    expect(rows?.count).toBe(0);
  });
});
