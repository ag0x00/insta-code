#!/usr/bin/env bun
/**
 * Read-only inspection CLI: `bun run findings`.
 *
 * Prints a submissions/jobs status overview, any failed submissions with their
 * error, and the findings table (one row per processed reel). Safe to run while
 * the worker is live — WAL allows concurrent reads.
 */

import { getDb, closeDb } from "./db/db";
import { config } from "./shared/config";

type Row = Record<string, unknown>;

function truncate(value: unknown, max = 60): string {
  if (value == null) return "—";
  const s = String(value);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function isoFromMs(ms: unknown): string {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString().replace("T", " ").slice(0, 19) : "—";
}

function main(): void {
  const db = getDb();

  const subCounts = db
    .query("SELECT status, COUNT(*) AS n FROM submissions GROUP BY status")
    .all() as Row[];
  const jobCounts = db
    .query("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status")
    .all() as Row[];

  const fmtCounts = (rows: Row[]): string =>
    rows.length ? rows.map((r) => `${r["status"]}=${r["n"]}`).join("  ") : "(none)";

  console.log(`\nReel Atlas — DB: ${config.DB_PATH} | media: ${config.MEDIA_DIR}`);
  console.log(`submissions: ${fmtCounts(subCounts)}`);
  console.log(`jobs:        ${fmtCounts(jobCounts)}`);

  const failed = db
    .query(
      "SELECT id, source_type, COALESCE(reel_shortcode, file_path, source_url) AS src, error FROM submissions WHERE status = 'failed' ORDER BY updated_at DESC",
    )
    .all() as Row[];
  if (failed.length) {
    console.log(`\n⚠ failed submissions (${failed.length}):`);
    for (const r of failed) {
      console.log(`  ${String(r["id"]).slice(0, 8)} [${r["source_type"]}] ${truncate(r["src"], 40)} — ${truncate(r["error"], 80)}`);
    }
  }

  const findings = db
    .query(
      `SELECT f.id, f.reel_shortcode, s.source_type, f.author_handle, f.caption,
              f.media_key, f.audio_key, f.keyframe_keys, f.enrich_status, f.created_at
       FROM findings f JOIN submissions s ON s.id = f.submission_id
       ORDER BY f.created_at DESC`,
    )
    .all() as Row[];

  if (!findings.length) {
    console.log("\nfindings: (none yet)\n");
    closeDb();
    return;
  }

  console.log(`\nfindings (${findings.length}):`);
  for (const f of findings) {
    let kfCount = 0;
    try {
      kfCount = (JSON.parse(String(f["keyframe_keys"] ?? "[]")) as unknown[]).length;
    } catch {
      kfCount = 0;
    }
    console.log(
      [
        `  ${String(f["id"]).slice(0, 8)}`,
        `[${f["source_type"]}]`,
        `${f["reel_shortcode"] ?? "—"}`,
        `@${f["author_handle"] ?? "—"}`,
        `media=${truncate(f["media_key"], 28)}`,
        `audio=${truncate(f["audio_key"], 22)}`,
        `kf=${kfCount}`,
        `enrich=${f["enrich_status"]}`,
        `${isoFromMs(f["created_at"])}`,
      ].join("  "),
    );
    console.log(`        caption: ${truncate(f["caption"], 90)}`);
  }
  console.log("");

  closeDb();
}

main();
