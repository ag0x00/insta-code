---
phase: "01"
plan: "01"
subsystem: "capture-ingest-spine"
tags: [bun, sqlite, queue, worker, yt-dlp, ffmpeg, ingest, cli]
dependency_graph:
  requires: []
  provides:
    - "SQLite schema (submissions, jobs, findings) with WAL mode"
    - "Durable job queue (enqueue, claimNext, markDone, markFailed, requeue, recoverOrphaned)"
    - "yt-dlp download wrapper with glob-based output discovery"
    - "ffmpeg audio extraction and keyframe sampling"
    - "yt-dlp info.json metadata parser (tolerant of corrupt input)"
    - "Full ingest pipeline (processJob) with INGEST_FAKE=1 stub seam"
    - "Worker poll loop with startup probes and exponential backoff"
    - "CLI submit command with shortcode dedup and URL validation"
  affects: []
tech_stack:
  added:
    - "bun:sqlite — SQLite database singleton with WAL + busy_timeout"
    - "Bun.spawn (arg-array form) — yt-dlp + ffmpeg subprocess invocation"
  patterns:
    - "SQLite atomic UPDATE...WHERE id=(SELECT...LIMIT 1)...RETURNING claim pattern"
    - "INGEST_FAKE=1 env flag for CI/sandbox binary stubbing"
    - "Partial UNIQUE indexes for shortcode and content_hash dedup"
    - "INSERT OR IGNORE for idempotent submission intake"
key_files:
  created:
    - src/db/db.ts
    - src/db/migrate.ts
    - src/db/schema.sql
    - src/queue/queue.ts
    - src/worker/download.ts
    - src/worker/loop.ts
    - src/worker/media.ts
    - src/worker/metadata.ts
    - src/worker/process.ts
    - src/intake/cli.ts
    - src/shared/config.ts
    - .env.example
    - test/spine.e2e.test.ts
    - test/queue.test.ts
    - test/metadata.test.ts
  modified:
    - package.json
    - tsconfig.json
    - .gitignore
    - src/shared/dto.ts
    - src/shared/types.ts
decisions:
  - "Use INSERT OR IGNORE (not ON CONFLICT (col) DO NOTHING) for dedup on partial unique indexes — SQLite only supports ON CONFLICT clause syntax for full (non-partial) indexes"
  - "Each queue test uses its own isolated DB to avoid cross-test job ordering interference (claimNext is ORDER BY run_at ASC)"
  - "INGEST_FAKE=1 env seam implemented in processJob — writes placeholder .mp4/.m4a/kf_*.jpg files in the real media directory path, no monkey-patching needed"
  - "Inline SQL comments stripped from schema.sql before splitting on semicolons to avoid false splits on '--' inside comment text"
metrics:
  duration: "~30 minutes"
  completed: "2026-05-26"
  tasks_completed: 3
  tasks_total: 4
---

# Phase 01 Plan 01: Re-platform to Bun + Ingest Spine Summary

## One-liner

SQLite-backed ingest spine: URL → deduped submission → durable job queue → yt-dlp download + ffmpeg audio/keyframe extraction + info.json metadata → findings row; CLI submit with shortcode dedup; worker loop with startup probes and exponential backoff.

## What Was Built

### Task 1 — Re-platform + Schema + Failing E2E Test (RED)
Removed all Cloudflare (`@cloudflare/containers`, `@cloudflare/workers-types`, `wrangler`) and Telegram (`grammy`) dependencies. Re-pointed `tsconfig.json` to `bun-types`. Added new package scripts (`worker`, `submit`, `migrate`, `typecheck`). Deleted all Cloudflare-bound source files (consumer, enrich, index, webhook, queries, notify). Adapted `dto.ts` to strip Telegram fields and add `source_type`. Wrote `src/db/schema.sql` (three tables + WAL pragma + dedup indexes), `src/db/db.ts` (singleton with WAL + busy_timeout), `src/db/migrate.ts` (idempotent runner), and `src/shared/config.ts` (typed process.env loader). Added `.env.example` with D-16 vars. The e2e test was written in RED state (stubs threw, test failed as required).

### Task 2 — Queue + Worker (GREEN)
- **Queue** (`src/queue/queue.ts`): `enqueue`, atomic `claimNext` (UPDATE...RETURNING), `markDone`, `markFailed` (surfaces error on submission row), `requeue` (preserves attempts), `recoverOrphaned`. All via prepared statements.
- **Download** (`src/worker/download.ts`): yt-dlp wrapper replicating `scripts/fetch-reel.ts`; arg-array Bun.spawn; glob-based video file discovery (avoids hardcoded .mp4); Chrome cookie-lock hint on Permission Denied errors; path-traversal check.
- **Media** (`src/worker/media.ts`): `extractAudio` (ffmpeg -vn -acodec copy), `extractKeyframes` (fps=1/10, scale=640:-1, max 6 frames, q:v 3); both use arg-array Bun.spawn.
- **Metadata** (`src/worker/metadata.ts`): `parseInfoJson` (channel→author_handle, description→caption, upload_date→posted_at, duration→duration_sec); all-null on corrupt/missing fields, never throws.
- **Process** (`src/worker/process.ts`): full pipeline with `INGEST_FAKE=1` env seam for sandbox testing; file-drop fallback branch; findings upsert.
- **Loop** (`src/worker/loop.ts`): startup probes for yt-dlp + ffmpeg (fail-fast with actionable messages), `recoverOrphaned`, poll loop with exponential backoff (30s × 3^(attempts-1)), structured JSON logs.
- All tests GREEN: `queue.test.ts`, `metadata.test.ts`, `spine.e2e.test.ts`.

### Task 3 — CLI Submit Command
`src/intake/cli.ts`: validates arg is an Instagram reel/p URL (URL parser + path regex), INSERT OR IGNORE with partial unique index for shortcode dedup, detects duplicate via `changes()`, enqueues on new submission. Exits non-zero for invalid URLs. Imports `parseReelShortcode` from `src/shared/instagram` (reuse).

## Test Results

| Test File | Pass | Fail | Notes |
|-----------|------|------|-------|
| test/instagram.test.ts | 7 | 0 | Reuse intact (unchanged) |
| test/queue.test.ts | 8 | 0 | Atomic claim, backoff, markFailed, recoverOrphaned |
| test/metadata.test.ts | 7 | 0 | Field mapping, corrupt input, never throws |
| test/spine.e2e.test.ts | 4 | 0 | GREEN with INGEST_FAKE=1 |
| test/transcribe.test.ts | 3 | 0 | src/enrich/parse.ts carried forward |
| test/vision.test.ts | 2 | 0 | src/enrich/parse.ts carried forward |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] INSERT OR IGNORE instead of ON CONFLICT (col) DO NOTHING**
- **Found during:** Task 3 verification
- **Issue:** `ON CONFLICT (reel_shortcode) DO NOTHING` syntax is only valid for non-partial unique indexes in SQLite. The `idx_submissions_shortcode` index is a partial index (`WHERE reel_shortcode IS NOT NULL`), so SQLite raised "does not match any PRIMARY KEY or UNIQUE constraint".
- **Fix:** Changed to `INSERT OR IGNORE` which triggers on any constraint violation including partial unique indexes.
- **Files modified:** `src/intake/cli.ts`
- **Commit:** 36773cd

**2. [Rule 1 - Bug] Schema SQL inline comments caused false semicolon splits**
- **Found during:** Task 1 migration runner
- **Issue:** `migrate.ts` split the schema SQL on `;` but inline comments like `-- epoch ms; NULL when not locked` contain semicolons, producing broken partial statements.
- **Fix:** Strip all `--` comment text from each line before splitting on `;`.
- **Files modified:** `src/db/migrate.ts`
- **Commit:** 8f0ed64

**3. [Rule 1 - Bug] Queue tests had cross-test ordering interference**
- **Found during:** Task 2 test run
- **Issue:** `claimNext` picks the oldest pending job (ORDER BY run_at ASC). Tests sharing a DB would claim jobs from prior tests.
- **Fix:** Each queue test creates its own isolated temp DB via `makeDb()`.
- **Files modified:** `test/queue.test.ts`
- **Commit:** ba7a68a

**4. [Rule 2 - Missing functionality] E2E test used same shortcode across tests**
- **Found during:** Task 1 e2e test refinement
- **Issue:** Two tests in spine.e2e.test.ts both inserted `DYeHzvgCURl` shortcode; the second triggered the UNIQUE constraint.
- **Fix:** Generate per-test unique shortcodes using `SPINE01_` + UUID prefix.
- **Files modified:** `test/spine.e2e.test.ts`
- **Commit:** 8f0ed64

## Known Stubs

- `INGEST_FAKE=1` in `src/worker/process.ts`: writes placeholder `FAKE_VIDEO_DATA`/`FAKE_AUDIO_DATA`/`FAKE_KF_*` files. This is intentional test infrastructure — the real paths use yt-dlp + ffmpeg which require live credentials. The stub is gated by the env flag and never active in production.

## Security Verification

| Threat | Status | Evidence |
|--------|--------|---------|
| T-01-01: Command injection via shell string | Mitigated | `grep -rn 'Bun.spawn("' src/worker/` returns nothing; both download.ts and media.ts use array literals |
| T-01-02: SSRF/arbitrary URL to yt-dlp | Mitigated | `isInstagramReelUrl()` in cli.ts validates hostname + path before any enqueue |
| T-01-03: Path traversal in MEDIA_DIR | Mitigated | `findVideoFile()` checks `resolvedPath.startsWith(resolvedDir + "/")` |
| T-01-04: Malformed .info.json | Mitigated | `parseInfoJson` wraps in try/catch, all fields optional, returns null metadata |
| T-01-05: Secrets in logs | Mitigated | `safeConfigSummary()` redacts GROQ_API_KEY + ANTHROPIC_API_KEY |
| T-01-06: DoS via bad/slow jobs | Mitigated | Lease 120s + max_attempts=3 + exponential backoff + recoverOrphaned |

## Checkpoint: Task 4 Pending (Human Action Required)

Task 4 is a `checkpoint:human-action` — live verification on the user's physical host with ffmpeg + Instagram browser cookies. This cannot be performed in the cloud sandbox (no ffmpeg; Instagram 403s datacenter IPs). See checkpoint report below.

## Self-Check: PASSED

Files verified:
- src/db/db.ts — FOUND
- src/db/migrate.ts — FOUND
- src/db/schema.sql — FOUND
- src/queue/queue.ts — FOUND
- src/worker/download.ts — FOUND
- src/worker/loop.ts — FOUND
- src/worker/media.ts — FOUND
- src/worker/metadata.ts — FOUND
- src/worker/process.ts — FOUND
- src/intake/cli.ts — FOUND
- test/spine.e2e.test.ts — FOUND
- test/queue.test.ts — FOUND
- test/metadata.test.ts — FOUND

Commits verified:
- 8f0ed64 — FOUND (Task 1)
- ba7a68a — FOUND (Task 2)
- 36773cd — FOUND (Task 3)
