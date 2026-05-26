#!/usr/bin/env bun
/**
 * Worker poll loop — the long-running ingest service (D-03, D-15).
 *
 * Startup: probes for yt-dlp + ffmpeg, recovers orphaned jobs.
 * Loop: claim → processJob → markDone; on error → requeue with backoff
 *       or markFailed after MAX_ATTEMPTS.
 *
 * Structured logging at each transition (D-17, OPS-04).
 *
 * Usage: bun run worker
 */

import { runMigration } from "../db/migrate";
import { config, safeConfigSummary } from "../shared/config";
import {
  claimNext,
  markDone,
  markFailed,
  MAX_JOB_ATTEMPTS,
  recoverOrphaned,
  requeue,
} from "../queue/queue";
import { hasFfmpeg } from "./media";
import { hasYtDlp } from "./download";
import { processJob } from "./process";

const POLL_INTERVAL_MS = 2_000;

// Exponential backoff: 30s, 90s, 270s
function backoffMs(attempts: number): number {
  return 30_000 * Math.pow(3, attempts - 1);
}

function log(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

async function startup(): Promise<void> {
  log("info", "worker starting", { config: safeConfigSummary(config) });

  // Run migration to ensure schema is up to date
  await runMigration();

  // Probe yt-dlp (Pitfall 3 / RESEARCH §1)
  if (!(await hasYtDlp())) {
    log("error", "yt-dlp not found on PATH", {
      hint: "Install yt-dlp: brew install yt-dlp / pipx install yt-dlp (see github.com/yt-dlp/yt-dlp)",
    });
    process.exit(127);
  }
  log("info", "yt-dlp probe OK");

  // Probe ffmpeg (RESEARCH §6, Pitfall 3)
  if (!(await hasFfmpeg())) {
    log("error", "ffmpeg not found on PATH", {
      hint: "Install ffmpeg: apt install ffmpeg / brew install ffmpeg",
    });
    process.exit(127);
  }
  log("info", "ffmpeg probe OK");

  // Recover orphaned processing jobs from a prior crash (RESEARCH §3, Pitfall 4)
  recoverOrphaned();
  log("info", "orphaned job recovery complete");
}

async function runWorkerLoop(): Promise<never> {
  while (true) {
    const job = claimNext();

    if (!job) {
      await Bun.sleep(POLL_INTERVAL_MS);
      continue;
    }

    log("info", "job claimed", { jobId: job.id, submissionId: job.submission_id, attempts: job.attempts });

    try {
      await processJob(job.submission_id);
      markDone(job.id);
      log("info", "job done", { jobId: job.id, submissionId: job.submission_id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("warn", "job failed", { jobId: job.id, submissionId: job.submission_id, attempts: job.attempts, error: msg });

      if (job.attempts >= MAX_JOB_ATTEMPTS) {
        markFailed(job.id, msg);
        log("error", "job permanently failed", {
          jobId: job.id,
          submissionId: job.submission_id,
          attempts: job.attempts,
          error: msg,
        });
      } else {
        const delay = backoffMs(job.attempts);
        requeue(job.id, msg, delay);
        log("warn", "job requeued with backoff", {
          jobId: job.id,
          submissionId: job.submission_id,
          backoffMs: delay,
          attempts: job.attempts,
        });
      }
    }
  }
}

if (import.meta.main) {
  await startup();
  log("info", "worker loop started");
  await runWorkerLoop();
}
