#!/usr/bin/env bun
/**
 * Reel Atlas — unified always-on service entry (OPS-01, D-03).
 *
 * Runs in a single Bun process:
 *   1. DB migration + orphan recovery
 *   2. Bun.serve HTTP intake (127.0.0.1:HTTP_PORT)
 *   3. fs.watch drop-folder watcher (DROP_DIR)
 *   4. Worker poll loop (drains the SQLite job queue)
 *
 * Startup banner lists the bound HTTP address, DROP_DIR, and worker poll start
 * so you can confirm all three subsystems are active from the first log line.
 *
 * SIGINT/SIGTERM: stops the HTTP server and watcher; the in-flight job's
 * 2-minute lease expires naturally and recoverOrphaned() handles it on restart.
 *
 * Process supervision (systemd, pm2, etc.) is the user's host concern (D-03).
 *
 * Usage: bun run worker  (or: bun run src/index.ts)
 */

import { config, safeConfigSummary } from "./shared/config";
import { startup, runWorkerLoop } from "./worker/loop";
import { startServer } from "./intake/server";
import { watchDropFolder } from "./intake/watcher";
import { getDb } from "./db/db";
import fs from "fs";

function log(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), level, msg, ...meta };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

async function main(): Promise<void> {
  // Phase 1: DB migration, yt-dlp + ffmpeg probes, orphan recovery
  // startup() exits with code 127 if yt-dlp or ffmpeg is missing (fast-fail)
  await startup();

  // Phase 2: Ensure DROP_DIR exists (create if absent)
  try {
    fs.mkdirSync(config.DROP_DIR, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", "Failed to create DROP_DIR", { dir: config.DROP_DIR, error: msg });
    process.exit(1);
  }

  // Phase 3: Start HTTP intake server (127.0.0.1 only — Security T-02-01)
  const db = getDb();
  const { server } = startServer({ db, mediaDir: config.MEDIA_DIR, port: config.HTTP_PORT });

  // Phase 4: Start drop-folder watcher
  const watchHandle = watchDropFolder(config.DROP_DIR, db);

  // Startup banner — all three subsystems active (OPS-01)
  log("info", "Reel Atlas service started", {
    http: `http://127.0.0.1:${server.port}`,
    watch: config.DROP_DIR,
    worker: "poll loop starting",
    config: safeConfigSummary(config),
  });

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: "=== Reel Atlas ready ===",
      "http-intake": `http://127.0.0.1:${server.port}`,
      "drop-folder": config.DROP_DIR,
      "worker-poll": "active",
    }),
  );

  // SIGINT / SIGTERM — clean shutdown (OPS-01)
  // In-flight jobs have a 2-minute lease; recoverOrphaned() resets them on restart.
  function shutdown(signal: string): void {
    log("info", `${signal} received — shutting down`);
    watchHandle.close();
    server.stop(true);
    // Worker loop is `never`-returning; process exits after this function returns
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Phase 5: Run worker poll loop (blocks forever — this is the "service" loop)
  await runWorkerLoop();
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        msg: "fatal startup error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exit(1);
  });
}
