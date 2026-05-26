---
phase: 01-capture-ingest-spine
verified: 2026-05-26T04:35:22Z
status: passed
score: 15/15 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 1: Capture & Ingest Spine Verification Report

**Phase Goal:** Stand up the always-on local service so capturing a reel link (CLI / localhost endpoint), dropping a video file, or (opt-in) syncing a saved Instagram collection results in downloaded media (yt-dlp + browser cookies), extracted audio + keyframes + metadata (ffmpeg), and a stored Finding record in SQLite — processed via a local durable (SQLite-backed) job queue, failures logged + surfaced.
**Verified:** 2026-05-26T04:35:22Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | User can hand a reel link to the local system (CLI / localhost endpoint) and get a completion/failure result | ✓ VERIFIED | `src/intake/cli.ts`: validates URL → INSERT OR IGNORE + `enqueue()`; `src/intake/server.ts`: `POST /submit` JSON → `submitUrl()`; `src/findings.ts`: surfaces status. Live UAT: URL submit produced finding `c3d6965f`. |
| SC-2 | When link download fails, a dropped video file lets processing continue | ✓ VERIFIED | `src/worker/process.ts` lines 74–93: `source_type='file'` branch uses `submission.file_path` directly (skips download); `src/intake/watcher.ts` + `src/intake/submit.ts` create `source_type='file'` submissions. Live UAT: drop path produced finding `3c04c872`. |
| SC-3 | A stored finding exists with the media, extracted audio, keyframes, and any caption/metadata | ✓ VERIFIED | `src/worker/process.ts` lines 153–177: `INSERT OR REPLACE INTO findings` with `media_key`, `audio_key`, `keyframe_keys` (JSON array), `author_handle`, `caption`, `posted_at`, `duration_sec`. Live UAT: finding `c3d6965f` has shortcode DYeHzvgCURl, `@rndyrbrts`, caption, .m4a + 6 keyframes. |
| SC-4 | Duplicate submissions of the same reel are skipped | ✓ VERIFIED | `src/db/schema.sql`: partial UNIQUE indexes on `reel_shortcode` and `content_hash`. `src/intake/submit.ts`: `INSERT OR IGNORE` + `changes()` check; same pattern in `src/queue/queue.ts`, `src/sync/saved-sync.ts`. `test/server.test.ts` + `test/watcher.test.ts` confirm dedup. |
| SC-5 | The intake, worker, and queue run as an always-on local service driven by env config, with failures logged and surfaced | ✓ VERIFIED | `src/index.ts`: single process starts HTTP intake + drop-folder watcher + worker loop; `src/shared/config.ts`: typed env loader with defaults; `src/worker/loop.ts`: structured JSON logs at every transition, `markFailed()` writes error to `submissions.status`/`error`; `src/findings.ts` CLI surfaces failures. Live UAT: startup banner showed `http://127.0.0.1:3000 + watch ./drop + worker poll active`. |

**Score:** 5/5 success criteria verified

---

## Per-Requirement Verdict Table

| Requirement | Verdict | Code Citation | Notes |
|-------------|---------|---------------|-------|
| **CAP-01** — Hand reel link to local system (CLI/endpoint) | ✓ VERIFIED | `src/intake/cli.ts`, `src/intake/server.ts` POST /submit, `src/intake/submit.ts:submitUrl()` | Both CLI and HTTP route validated. Live UAT confirmed. |
| **CAP-02** — Drop video file into watched folder | ✓ VERIFIED | `src/intake/watcher.ts:watchDropFolder()` (fs.watch + debounce + stable-size), `src/intake/submit.ts:submitFile()` | 5/5 watcher tests pass. Live UAT: drop path produced finding. |
| **CAP-03** — System records receipt + surfaces completion/failure | ✓ VERIFIED | `src/worker/loop.ts` structured logs; `src/queue/queue.ts:markFailed()` writes to submissions.error; `src/findings.ts` CLI prints status table | Live UAT: `bun run findings` surfaced submissions/jobs/findings. |
| **CAP-04** — Duplicate submissions skipped | ✓ VERIFIED | `src/db/schema.sql` partial UNIQUE indexes; `INSERT OR IGNORE` in `submit.ts`, `cli.ts`, `saved-sync.ts`; `changes()` check | URL dedup by shortcode; file dedup by SHA-256 content hash. Tests confirm. |
| **CAP-05** — Opt-in saved-collection sync (off by default) | ✓ VERIFIED (code+unit, live-optional) | `src/sync/saved-sync.ts:runSync()` off-by-default guard; `SYNC_ENABLED: parseBoolEnv("SYNC_ENABLED", false)`; gallery-dl Bun.spawn arg array; jitterDelay; 5/5 saved-sync tests pass | Live gallery-dl run deferred (IG 403s datacenter IPs, optional feature). Autonomous behavior fully tested with injectable stub enumerator. |
| **ING-01** — Download via yt-dlp --cookies-from-browser | ✓ VERIFIED | `src/worker/download.ts:download()` — Bun.spawn arg array with `--cookies-from-browser`, `--write-info-json`, `--merge-output-format mp4`, `--restrict-filenames` | Live UAT: 53.9 MiB reel downloaded, .mp4 produced. |
| **ING-02** — Fallback to dropped video file | ✓ VERIFIED | `src/worker/process.ts` lines 74–93: `source_type='file'` branch uses `submission.file_path` directly | Wired in processJob; tested in spine.e2e.test.ts. |
| **ING-03** — Extract audio track | ✓ VERIFIED | `src/worker/media.ts:extractAudio()` — `ffmpeg -vn -acodec copy → {shortcode}.m4a` via Bun.spawn | Live UAT: .m4a produced. Sandbox: tested via INGEST_FAKE=1 path. |
| **ING-04** — Extract representative keyframes | ✓ VERIFIED | `src/worker/media.ts:extractKeyframes()` — `ffmpeg fps=1/10,scale=640:-1 -frames:v 6` via Bun.spawn | Live UAT: 6 keyframes produced. Sandbox: tested via INGEST_FAKE=1 path. |
| **ING-05** — Capture metadata (author, caption, post date) | ✓ VERIFIED | `src/worker/metadata.ts:parseInfoJson()` maps channel→author_handle, description→caption, upload_date→posted_at, duration→duration_sec; tolerates missing fields | Live UAT: author @rndyrbrts, caption captured. 7/7 metadata tests pass. |
| **KB-01** — Each processed reel stored as a structured finding record | ✓ VERIFIED | `src/db/schema.sql` findings table; `src/worker/process.ts` `INSERT OR REPLACE INTO findings`; `src/findings.ts` read-only CLI | Live UAT: two findings rows confirmed. |
| **OPS-01** — Always-on local service (intake + worker in one process) | ✓ VERIFIED | `src/index.ts` — single Bun process: `startup()` → `startServer()` → `watchDropFolder()` → `runWorkerLoop()`; `package.json "worker": "bun run src/index.ts"` | Live UAT: startup banner showed all three subsystems. SIGINT/SIGTERM handled. |
| **OPS-02** — Local durable SQLite-backed job queue with retries | ✓ VERIFIED | `src/queue/queue.ts` — atomic `claimNext()` (UPDATE...WHERE id=SELECT...RETURNING), `requeue()` with backoff, `recoverOrphaned()`; 8/8 queue tests pass | Lease 120s, max_attempts=3, exponential backoff 30s×3^(n-1). |
| **OPS-03** — Config via environment variables | ✓ VERIFIED | `src/shared/config.ts` typed loader; `.env.example` documents DB_PATH, MEDIA_DIR, IG_COOKIES_BROWSER, HTTP_PORT, DROP_DIR, SYNC_* knobs; `safeConfigSummary()` redacts secrets | All D-16 vars present. |
| **OPS-04** — Failures logged and surfaced | ✓ VERIFIED | `src/worker/loop.ts` structured JSON logs at every job transition; `queue.ts:markFailed()` writes error to submissions.error; `src/findings.ts` CLI shows failed submissions with error text | OPS-04 "bot notification" deferred (Telegram dropped for v1 per CONTEXT Deferred); satisfied via structured logs + submissions.status/error + findings CLI. |

**15/15 requirements VERIFIED**

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/schema.sql` | DDL for submissions, jobs, findings + dedup indexes | ✓ VERIFIED | 3 tables, 5 indexes including partial UNIQUE on reel_shortcode + content_hash, WAL pragma |
| `src/queue/queue.ts` | enqueue, claimNext, markDone, markFailed, requeue, recoverOrphaned | ✓ VERIFIED | 151 lines; all 6 functions present with prepared statements |
| `src/worker/download.ts` | yt-dlp wrapper via Bun.spawn arg array | ✓ VERIFIED | `Bun.spawn(["yt-dlp", ...args])`; glob-based file discovery; Chrome cookie-lock hint |
| `src/worker/media.ts` | ffmpeg audio extraction + keyframe sampling | ✓ VERIFIED | `extractAudio()` → .m4a; `extractKeyframes()` → fps=1/10, max 6 frames; Bun.spawn arrays |
| `src/worker/metadata.ts` | parseInfoJson — tolerant of corrupt input | ✓ VERIFIED | channel→author_handle, description→caption, etc.; try/catch; all-null on error |
| `src/worker/process.ts` | processJob: full pipeline with INGEST_FAKE=1 seam | ✓ VERIFIED | Download-or-fallback → audio → keyframes → metadata → findings upsert |
| `src/worker/loop.ts` | Poll loop + startup probes + orphan recovery | ✓ VERIFIED | hasYtDlp + hasFfmpeg probes (exit 127 if missing); recoverOrphaned(); backoff |
| `src/intake/cli.ts` | CLI submit command with shortcode dedup | ✓ VERIFIED | parseReelShortcode → INSERT OR IGNORE → enqueue |
| `src/intake/server.ts` | Bun.serve 127.0.0.1-only HTTP intake | ✓ VERIFIED | hostname hardcoded to 127.0.0.1; POST /submit + POST /upload |
| `src/intake/watcher.ts` | fs.watch drop-folder with debounce + stable-size + hash dedup | ✓ VERIFIED | 1s debounce; two-stat probe; submitFile reuse |
| `src/intake/submit.ts` | Shared submitUrl + submitFile helpers | ✓ VERIFIED | Single validated path reused by CLI, HTTP, and watcher |
| `src/index.ts` | Always-on service entry (worker + HTTP + watcher) | ✓ VERIFIED | startup() → startServer() → watchDropFolder() → runWorkerLoop() |
| `src/sync/saved-sync.ts` | gallery-dl enumeration + jitter + off-by-default | ✓ VERIFIED | Bun.spawn arg array; SYNC_ENABLED guard; injectable enumerator; jitterDelay |
| `src/sync/cli.ts` | `bun run sync` manual trigger | ✓ VERIFIED | Calls runSync(); prints disabled message when SYNC_ENABLED=false |
| `src/shared/config.ts` | Typed env loader with D-16 vars + secret redaction | ✓ VERIFIED | All D-16 vars, parseBoolEnv/parseIntEnv, safeConfigSummary |
| `src/findings.ts` | Read-only findings CLI (`bun run findings`) | ✓ VERIFIED | Queries submissions + jobs + findings; shows failed submissions with error |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/intake/cli.ts` | `src/queue/queue.ts` | `enqueue()` after submission insert | ✓ WIRED | Line 74 of cli.ts: `await enqueue(submissionId, db)` |
| `src/intake/server.ts` | `src/intake/submit.ts` | `submitUrl()` / `submitFile()` | ✓ WIRED | Lines 116, 174 of server.ts delegate to submit helpers |
| `src/intake/submit.ts` | `src/queue/queue.ts` | `enqueue()` per new submission | ✓ WIRED | Lines 76, 149 of submit.ts: `await enqueue(...)` |
| `src/intake/watcher.ts` | `src/intake/submit.ts` | `submitFile()` on stable video file | ✓ WIRED | Line 150 of watcher.ts: `await submitFile(fileBytes, basename, targetDir, db)` |
| `src/index.ts` | `src/worker/loop.ts` | `startup()` + `runWorkerLoop()` | ✓ WIRED | Lines 41, 92 of index.ts |
| `src/worker/loop.ts` | `src/queue/queue.ts` | `claimNext()` in poll loop | ✓ WIRED | Line 80 of loop.ts: `const job = claimNext()` |
| `src/worker/process.ts` | `src/worker/download.ts` | `download(url, shortcode, mediaDir)` | ✓ WIRED | Line 88 of process.ts: `const result = await download(...)` |
| `src/worker/process.ts` | `src/db/db.ts` | `INSERT OR REPLACE INTO findings` | ✓ WIRED | Lines 153–177 of process.ts |
| `src/sync/saved-sync.ts` | `src/queue/queue.ts` | `enqueue()` per newly-inserted submission | ✓ WIRED | Line 206 of saved-sync.ts: `await enqueue(submissionId, db)` |
| `src/sync/saved-sync.ts` | `src/shared/instagram.ts` | `parseReelShortcode` on each enumerated URL | ✓ WIRED | Line 183 of saved-sync.ts: `const shortcode = parseReelShortcode(rawUrl)` |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/worker/process.ts` | `relativeMediaKey`, `audioKey`, `keyframeKeys`, `metadata` | yt-dlp subprocess → `download()` + ffmpeg `extractAudio()` + `extractKeyframes()` + `parseInfoJson()` | Yes — live UAT confirmed real media files + metadata populated | ✓ FLOWING |
| `src/findings.ts` | `findings[]` | `SELECT … FROM findings JOIN submissions` — real DB query | Yes — reads from populated DB | ✓ FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles clean | `bun run typecheck` | 0 errors | ✓ PASS |
| Full test suite (50 tests) | `bun test` | 50 pass / 0 fail | ✓ PASS |
| SYNC_ENABLED=false is a no-op | `SYNC_ENABLED=false bun run src/sync/cli.ts` | Logs disabled message, exit 0 | ✓ PASS |
| HTTP server binds 127.0.0.1 only | `grep -n "0.0.0.0" src/intake/server.ts` | No matches | ✓ PASS |
| yt-dlp/ffmpeg spawn as arg arrays | `grep -rn 'Bun.spawn("' src/worker/` | No matches (no shell-string spawns) | ✓ PASS |
| No Cloudflare/Telegram in codebase | `grep -rn "cloudflare\|wrangler\|grammy" src/ package.json` | No matches | ✓ PASS |

---

## Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files found; phase is a Bun app (not a migration/tooling phase with dedicated probe scripts). Live UAT evidence provided by the user is treated as authoritative.

---

## Requirements Coverage

| Requirement | Phase Declared In | Description | Status | Evidence |
|-------------|------------------|-------------|--------|---------|
| CAP-01 | 01-01-PLAN + 01-02-PLAN | URL intake (CLI + HTTP endpoint) | ✓ SATISFIED | `cli.ts`, `server.ts`, `submit.ts:submitUrl()` |
| CAP-02 | 01-02-PLAN | Drop-folder watcher | ✓ SATISFIED | `watcher.ts:watchDropFolder()` |
| CAP-03 | 01-02-PLAN | Receipt recorded + completion/failure surfaced | ✓ SATISFIED | Loop structured logs + `markFailed()` + `findings.ts` CLI |
| CAP-04 | 01-01-PLAN + 01-02-PLAN | Dedup by shortcode + content hash | ✓ SATISFIED | Partial UNIQUE indexes + INSERT OR IGNORE across all intake paths |
| CAP-05 | 01-03-PLAN | Opt-in saved-collection sync (off by default) | ✓ SATISFIED | `saved-sync.ts` SYNC_ENABLED guard; 5/5 unit tests; live run deferred (optional) |
| ING-01 | 01-01-PLAN | yt-dlp --cookies-from-browser download | ✓ SATISFIED | `download.ts`; live UAT |
| ING-02 | 01-01-PLAN + 01-02-PLAN | File-drop fallback | ✓ SATISFIED | `process.ts` source_type='file' branch |
| ING-03 | 01-01-PLAN | Audio extraction (ffmpeg) | ✓ SATISFIED | `media.ts:extractAudio()`; live UAT |
| ING-04 | 01-01-PLAN | Keyframe extraction (ffmpeg) | ✓ SATISFIED | `media.ts:extractKeyframes()`; live UAT |
| ING-05 | 01-01-PLAN | Metadata (author, caption, date) | ✓ SATISFIED | `metadata.ts:parseInfoJson()`; live UAT |
| KB-01 | 01-01-PLAN | Stored finding record | ✓ SATISFIED | `schema.sql` findings table; `process.ts` upsert; live UAT |
| OPS-01 | 01-02-PLAN | Always-on local service (single process) | ✓ SATISFIED | `index.ts`; live UAT startup banner |
| OPS-02 | 01-01-PLAN | Durable SQLite-backed queue with retries | ✓ SATISFIED | `queue.ts`; 8/8 queue tests |
| OPS-03 | 01-01-PLAN | Env-driven config | ✓ SATISFIED | `config.ts`; `.env.example` |
| OPS-04 | 01-01-PLAN | Failures logged + surfaced | ✓ SATISFIED | Loop logs + submissions.error + `findings.ts` CLI; bot notification deferred per CONTEXT Deferred |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/worker/process.ts` | 5, 26, 65, 103 | "placeholder" in INGEST_FAKE=1 block | ℹ Info | Test seam only — gated by `process.env["INGEST_FAKE"] === "1"`, never active in production. Not a production stub. |

No `TBD`, `FIXME`, or `XXX` markers found in any source file. No debt blockers.

---

## Human Verification Required

None required — all automated checks pass and live UAT evidence (provided by the user) covers the runtime behavior that the sandbox cannot exercise (yt-dlp + ffmpeg + Instagram live download). The optional CAP-05 live gallery-dl sync was not run; this is explicitly deferred as an opt-in feature that does not block phase closure.

---

## Gaps Summary

No gaps. All 15 requirements and 5 success criteria are VERIFIED with code-level evidence, in-sandbox test results (50/50 pass, typecheck clean), and live UAT evidence for runtime paths requiring system binaries + residential IP.

---

## Overall Verdict

**Phase 1: Capture & Ingest Spine — PASSED.** All 15 requirements (CAP-01..05, ING-01..05, KB-01, OPS-01..04) are delivered by substantive, wired, data-flowing code. TypeScript compiles clean, 50/50 tests pass in-sandbox, and live UAT on the user's host confirmed real reel download, audio/keyframe extraction, metadata capture, drop-folder intake, dedup, and the unified always-on service. No Cloudflare/Telegram regressions; no production stubs; no debt markers.

---

_Verified: 2026-05-26T04:35:22Z_
_Verifier: Claude (gsd-verifier)_
