/**
 * Drop-folder watcher (CAP-02, D-04, ING-02).
 *
 * Watches a directory for new video files using Bun-native `fs.watch`.
 * Implements the RESEARCH §4 pattern:
 *   - Per-filename 1s debounce (collapses event bursts — Pitfall 6)
 *   - Two-stat stable-size probe (stat → sleep 500ms → stat; skips still-growing files)
 *   - Content-hash dedup via submitFile (INSERT OR IGNORE on content_hash — CAP-04)
 *   - One bad file never kills the watcher (per-file try/catch — OPS-04)
 *
 * Security:
 *   T-02-03: path.basename() + confinement check in submitFile prevents path traversal.
 *   Filenames from fs.watch are basenames only (no path components).
 *
 * Usage:
 *   const handle = watchDropFolder(dir, db);
 *   // ...later...
 *   handle.close();
 */

import fs from "fs";
import path from "path";
import type { Database } from "bun:sqlite";
import { submitFile } from "./submit";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".mpeg", ".mpg", ".ogg"]);

const DEBOUNCE_MS = 1_000; // reset timer on each burst event
const STABLE_PROBE_DELAY_MS = 500; // gap between two stat() calls for size-stability

export interface WatchHandle {
  close: () => void;
}

/**
 * Start watching `dir` for new video files.
 *
 * @param dir       Directory to watch (must exist).
 * @param db        SQLite Database instance for dedup + insert.
 * @param onEnqueue Optional callback called after each file is successfully enqueued.
 *                  Used in tests to count enqueue calls.
 * @returns A handle with a `close()` method to stop the watcher.
 */
export function watchDropFolder(
  dir: string,
  db: Database,
  onEnqueue?: () => void,
): WatchHandle {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const watcher = fs.watch(dir, (_event, filename) => {
    if (!filename) return;

    // Security: fs.watch returns a basename — no path separator should ever appear,
    // but reject any separator character defensively (T-02-03).
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          msg: "watcher: rejected suspicious filename",
          filename,
        }),
      );
      return;
    }

    const ext = path.extname(filename).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) {
      // Not a video — silently skip
      return;
    }

    // Debounce: reset the timer on each event burst for this filename (Pitfall 6)
    const existing = timers.get(filename);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    timers.set(
      filename,
      setTimeout(() => {
        timers.delete(filename);
        void processFile(path.join(dir, filename), dir, db, onEnqueue);
      }, DEBOUNCE_MS),
    );
  });

  return {
    close() {
      // Cancel all pending timers
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      watcher.close();
    },
  };
}

/**
 * Handle a single file that has passed debounce:
 *   1. Stable-size probe (two stat() calls separated by STABLE_PROBE_DELAY_MS).
 *   2. If stable, read bytes and delegate to submitFile for hash dedup + enqueue.
 *   3. Catch and log errors so one bad file cannot kill the watcher loop (OPS-04).
 */
async function processFile(
  filePath: string,
  targetDir: string,
  db: Database,
  onEnqueue?: () => void,
): Promise<void> {
  try {
    // Stable-size probe — RESEARCH §4
    let s1: { size: number };
    try {
      s1 = await fs.promises.stat(filePath);
    } catch {
      // File was removed before we could probe — ignore
      return;
    }

    if (s1.size === 0) {
      // Zero-length: not ready yet
      return;
    }

    await Bun.sleep(STABLE_PROBE_DELAY_MS);

    let s2: { size: number };
    try {
      s2 = await fs.promises.stat(filePath);
    } catch {
      // File removed during probe — ignore
      return;
    }

    if (s1.size !== s2.size) {
      // File is still growing — skip this event; debounce will fire again if more events arrive.
      // Note: if this was the only event burst, the file stays un-enqueued until a new event
      // (e.g., a close event on some Linux FSes) or the user re-drops the file.
      // This is the safe tradeoff per RESEARCH §4.
      return;
    }

    // Read the file contents for hash computation + submitFile persistence
    const fileBytes = Buffer.from(await Bun.file(filePath).arrayBuffer());
    const basename = path.basename(filePath);

    const result = await submitFile(fileBytes, basename, targetDir, db);

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: result.duplicate ? "watcher: file duplicate" : "watcher: file queued",
        filePath,
        submissionId: result.submissionId,
        duplicate: result.duplicate,
      }),
    );

    if (!result.duplicate && onEnqueue) {
      onEnqueue();
    }
  } catch (err) {
    // Per-file error handling: log and continue (OPS-04 — one bad file never kills watcher)
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        msg: "watcher: error processing file",
        filePath,
        error: msg,
      }),
    );
  }
}
