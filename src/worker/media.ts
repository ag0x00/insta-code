/**
 * ffmpeg wrappers for audio extraction and keyframe sampling (ING-03, ING-04).
 *
 * Security: all subprocess arguments are passed as an ARRAY to Bun.spawn,
 * never as a shell string (T-01-01: command injection mitigation).
 */

import { join, resolve } from "path";
import { mkdir, readdir } from "fs/promises";
import { config } from "../shared/config";

/**
 * Probe whether ffmpeg is available on PATH.
 */
export async function hasFfmpeg(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["ffmpeg", "-version"], { stdout: "pipe", stderr: "pipe" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

/**
 * Extract the audio track from a video file (no re-encoding — copy codec).
 * Output: {mediaDir}/{shortcode}.m4a
 *
 * @returns Absolute path to the extracted .m4a file.
 */
export async function extractAudio(
  videoPath: string,
  shortcode: string,
  mediaDir: string = config.MEDIA_DIR,
): Promise<string> {
  const resolvedMediaDir = resolve(mediaDir);
  const outputPath = join(resolvedMediaDir, `${shortcode}.m4a`);

  // Security: Bun.spawn with args ARRAY (T-01-01)
  const proc = Bun.spawn(
    ["ffmpeg", "-i", videoPath, "-vn", "-acodec", "copy", outputPath, "-y"],
    { stdout: "pipe", stderr: "pipe" },
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `ffmpeg audio extraction failed (exit ${exitCode})\nstderr: ${stderr.slice(0, 500)}`,
    );
  }

  return outputPath;
}

/**
 * Extract representative keyframes from a video file.
 * Strategy: evenly-spaced (1 frame per 10 seconds), max 6 frames, 640px wide.
 * Output directory: {mediaDir}/{shortcode}/kf_001.jpg, kf_002.jpg, ...
 *
 * @returns Array of absolute paths to keyframe files.
 */
export async function extractKeyframes(
  videoPath: string,
  shortcode: string,
  mediaDir: string = config.MEDIA_DIR,
): Promise<string[]> {
  const resolvedMediaDir = resolve(mediaDir);
  const kfDir = join(resolvedMediaDir, shortcode);

  // Create keyframe subdirectory
  await mkdir(kfDir, { recursive: true });

  const outputTemplate = join(kfDir, "kf_%03d.jpg");

  // ffmpeg filter: 1 frame per 10 seconds, scale to 640px wide (aspect-preserving), max 6 frames
  // Security: Bun.spawn with args ARRAY (T-01-01)
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-i", videoPath,
      "-vf", "fps=1/10,scale=640:-1",
      "-frames:v", "6",
      "-q:v", "3",
      outputTemplate,
      "-y",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `ffmpeg keyframe extraction failed (exit ${exitCode})\nstderr: ${stderr.slice(0, 500)}`,
    );
  }

  // Collect the produced keyframe files (sorted)
  const entries = await readdir(kfDir);
  const keyframes = entries
    .filter((f) => f.startsWith("kf_") && f.endsWith(".jpg"))
    .sort()
    .map((f) => join(kfDir, f));

  return keyframes;
}
