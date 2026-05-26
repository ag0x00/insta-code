/**
 * Metadata parser for yt-dlp's .info.json sidecar (ING-05, D-12).
 *
 * All fields are best-effort / optional — parse in try/catch and treat
 * everything as nullable (T-01-04: malformed .info.json mitigation).
 *
 * Field mapping per RESEARCH §5:
 *   channel        → author_handle
 *   description    → caption
 *   upload_date    → posted_at  (YYYYMMDD string)
 *   duration       → duration_sec
 */

import { join } from "path";
import type { ReelMetadata } from "../shared/dto";
import { config } from "../shared/config";

/**
 * Parse a yt-dlp info.json object into ReelMetadata.
 * Tolerates missing or corrupt fields — never throws.
 */
export function parseInfoJson(json: unknown): ReelMetadata {
  try {
    if (json === null || typeof json !== "object") {
      return nullMetadata();
    }

    const obj = json as Record<string, unknown>;

    const author_handle = safeString(obj["channel"]) ?? safeString(obj["uploader"]);
    const caption = safeString(obj["description"]);
    const posted_at = safeString(obj["upload_date"]); // YYYYMMDD
    const duration_sec = safeNumber(obj["duration"]);

    return { author_handle, caption, posted_at, duration_sec };
  } catch {
    // Any unexpected error → all-null result (never throw to caller)
    return nullMetadata();
  }
}

/**
 * Load and parse the .info.json sidecar for a shortcode.
 * Returns null metadata if the file doesn't exist or is unreadable.
 */
export async function loadInfoJson(
  shortcode: string,
  mediaDir: string = config.MEDIA_DIR,
): Promise<ReelMetadata> {
  const infoPath = join(mediaDir, `${shortcode}.info.json`);
  try {
    const text = await Bun.file(infoPath).text();
    const json: unknown = JSON.parse(text);
    return parseInfoJson(json);
  } catch {
    // File missing, unreadable, or invalid JSON → tolerate (D-12)
    return nullMetadata();
  }
}

function nullMetadata(): ReelMetadata {
  return {
    author_handle: null,
    caption: null,
    posted_at: null,
    duration_sec: null,
  };
}

function safeString(val: unknown): string | null {
  if (typeof val === "string" && val.trim().length > 0) return val.trim();
  return null;
}

function safeNumber(val: unknown): number | null {
  if (typeof val === "number" && isFinite(val)) return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    if (!isNaN(n) && isFinite(n)) return n;
  }
  return null;
}
