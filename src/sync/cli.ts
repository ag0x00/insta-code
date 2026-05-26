/**
 * sync CLI — triggers one opt-in saved-collection sync run (CAP-05, D-08).
 *
 * Usage:
 *   bun run sync
 *   SYNC_ENABLED=true bun run sync
 *
 * When SYNC_ENABLED=false (the default), prints an informative message and
 * exits 0 — sync must be explicitly opted into (D-08).
 *
 * When SYNC_ENABLED=true, runs one sync pass via runSync() and prints the
 * summary (enumerated / enqueued / skipped / status) to stdout (D-06).
 *
 * Exit codes:
 *   0 — sync disabled (no-op) or sync completed (even if some items were
 *       skipped as duplicates, or if gallery-dl returned a non-fatal error)
 *   1 — unexpected internal error (not a gallery-dl failure — those are
 *       logged and returned in the result with status "failed")
 *
 * Intentionally NOT building an automatic scheduler here — keep it simple.
 * The SYNC_CRON knob is documented in .env.example for a future scheduler.
 */

import { config } from "../shared/config";
import { getDb } from "../db/db";
import { runMigration } from "../db/migrate";
import { runSync } from "./saved-sync";

async function main(): Promise<void> {
  // Off-by-default guard (D-08): exit 0 with clear guidance when sync is disabled.
  if (!config.SYNC_ENABLED) {
    console.log(
      "[sync] Sync is disabled — set SYNC_ENABLED=true and configure SYNC_COLLECTION_URL in .env to opt in.",
    );
    process.exit(0);
  }

  // Ensure the DB schema exists before opening the connection.
  await runMigration(config.DB_PATH);
  const db = getDb();

  const result = await runSync({
    db,
    syncEnabled: config.SYNC_ENABLED,
    collectionUrl: config.SYNC_COLLECTION_URL,
    browser: config.IG_COOKIES_BROWSER,
    batchSize: config.SYNC_BATCH_SIZE,
    delayMinMs: config.SYNC_DELAY_MIN_MS,
    delayMaxMs: config.SYNC_DELAY_MAX_MS,
    // Uses the real gallery-dl enumerator (default)
  });

  // D-06: surface the run summary to stdout
  console.log(
    `[sync] status=${result.status} enumerated=${result.enumerated} enqueued=${result.enqueued} skipped=${result.skipped}`,
  );
  if (result.error) {
    console.log(`[sync] error=${result.error}`);
  }

  // Exit 0 for expected outcomes: disabled, ok, failed (gallery-dl error is
  // logged + returned as status="failed" — that is best-effort, not a crash).
  // Only exit 1 on an internal unhandled exception (caught below in top-level).
  process.exit(0);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[sync] Unexpected internal error: ${msg}`);
  process.exit(1);
});
