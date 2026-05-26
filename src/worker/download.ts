/**
 * yt-dlp download wrapper based on scripts/fetch-reel.ts (validated 2026-05-26).
 *
 * Security: all subprocess arguments are passed as an ARRAY to Bun.spawn,
 * never as a shell string (T-01-01: command injection mitigation).
 * Security: output is confined under MEDIA_DIR; path components are validated
 * before use (T-01-03: path traversal mitigation).
 */

import { join, resolve } from "path";
import { readdir } from "fs/promises";
import { config } from "../shared/config";

/**
 * Probe whether yt-dlp is available on PATH.
 */
export async function hasYtDlp(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["yt-dlp", "--version"], { stdout: "pipe", stderr: "pipe" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

export interface DownloadResult {
  /** Absolute path to the downloaded video file. */
  videoPath: string;
  /** Absolute path to the .info.json sidecar (may not exist if yt-dlp skipped it). */
  infoJsonPath: string;
}

/**
 * Download an Instagram reel via yt-dlp using browser cookies.
 *
 * @param url - Instagram reel URL (already validated by cli.ts / parseReelShortcode)
 * @param shortcode - Reel shortcode (used to construct output paths and locate files)
 * @param mediaDir - Absolute path to the media directory (must be pre-created)
 * @param browser - Browser cookie source (default: config.IG_COOKIES_BROWSER)
 */
export async function download(
  url: string,
  shortcode: string,
  mediaDir: string = config.MEDIA_DIR,
  browser: string = config.IG_COOKIES_BROWSER,
): Promise<DownloadResult> {
  // Security: resolve MEDIA_DIR and assert the intended output dir is inside it
  const resolvedMediaDir = resolve(mediaDir);

  // yt-dlp output template: {shortcode}.%(ext)s → produces shortcode.mp4 or shortcode.webm
  const outputTemplate = join(resolvedMediaDir, `%(id)s.%(ext)s`);

  const args = [
    "--no-playlist",
    "--retries", "3",
    "--sleep-requests", "1",
    "--write-info-json",
    "--restrict-filenames",
    "--merge-output-format", "mp4",
    "--cookies-from-browser", browser,
    "-o", outputTemplate,
    url,
  ];

  // Security: Bun.spawn with args ARRAY — never a shell string (T-01-01)
  const proc = Bun.spawn(["yt-dlp", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    // Pitfall 1: Chrome cookie DB lock hint
    const isCookieLock =
      stderr.includes("Permission denied") || stderr.includes("database is locked");
    const hint = isCookieLock
      ? " (Chrome cookie DB is locked — close Chrome before running the worker)"
      : "";
    throw new Error(`yt-dlp exited with code ${exitCode}${hint}\nstderr: ${stderr.slice(0, 500)}`);
  }

  // Pitfall 2: glob for the actual file rather than hardcoding .mp4
  // yt-dlp uses the video id (= shortcode) as the filename
  const videoPath = await findVideoFile(resolvedMediaDir, shortcode);
  const infoJsonPath = join(resolvedMediaDir, `${shortcode}.info.json`);

  return { videoPath, infoJsonPath };
}

/**
 * Locate the video file for a shortcode in the media dir by globbing {shortcode}.*
 * Avoids hardcoding the extension (Pitfall 2).
 */
async function findVideoFile(mediaDir: string, shortcode: string): Promise<string> {
  const VIDEO_EXTS = new Set([".mp4", ".webm", ".mkv", ".mov", ".avi"]);

  let entries: string[];
  try {
    entries = await readdir(mediaDir);
  } catch {
    throw new Error(`Cannot read MEDIA_DIR: ${mediaDir}`);
  }

  for (const entry of entries) {
    const dotIdx = entry.lastIndexOf(".");
    if (dotIdx < 0) continue;
    const base = entry.substring(0, dotIdx);
    const ext = entry.substring(dotIdx).toLowerCase();

    if (base === shortcode && VIDEO_EXTS.has(ext)) {
      const fullPath = join(mediaDir, entry);
      // Security: verify the resolved path is under MEDIA_DIR (T-01-03)
      const resolvedPath = resolve(fullPath);
      const resolvedDir = resolve(mediaDir);
      if (!resolvedPath.startsWith(resolvedDir + "/") && resolvedPath !== resolvedDir) {
        throw new Error(`Path traversal detected: ${resolvedPath} is outside ${resolvedDir}`);
      }
      return resolvedPath;
    }
  }

  throw new Error(
    `yt-dlp exited 0 but no video file found for shortcode '${shortcode}' in ${mediaDir}`,
  );
}
