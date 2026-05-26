---
phase: "01"
plan: "02"
subsystem: "capture-ingest-spine"
tags: [bun, sqlite, http, watcher, fs.watch, dedup, sha256, intake]
dependency_graph:
  requires:
    - "01-01: SQLite schema (submissions, jobs, findings), queue, worker loop, cli.ts"
  provides:
    - "Localhost-only HTTP intake endpoint (POST /submit JSON URL, POST /upload multipart)"
    - "Shared submitUrl + submitFile helpers (one validated intake path for CLI + HTTP)"
    - "Drop-folder watcher (fs.watch + debounce + stable-size + content-hash dedup)"
    - "Unified always-on service entry (worker + HTTP + watcher in one process)"
  affects:
    - "package.json: 'worker' script now points to src/index.ts"
tech_stack:
  added:
    - "Bun.serve({ hostname: '127.0.0.1' }) — localhost-only HTTP server"
    - "fs.watch (Bun-native Node compat) — drop-folder watcher, no new npm deps"
    - "crypto.subtle.digest('SHA-256') — content-hash dedup for file uploads and drops"
  patterns:
    - "Shared intake helper (submit.ts) reused by both cli.ts and server.ts — one validated path"
    - "INSERT OR IGNORE + SELECT changes() for dedup detection with partial unique indexes"
    - "Per-filename debounce timer (1s) + two-stat stable-size probe (500ms gap)"
    - "Per-file try/catch in watcher: one bad file never kills the loop (OPS-04)"
    - "SIGINT/SIGTERM clean shutdown: stop HTTP + watcher; worker lease expires naturally"
key_files:
  created:
    - src/intake/server.ts
    - src/intake/submit.ts
    - src/intake/watcher.ts
    - src/index.ts
    - test/server.test.ts
    - test/watcher.test.ts
  modified:
    - src/worker/loop.ts
    - package.json
decisions:
  - "Extract shared submitUrl/submitFile helpers into submit.ts so CLI and HTTP server use identical validated intake paths — no divergent intake logic"
  - "Watcher's onEnqueue callback is optional (for test instrumentation) — production callers pass no callback"
  - "index.ts calls startup() from loop.ts (which includes probes + orphan recovery) rather than duplicating probe logic"
  - "startup() and runWorkerLoop() exported from loop.ts; import.meta.main guard retained so loop.ts still works as a standalone script"
  - "src/index.ts: SIGINT/SIGTERM stops HTTP + watcher cleanly; worker poll loop just exits via process.exit(0)"
metrics:
  duration: "~45 minutes"
  completed: "2026-05-26"
  tasks_completed: 3
  tasks_total: 4
---

# Phase 01 Plan 02: HTTP Intake + Drop-folder Watcher + Unified Service Entry Summary

## One-liner

Localhost-only Bun.serve HTTP intake (URL + file upload dedup) + fs.watch drop-folder watcher (debounce + stable-size + SHA-256 hash dedup) + unified always-on service entry running worker loop + HTTP + watcher in one process.

## What Was Built

### Task 1 — Localhost-only HTTP Intake Endpoint (TDD: RED → GREEN)

**RED** (`test/server.test.ts`, commit `27b3202`): 9 failing tests covering URL submit, duplicate handling, non-Instagram rejection, file upload, content-hash dedup, path traversal rejection, and bind-address assertion.

**GREEN** (`src/intake/server.ts` + `src/intake/submit.ts`, commit `bae70ac`):

- **`src/intake/submit.ts`** — shared helpers used by both `cli.ts` and `server.ts`:
  - `isInstagramReelUrl()`: hostname + path regex guard (SSRF/T-02-02)
  - `submitUrl()`: `parseReelShortcode` → INSERT OR IGNORE shortcode dedup → enqueue
  - `submitFile()`: `path.basename` + separator guard (T-02-03) → SHA-256 content hash → INSERT OR IGNORE hash dedup → `Bun.write` → enqueue
  - `sha256Hex()`: `crypto.subtle.digest('SHA-256', new Uint8Array(buf))`

- **`src/intake/server.ts`** — `Bun.serve({ hostname: "127.0.0.1" })` (Security: T-02-01 — never 0.0.0.0):
  - `POST /submit` — JSON `{url}` → `submitUrl()` → 200 with `{submissionId, duplicate}`
  - `POST /upload` — multipart with `file` field → extension + MIME + size validation (500 MiB cap) → `submitFile()` → 200
  - Non-video / oversized / missing file → 4xx
  - `startServer({ db, mediaDir, port })` accepts injected DB for testability

All 9 `server.test.ts` tests pass.

### Task 2 — Drop-folder Watcher (TDD: RED → GREEN)

**RED** (`test/watcher.test.ts`, commit `b1ec520`): 5 failing tests covering single-file enqueue, burst debounce (Pitfall 6), non-video ignore, content-hash dedup (CAP-04), and growing-file stability.

**GREEN** (`src/intake/watcher.ts`, commit `b1283ac`):

- `watchDropFolder(dir, db, onEnqueue?)` — RESEARCH §4 pattern:
  - `fs.watch(dir, cb)` — Bun-native; no chokidar (no new npm deps per T-02-SC)
  - Per-filename 1s debounce: `clearTimeout` on each event, `setTimeout(1000)` reset (Pitfall 6)
  - Stable-size probe: `stat()` → `Bun.sleep(500)` → `stat()` → enqueue only if `s1.size === s2.size && size > 0`
  - On stable file: read bytes → `submitFile()` (reuses Task 1 hash dedup + path safety)
  - Video extensions: `.mp4 .mov .webm .mkv .mpeg .mpg .ogg`
  - Per-file try/catch: errors logged, watcher continues (OPS-04)
  - Returns `{ close() }` to stop the watcher + cancel pending timers

All 5 `watcher.test.ts` tests pass.

### Task 3 — Unified Always-on Service Entry

`src/index.ts` (commit `69e510e`):

1. `startup()` from `loop.ts` — migration + yt-dlp probe + ffmpeg probe + orphan recovery (exits 127 if missing)
2. `fs.mkdirSync(DROP_DIR, { recursive: true })` — ensure drop dir exists
3. `startServer({ db, mediaDir, port })` — HTTP intake on `127.0.0.1:HTTP_PORT`
4. `watchDropFolder(DROP_DIR, db)` — file watcher
5. Startup banner log: `http://127.0.0.1:PORT`, DROP_DIR, worker poll status
6. `process.on('SIGINT'/'SIGTERM')` → `watchHandle.close()` + `server.stop(true)` + `process.exit(0)`
7. `runWorkerLoop()` — blocks forever (worker poll loop)

`loop.ts` exports `startup()` and `runWorkerLoop()` (previously private functions; `import.meta.main` guard retained).

`package.json`: `"worker"` script updated from `src/worker/loop.ts` to `src/index.ts`.

**In-sandbox verify**: the process starts, runs migration, yt-dlp probe passes, then exits 127 on the ffmpeg probe (ffmpeg not installed in this sandbox — expected). The startup banner (HTTP bind + DROP_DIR + worker) is emitted on the user's host where ffmpeg is installed.

## Test Results

| Test File | Pass | Fail | Notes |
|-----------|------|------|-------|
| test/server.test.ts | 9 | 0 | URL submit, duplicate, 400 rejection, file upload, hash dedup, path traversal, 127.0.0.1 bind |
| test/watcher.test.ts | 5 | 0 | Single enqueue, burst debounce, non-video ignore, hash dedup, growing-file stability |
| test/queue.test.ts | 8 | 0 | Unchanged from 01-01 |
| test/metadata.test.ts | 7 | 0 | Unchanged from 01-01 |
| test/spine.e2e.test.ts | 4 | 0 | Unchanged from 01-01 |
| test/instagram.test.ts | 7 | 0 | Unchanged from 01-01 |
| test/transcribe.test.ts | 3 | 0 | Unchanged from 01-01 |
| test/vision.test.ts | 2 | 0 | Unchanged from 01-01 |
| **Total** | **45** | **0** | `bun test` — all green |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript errors in pre-existing server.ts/submit.ts (untracked files from prior session)**
- **Found during:** Task 1 typecheck
- **Issue:** `server.ts` had an explicit `FormData` type annotation conflicting with undici-types (from `req.formData()` return type). `submit.ts` passed `Buffer<ArrayBufferLike>` to `crypto.subtle.digest()` which expects `Uint8Array<ArrayBuffer>`.
- **Fix:** Changed type annotation to `Awaited<ReturnType<Request["formData"]>>`; changed `sha256Hex` to wrap buffer in `new Uint8Array(buf)`.
- **Files modified:** `src/intake/server.ts`, `src/intake/submit.ts`
- **Commit:** `bae70ac`

**2. [Rule 2 - Missing functionality] loop.ts private functions not importable by index.ts**
- **Found during:** Task 3 implementation
- **Issue:** `startup()` and `runWorkerLoop()` in `loop.ts` were private (not exported), so `src/index.ts` could not compose them.
- **Fix:** Added `export` to both functions. `import.meta.main` guard retained so `bun run src/worker/loop.ts` still works as a standalone script.
- **Files modified:** `src/worker/loop.ts`
- **Commit:** `69e510e`

## Checkpoint: Task 4 Pending (Human Action Required — User's Host Only)

Task 4 is a `checkpoint:human-action` with `gate="blocking-human"`. It requires:
- `ffmpeg` installed on the host (not available in this sandbox)
- A real video file dropped into `DROP_DIR` while `bun run worker` is running

This cannot be performed here. The in-process behavior tested by `watcher.test.ts` (debounce, stable-size probe, dedup, single-enqueue) is fully verified in-sandbox. The end-to-end drop→worker→Finding flow requires ffmpeg and must be confirmed on the user's host.

## Security Verification

| Threat | Status | Evidence |
|--------|--------|---------|
| T-02-01: LAN exposure via 0.0.0.0 | Mitigated | `grep -n "0.0.0.0" src/intake/server.ts` → no results; `grep "127.0.0.1" src/intake/server.ts` → matches Bun.serve hostname |
| T-02-02: SSRF via non-Instagram URL | Mitigated | `isInstagramReelUrl()` + `parseReelShortcode` in submit.ts validates before any DB write; non-Instagram URLs return 400 (confirmed by test) |
| T-02-03: Path traversal in filenames | Mitigated | `path.basename()` + `..`/separator rejection in `submitFile()`; watcher adds a separator guard too |
| T-02-04: DoS via fs.watch bursts / oversized uploads | Mitigated | Per-filename debounce + stable-size probe; 500 MiB upload cap + extension/MIME validation (4xx) |
| T-02-05: Secrets in logs | Mitigated | startup banner uses `safeConfigSummary()` which redacts GROQ_API_KEY + ANTHROPIC_API_KEY |
| T-02-SC: No new npm packages | Confirmed | watcher uses Bun-native `fs.watch`; chokidar is documented swap-in only |

## Known Stubs

None — all intake paths are wired to the real submission + enqueue pipeline. The `INGEST_FAKE=1` seam from 01-01 remains in `process.ts` for test use; it is not a stub in this plan's files.

## Self-Check: PASSED

Files verified:
- src/intake/server.ts — FOUND
- src/intake/submit.ts — FOUND
- src/intake/watcher.ts — FOUND
- src/index.ts — FOUND
- test/server.test.ts — FOUND
- test/watcher.test.ts — FOUND

Commits verified:
- 27b3202 — FOUND (Task 1 RED — server.test.ts)
- bae70ac — FOUND (Task 1 GREEN — server.ts + submit.ts)
- b1ec520 — FOUND (Task 2 RED — watcher.test.ts)
- b1283ac — FOUND (Task 2 GREEN — watcher.ts)
- 69e510e — FOUND (Task 3 — index.ts + loop.ts exports + package.json)
