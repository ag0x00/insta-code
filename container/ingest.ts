import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IngestResult, JobMessage, ReelMetadata } from "../src/shared/dto";

const MAX_KEYFRAMES = 8;

function s3() {
  return new Bun.S3Client({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucket: process.env.R2_BUCKET!,
    endpoint: `https://${process.env.R2_ACCOUNT_ID!}.r2.cloudflarestorage.com`,
  });
}

async function run(cmd: string[], cwd: string): Promise<{ ok: boolean; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { ok: code === 0, stderr };
}

async function firstFileMatching(dir: string, test: (f: string) => boolean): Promise<string | null> {
  const files = await readdir(dir);
  const hit = files.find(test);
  return hit ? join(dir, hit) : null;
}

function parseMetadata(infoJson: unknown): ReelMetadata {
  const info = (infoJson ?? {}) as Record<string, unknown>;
  const uploadDate = typeof info.upload_date === "string" ? info.upload_date : null; // YYYYMMDD
  const postedAt =
    uploadDate && uploadDate.length === 8
      ? `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`
      : null;
  return {
    author_handle:
      (info.uploader_id as string) ?? (info.uploader as string) ?? (info.channel as string) ?? null,
    caption: (info.description as string) ?? (info.title as string) ?? null,
    posted_at: postedAt,
    duration_sec: typeof info.duration === "number" ? info.duration : null,
  };
}

/**
 * Hybrid acquire + extract for one job. Downloads via yt-dlp (or falls back to
 * the uploaded file from R2), extracts audio + keyframes with ffmpeg, uploads
 * artifacts to R2, and returns the keys + metadata.
 */
export async function ingest(job: JobMessage): Promise<IngestResult> {
  const dir = await mkdtemp(join(tmpdir(), "reel-"));
  const store = s3();
  const prefix = `findings/${job.submissionId}`;
  let metadata: ReelMetadata = {
    author_handle: null,
    caption: null,
    posted_at: null,
    duration_sec: null,
  };

  try {
    let mediaPath: string | null = null;

    // 1) Hybrid acquire: try the link first.
    if (job.sourceUrl) {
      const dl = await run(
        [
          "yt-dlp",
          "--no-playlist",
          "--write-info-json",
          "-o",
          join(dir, "media.%(ext)s"),
          job.sourceUrl,
        ],
        dir,
      );
      if (dl.ok) {
        mediaPath = await firstFileMatching(
          dir,
          (f) => f.startsWith("media.") && !f.endsWith(".info.json"),
        );
        const infoPath = await firstFileMatching(dir, (f) => f.endsWith(".info.json"));
        if (infoPath) {
          metadata = parseMetadata(JSON.parse(await readFile(infoPath, "utf8")));
        }
      } else {
        console.error("yt-dlp failed:", dl.stderr.slice(-500));
      }
    }

    // 2) Fallback: the user-uploaded file from R2.
    if (!mediaPath && job.uploadedFileKey) {
      mediaPath = join(dir, "media.mp4");
      const bytes = await store.file(job.uploadedFileKey).arrayBuffer();
      await Bun.write(mediaPath, bytes);
    }

    if (!mediaPath) {
      throw new Error("no media: yt-dlp download failed and no uploaded file fallback");
    }

    // 3) Extract audio (mono 16kHz mp3 — Whisper-friendly for Phase 2).
    const audioPath = join(dir, "audio.mp3");
    const audio = await run(
      ["ffmpeg", "-y", "-i", mediaPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audioPath],
      dir,
    );
    if (!audio.ok) throw new Error(`ffmpeg audio extraction failed: ${audio.stderr.slice(-300)}`);

    // 4) Extract keyframes (scene-change; fall back to evenly-spaced).
    await run(
      [
        "ffmpeg", "-y", "-i", mediaPath,
        "-vf", `select='gt(scene,0.4)',scale=640:-1`,
        "-vsync", "vfr", "-frames:v", String(MAX_KEYFRAMES),
        join(dir, "frame-%02d.jpg"),
      ],
      dir,
    );
    let frames = (await readdir(dir)).filter((f) => f.startsWith("frame-")).sort();
    if (frames.length === 0) {
      await run(
        ["ffmpeg", "-y", "-i", mediaPath, "-vf", "fps=1/2,scale=640:-1", "-frames:v", "4", join(dir, "frame-%02d.jpg")],
        dir,
      );
      frames = (await readdir(dir)).filter((f) => f.startsWith("frame-")).sort();
    }

    // 5) Upload artifacts to R2.
    const mediaKey = `${prefix}/media${mediaPath.endsWith(".mp4") ? ".mp4" : ""}`;
    const audioKey = `${prefix}/audio.mp3`;
    await store.write(mediaKey, await readFile(mediaPath));
    await store.write(audioKey, await readFile(audioPath));

    const keyframeKeys: string[] = [];
    for (const f of frames.slice(0, MAX_KEYFRAMES)) {
      const key = `${prefix}/keyframes/${f}`;
      await store.write(key, await readFile(join(dir, f)));
      keyframeKeys.push(key);
    }

    return { mediaKey, audioKey, keyframeKeys, metadata };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
