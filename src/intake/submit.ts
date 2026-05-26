/**
 * Shared intake helpers used by both cli.ts and server.ts.
 *
 * submitUrl: validate + insert + enqueue an Instagram reel URL.
 * submitFile: hash + insert + enqueue a locally-saved video file.
 *
 * Both use INSERT OR IGNORE for dedup on partial unique indexes (D-07, CAP-04).
 * Security: URL is validated via isInstagramReelUrl before any DB write (T-02-02).
 *           File paths use path.basename + confinement guard (T-02-03).
 */

import path from "path";
import type { Database } from "bun:sqlite";
import { parseReelShortcode } from "../shared/instagram";
import { enqueue } from "../queue/queue";

export interface SubmitResult {
  submissionId: string;
  duplicate: boolean;
}

/**
 * Returns true if the input is an Instagram reel/p URL.
 * Security: only instagram.com reel/p URLs are allowed through (T-01-02 / T-02-02).
 */
export function isInstagramReelUrl(input: string): boolean {
  if (!input.startsWith("http://") && !input.startsWith("https://")) return false;
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (host !== "instagram.com" && host !== "www.instagram.com") return false;
    if (!/^\/(?:reels?|p)\/[A-Za-z0-9_-]+/.test(url.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate, dedup, insert, and enqueue an Instagram reel URL.
 * Returns { submissionId, duplicate } or throws on invalid URL.
 */
export async function submitUrl(rawUrl: string, db: Database): Promise<SubmitResult> {
  if (!isInstagramReelUrl(rawUrl)) {
    throw new TypeError(`Not a valid Instagram reel URL: "${rawUrl}"`);
  }

  const shortcode = parseReelShortcode(rawUrl);
  if (!shortcode) {
    throw new TypeError(`Could not extract shortcode from URL: "${rawUrl}"`);
  }

  const submissionId = crypto.randomUUID();
  const now = Date.now();

  // CAP-04: INSERT OR IGNORE dedup on partial unique index idx_submissions_shortcode.
  // ON CONFLICT (reel_shortcode) DO NOTHING doesn't work on partial indexes in SQLite.
  db.run(
    `INSERT OR IGNORE INTO submissions
       (id, source_type, source_url, reel_shortcode, file_path, content_hash, status, error, created_at, updated_at)
     VALUES (?, 'url', ?, ?, NULL, NULL, 'queued', NULL, ?, ?)`,
    [submissionId, rawUrl, shortcode, now, now],
  );

  const changes = db.query<{ changes: number }, []>("SELECT changes() as changes").get();
  const wasInserted = (changes?.changes ?? 0) > 0;

  if (!wasInserted) {
    // Already in DB — return the existing submission id
    const existing = db
      .prepare<{ id: string }, [string]>("SELECT id FROM submissions WHERE reel_shortcode = ?")
      .get(shortcode);
    return { submissionId: existing?.id ?? submissionId, duplicate: true };
  }

  await enqueue(submissionId, db);
  return { submissionId, duplicate: false };
}

/**
 * Compute SHA-256 hex of a Buffer using the Web Crypto API.
 */
export async function sha256Hex(buf: Buffer): Promise<string> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new Uint8Array(buf));
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Save a video file under targetDir, dedup by SHA-256 content hash, insert
 * a source_type='file' submission, and enqueue a job.
 *
 * Security: path.basename() + confinement check prevents path traversal (T-02-03).
 *
 * Returns { submissionId, duplicate } or throws on path-traversal attempt.
 */
export async function submitFile(
  fileBytes: Buffer,
  originalName: string,
  targetDir: string,
  db: Database,
): Promise<SubmitResult> {
  // Security: path traversal guard (T-02-03)
  const safeName = path.basename(originalName);
  if (
    safeName !== originalName ||
    safeName.includes("..") ||
    safeName.includes("/") ||
    safeName.includes("\\") ||
    safeName === ""
  ) {
    throw new TypeError(`Rejected filename (path traversal): "${originalName}"`);
  }
  // Additional guard: basename must not be a traversal component
  if (safeName !== path.basename(safeName)) {
    throw new TypeError(`Rejected filename (path traversal): "${originalName}"`);
  }

  // Compute SHA-256 hash for content-hash dedup (D-07 / CAP-04)
  const contentHash = await sha256Hex(fileBytes);

  const submissionId = crypto.randomUUID();
  const now = Date.now();
  const destPath = path.join(targetDir, safeName);

  // CAP-04: INSERT OR IGNORE on partial unique index idx_submissions_content_hash
  db.run(
    `INSERT OR IGNORE INTO submissions
       (id, source_type, source_url, reel_shortcode, file_path, content_hash, status, error, created_at, updated_at)
     VALUES (?, 'file', NULL, NULL, ?, ?, 'queued', NULL, ?, ?)`,
    [submissionId, destPath, contentHash, now, now],
  );

  const changes = db.query<{ changes: number }, []>("SELECT changes() as changes").get();
  const wasInserted = (changes?.changes ?? 0) > 0;

  if (!wasInserted) {
    // Duplicate by content hash
    const existing = db
      .prepare<{ id: string }, [string]>("SELECT id FROM submissions WHERE content_hash = ?")
      .get(contentHash);
    return { submissionId: existing?.id ?? submissionId, duplicate: true };
  }

  // Persist the file to disk (only if newly inserted to avoid orphan writes on race)
  await Bun.write(destPath, fileBytes);

  await enqueue(submissionId, db);
  return { submissionId, duplicate: false };
}
