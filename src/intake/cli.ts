#!/usr/bin/env bun
/**
 * CLI submit command: bun run submit <instagram-reel-url>
 *
 * Validates the URL is an Instagram reel URL, inserts a deduped submission row,
 * and enqueues a job. Duplicate shortcodes are silently skipped.
 *
 * Security: T-01-02 — rejects non-Instagram-reel URLs before they can reach yt-dlp
 * (SSRF/arbitrary-URL mitigation). Exit non-zero on invalid input.
 *
 * Usage:
 *   bun run submit "https://www.instagram.com/reel/DYeHzvgCURl/"
 */

import { parseReelShortcode } from "../shared/instagram";
import { getDb } from "../db/db";
import { runMigration } from "../db/migrate";
import { enqueue } from "../queue/queue";
import { config } from "../shared/config";

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: bun run submit <instagram-reel-url>");
    process.exit(1);
  }

  const rawInput = args[0];

  // Security: validate the argument is an Instagram reel URL (T-01-02)
  if (!rawInput || !isInstagramReelUrl(rawInput)) {
    console.error(
      `Error: not a valid Instagram reel URL: "${rawInput}"\n` +
        "Expected format: https://www.instagram.com/reel/<shortcode>/",
    );
    process.exit(1);
  }

  const shortcode = parseReelShortcode(rawInput);
  if (!shortcode) {
    console.error(`Error: could not extract shortcode from URL: "${rawInput}"`);
    process.exit(1);
  }

  // Ensure the schema exists (idempotent)
  await runMigration(config.DB_PATH);

  const db = getDb();
  const now = Date.now();
  const submissionId = crypto.randomUUID();

  // CAP-04: INSERT OR IGNORE for shortcode dedup (D-07).
  // Uses INSERT OR IGNORE because the UNIQUE index on reel_shortcode is a
  // partial index (WHERE reel_shortcode IS NOT NULL), which SQLite does not
  // support in ON CONFLICT (col) syntax — OR IGNORE triggers on any constraint
  // violation including partial unique indexes.
  db.run(
    `INSERT OR IGNORE INTO submissions (id, source_type, source_url, reel_shortcode, file_path, content_hash, status, error, created_at, updated_at)
     VALUES (?, 'url', ?, ?, NULL, NULL, 'queued', NULL, ?, ?)`,
    [submissionId, rawInput, shortcode, now, now],
  );

  // Check whether the insert landed (changes() == 0 means duplicate shortcode)
  const changes = db.query<{ changes: number }, []>("SELECT changes() as changes").get();
  const wasInserted = (changes?.changes ?? 0) > 0;

  if (!wasInserted) {
    console.log(`duplicate — already captured (shortcode ${shortcode})`);
    process.exit(0);
  }

  // Enqueue the job
  await enqueue(submissionId, db);

  console.log(`queued — submission ${submissionId} (shortcode ${shortcode})`);
  process.exit(0);
}

/**
 * Returns true if the input looks like an Instagram reel/p URL.
 * Security: only instagram.com reel/p URLs are allowed through (T-01-02).
 */
function isInstagramReelUrl(input: string): boolean {
  // Must be a URL starting with http/https
  if (!input.startsWith("http://") && !input.startsWith("https://")) return false;

  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();

    // Must be instagram.com (with or without www.)
    if (host !== "instagram.com" && host !== "www.instagram.com") return false;

    // Path must match /reel/<code>, /reels/<code>, or /p/<code>
    if (!/^\/(?:reels?|p)\/[A-Za-z0-9_-]+/.test(url.pathname)) return false;

    return true;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
