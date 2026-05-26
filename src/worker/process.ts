/**
 * Job processor: download → audio → keyframes → metadata → findings upsert.
 *
 * Supports INGEST_FAKE=1 env flag for CI/sandbox testing without real
 * yt-dlp/ffmpeg binaries — writes placeholder media files instead.
 */

import { join, resolve } from "path";
import { mkdir, writeFile } from "fs/promises";
import type { Database } from "bun:sqlite";
import { getDb } from "../db/db";
import { download } from "./download";
import { extractAudio, extractKeyframes } from "./media";
import { loadInfoJson, parseInfoJson } from "./metadata";
import { parseReelShortcode } from "../shared/instagram";
import { config } from "../shared/config";

/**
 * Process a submission through the full ingest pipeline:
 * 1. Download via yt-dlp (or use existing file_path for file-drop submissions)
 * 2. Extract audio (.m4a) and keyframes (kf_*.jpg) via ffmpeg
 * 3. Parse metadata from .info.json sidecar
 * 4. Upsert a findings row
 * 5. Mark submission as done
 *
 * When INGEST_FAKE=1, skips real binaries and writes placeholder files.
 */
export async function processJob(submissionId: string, override?: Database): Promise<void> {
  const db = override ?? getDb();
  const mediaDir = resolve(config.MEDIA_DIR);
  await mkdir(mediaDir, { recursive: true });

  // Load the submission row
  const submission = db
    .prepare(
      "SELECT id, source_type, source_url, reel_shortcode, file_path FROM submissions WHERE id = ?",
    )
    .get(submissionId) as {
    id: string;
    source_type: string;
    source_url: string | null;
    reel_shortcode: string | null;
    file_path: string | null;
  } | null;

  if (!submission) {
    throw new Error(`Submission not found: ${submissionId}`);
  }

  const now = Date.now();

  // Mark submission as processing
  db.run("UPDATE submissions SET status = 'processing', updated_at = ? WHERE id = ?", [
    now,
    submissionId,
  ]);

  const isFake = process.env["INGEST_FAKE"] === "1";

  let videoPath: string;
  let shortcode: string;
  let infoJsonPath: string | null = null;

  if (isFake) {
    // INGEST_FAKE mode: write placeholder files without calling yt-dlp/ffmpeg
    shortcode =
      submission.reel_shortcode ??
      (submission.source_url ? parseReelShortcode(submission.source_url) : null) ??
      submissionId.substring(0, 11);

    const fakeVideoPath = join(mediaDir, `${shortcode}.mp4`);
    await writeFile(fakeVideoPath, Buffer.from("FAKE_VIDEO_DATA"));
    videoPath = fakeVideoPath;
  } else if (submission.source_type === "file" && submission.file_path) {
    // File-drop path (ING-02): use the existing file, skip download
    videoPath = resolve(submission.file_path);
    shortcode =
      submission.reel_shortcode ??
      (submission.source_url ? parseReelShortcode(submission.source_url) : null) ??
      submissionId.substring(0, 11);
  } else if (submission.source_url) {
    // URL path (ING-01): download via yt-dlp
    shortcode =
      submission.reel_shortcode ??
      parseReelShortcode(submission.source_url) ??
      submissionId.substring(0, 11);

    const result = await download(submission.source_url, shortcode, mediaDir);
    videoPath = result.videoPath;
    infoJsonPath = result.infoJsonPath;
  } else {
    throw new Error(`Submission ${submissionId} has no source_url and no file_path`);
  }

  // Relative path for storage (relative to mediaDir for portability)
  const mediaKey = join(shortcode + videoPath.substring(videoPath.lastIndexOf(".")));

  let audioKey: string;
  let keyframeKeys: string[];
  let metadata: { author_handle: string | null; caption: string | null; posted_at: string | null; duration_sec: number | null };

  if (isFake) {
    // INGEST_FAKE: write placeholder audio + keyframe files
    const fakeAudioPath = join(mediaDir, `${shortcode}.m4a`);
    await writeFile(fakeAudioPath, Buffer.from("FAKE_AUDIO_DATA"));
    audioKey = `${shortcode}.m4a`;

    const kfDir = join(mediaDir, shortcode);
    await mkdir(kfDir, { recursive: true });
    const kf1 = join(kfDir, "kf_001.jpg");
    const kf2 = join(kfDir, "kf_002.jpg");
    await writeFile(kf1, Buffer.from("FAKE_KF_1"));
    await writeFile(kf2, Buffer.from("FAKE_KF_2"));
    keyframeKeys = [`${shortcode}/kf_001.jpg`, `${shortcode}/kf_002.jpg`];

    // Fake metadata
    metadata = {
      author_handle: "fake_user",
      caption: "Fake caption for testing",
      posted_at: "20260526",
      duration_sec: 30,
    };
  } else {
    // Real path: run ffmpeg
    const audioPath = await extractAudio(videoPath, shortcode, mediaDir);
    audioKey = audioPath.substring(mediaDir.length).replace(/^\//, "");

    const kfPaths = await extractKeyframes(videoPath, shortcode, mediaDir);
    keyframeKeys = kfPaths.map((p) => p.substring(mediaDir.length).replace(/^\//, ""));

    // Load metadata from .info.json
    if (infoJsonPath) {
      try {
        const text = await Bun.file(infoJsonPath).text();
        metadata = parseInfoJson(JSON.parse(text));
      } catch {
        metadata = await loadInfoJson(shortcode, mediaDir);
      }
    } else {
      metadata = await loadInfoJson(shortcode, mediaDir);
    }
  }

  // Derive media_key as relative path from mediaDir
  const relativeMediaKey = videoPath.startsWith(mediaDir + "/")
    ? videoPath.substring(mediaDir.length + 1)
    : mediaKey;

  const findingId = crypto.randomUUID();
  const nowEnd = Date.now();

  // Upsert findings row (INSERT OR REPLACE to handle retries)
  db.run(
    `INSERT OR REPLACE INTO findings
     (id, submission_id, reel_shortcode, author_handle, caption, posted_at, duration_sec,
      media_key, audio_key, keyframe_keys, status, enrich_status, created_at, updated_at)
     VALUES (
       COALESCE((SELECT id FROM findings WHERE submission_id = ?), ?),
       ?, ?, ?, ?, ?, ?,
       ?, ?, ?, 'done', 'pending', ?, ?
     )`,
    [
      submissionId,
      findingId,
      submissionId,
      shortcode,
      metadata.author_handle,
      metadata.caption,
      metadata.posted_at,
      metadata.duration_sec,
      relativeMediaKey,
      audioKey,
      JSON.stringify(keyframeKeys),
      nowEnd,
      nowEnd,
    ],
  );

  // Mark submission as done
  db.run("UPDATE submissions SET status = 'done', error = NULL, updated_at = ? WHERE id = ?", [
    nowEnd,
    submissionId,
  ]);
}
