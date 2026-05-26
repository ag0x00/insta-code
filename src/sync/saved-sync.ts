/**
 * saved-sync.ts — Opt-in, OFF-by-default saved-collection sync (CAP-05, D-08).
 *
 * When SYNC_ENABLED=true, enumerates a user's Instagram saved collection into
 * reel URLs via gallery-dl, then feeds each new URL through the existing
 * deduped submission + queue path. Pacing is deliberately ban-cautious:
 * a capped batch with randomized (jittered) delays between items.
 *
 * Security:
 *   T-03-01: gallery-dl invoked as a Bun.spawn arg ARRAY — never a shell string.
 *   T-03-02: each enumerated URL re-validated via parseReelShortcode before insert.
 *   T-03-03: try/catch around the whole run; failure logged + returned, never rethrown.
 *   T-03-04: off by default; capped batch + randomized jitter delays.
 *   T-03-05: cookies read from browser at call time by gallery-dl; never logged.
 */

import type { Database } from "bun:sqlite";
import { parseReelShortcode } from "../shared/instagram";
import { enqueue } from "../queue/queue";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Summary result returned by every runSync() call.
 * `status` values:
 *   "disabled" — SYNC_ENABLED=false; nothing happened (D-08 guard)
 *   "ok"       — run completed (some items may have been skipped as duplicates)
 *   "failed"   — gallery-dl or enumeration error; logged; worker does not crash
 */
export interface SyncResult {
  status: "disabled" | "ok" | "failed";
  enumerated: number;
  enqueued: number;
  skipped: number;
  error?: string;
}

/**
 * Injectable enumerator type. Defaults to the real gallery-dl implementation.
 * In tests, a stub returning a fixed list is passed instead.
 */
export type Enumerator = (collectionUrl: string, browser: string) => Promise<string[]>;

/** Options accepted by runSync(). */
export interface SyncOptions {
  db: Database;
  syncEnabled: boolean;
  collectionUrl: string | null;
  browser: string;
  batchSize: number;
  delayMinMs: number;
  delayMaxMs: number;
  /** Defaults to the real gallery-dl enumerator; override in tests. */
  enumerator?: Enumerator;
}

// ---------------------------------------------------------------------------
// Gallery-dl enumeration (real implementation)
// ---------------------------------------------------------------------------

/**
 * Enumerates an Instagram saved collection into reel URLs using gallery-dl.
 *
 * Security (T-03-01): `Bun.spawn` receives a plain arg array — NEVER a shell
 * string — so no shell injection is possible even if collectionUrl contains
 * special characters.
 *
 * On non-zero exit, throws an Error carrying stderr. If stderr contains
 * "Permission denied" or "database is locked", appends a hint to close Chrome
 * before running sync (Pitfall 1).
 */
export async function enumerateSavedCollection(
  collectionUrl: string,
  browser: string,
): Promise<string[]> {
  // T-03-01: arg ARRAY — never a shell string
  const proc = Bun.spawn(
    [
      "gallery-dl",
      "--cookies-from-browser",
      browser,
      "-N",
      "{post_url}",
      collectionUrl,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    let msg = `gallery-dl exited with code ${exitCode}`;
    if (stderr) msg += `: ${stderr.trim()}`;
    // Pitfall 1: Chrome cookie DB lock hint
    if (/Permission denied|database is locked/i.test(stderr)) {
      msg += " — Close Chrome before running saved-collection sync (Pitfall 1)";
    }
    throw new Error(msg);
  }

  // Parse stdout: one URL per line; skip blank lines and lines that are not URLs
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("http"));
}

// ---------------------------------------------------------------------------
// Jitter delay (RESEARCH §2)
// ---------------------------------------------------------------------------

/**
 * Sleeps a random duration in [minMs, maxMs].
 * Avoids a fixed-interval signature (T-03-04 / ban-safe pacing).
 */
export async function jitterDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await Bun.sleep(ms);
}

// ---------------------------------------------------------------------------
// Main sync runner
// ---------------------------------------------------------------------------

/**
 * Runs one saved-collection sync pass.
 *
 * 1. Guard: if syncEnabled=false, returns {status:"disabled"} immediately (D-08).
 * 2. Enumerate reel URLs via the (injectable) enumerator.
 * 3. For up to `batchSize` URLs:
 *    - Validate via parseReelShortcode (T-03-02)
 *    - INSERT submission with source_type='sync', ON CONFLICT DO NOTHING (dedup)
 *    - enqueue() only if newly inserted
 *    - Call jitterDelay between items
 * 4. Catch any enumeration failure — log + return {status:"failed"} (Pitfall 5, T-03-03).
 */
export async function runSync(opts: SyncOptions): Promise<SyncResult> {
  const {
    db,
    syncEnabled,
    collectionUrl,
    browser,
    batchSize,
    delayMinMs,
    delayMaxMs,
    enumerator = enumerateSavedCollection,
  } = opts;

  // D-08: Off-by-default guard
  if (!syncEnabled) {
    console.log("[saved-sync] Sync is disabled (SYNC_ENABLED=false). Set SYNC_ENABLED=true to opt in.");
    return { status: "disabled", enumerated: 0, enqueued: 0, skipped: 0 };
  }

  // Enumerate all URLs first — wrap in try/catch (T-03-03 / Pitfall 5)
  let urls: string[];
  try {
    if (!collectionUrl) {
      throw new Error("SYNC_COLLECTION_URL is not set — configure it before enabling sync");
    }
    urls = await enumerator(collectionUrl, browser);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[saved-sync] Enumeration failed: ${msg}`);
    return { status: "failed", enumerated: 0, enqueued: 0, skipped: 0, error: msg };
  }

  const enumerated = urls.length;
  let enqueued = 0;
  let skipped = 0;

  // Process up to batchSize URLs (T-03-04 — batch cap)
  const batch = urls.slice(0, batchSize);

  for (let i = 0; i < batch.length; i++) {
    const rawUrl = batch[i]!;

    // T-03-02: re-validate enumerated URL via parseReelShortcode before any DB write
    const shortcode = parseReelShortcode(rawUrl);
    if (!shortcode) {
      console.warn(`[saved-sync] Skipping unrecognised URL: ${rawUrl}`);
      skipped++;
      continue;
    }

    const submissionId = crypto.randomUUID();
    const now = Date.now();

    // CAP-04 dedup: INSERT OR IGNORE on the partial unique index idx_submissions_shortcode
    // (same dedup pattern as submitUrl in src/intake/submit.ts)
    db.run(
      `INSERT OR IGNORE INTO submissions
         (id, source_type, source_url, reel_shortcode, file_path, content_hash, status, error, created_at, updated_at)
       VALUES (?, 'sync', ?, ?, NULL, NULL, 'queued', NULL, ?, ?)`,
      [submissionId, rawUrl, shortcode, now, now],
    );

    const changes = db.query<{ changes: number }, []>("SELECT changes() as changes").get();
    const wasInserted = (changes?.changes ?? 0) > 0;

    if (wasInserted) {
      await enqueue(submissionId, db);
      enqueued++;
    } else {
      skipped++;
    }

    // T-03-04: Jittered delay between items (ban-safe pacing, RESEARCH §2)
    // Skip delay after the last item
    if (i < batch.length - 1) {
      await jitterDelay(delayMinMs, delayMaxMs);
    }
  }

  return { status: "ok", enumerated, enqueued, skipped };
}
