---
phase: "01"
plan: "03"
subsystem: "capture-ingest-spine"
tags: [bun, sqlite, gallery-dl, sync, jitter, rate-limiting, cli]
dependency_graph:
  requires:
    - "01-01: SQLite schema (submissions, jobs, findings), queue (enqueue), db singleton"
    - "01-02: shared submitUrl path (src/intake/submit.ts) — sync follows same dedup pattern"
  provides:
    - "Opt-in, OFF-by-default saved-collection sync via gallery-dl (CAP-05)"
    - "gallery-dl enumeration wrapper with injectable enumerator (Bun.spawn arg array)"
    - "jitterDelay: randomized sleep between items for ban-safe pacing (RESEARCH §2)"
    - "runSync(): off-by-default guard, dedup via INSERT OR IGNORE, batch cap, graceful failure"
    - "sync CLI command (bun run sync) for manual one-shot collection sync"
  affects:
    - "src/index.ts: could wire a scheduled sync trigger in a future phase"
tech_stack:
  added:
    - "gallery-dl (PyPI, system binary) — enumeration of Instagram saved collections"
  patterns:
    - "Injectable enumerator function for test stubbing (avoids live gallery-dl in CI)"
    - "Off-by-default guard: SYNC_ENABLED=false checked first, returns disabled immediately"
    - "try/catch around gallery-dl subprocess: failure returns {status:'failed'}, never throws into worker loop"
    - "INSERT OR IGNORE + SELECT changes() dedup for source_type='sync' submissions"
key_files:
  created:
    - src/sync/saved-sync.ts
    - src/sync/cli.ts
  modified:
    - package.json
key_decisions:
  - "Gallery-dl invoked via Bun.spawn arg ARRAY (never shell string) — injection safety T-03-01"
  - "Enumerator is injectable (a parameter defaulting to the real implementation) so tests stub it without live Instagram"
  - "Dedup reuses the same INSERT OR IGNORE pattern as submitUrl (not a parallel path) — CAP-04 remains unified"
  - "No scheduler built — manual trigger only; keep it simple (RESEARCH §2 SYNC_CRON is future work)"
  - "gallery-dl failure (e.g. 572) logs + returns {status:'failed'}, NEVER rethrows — worker loop stays alive (Pitfall 5)"
patterns-established:
  - "OFF-by-default guard: check syncEnabled first, log 'sync is disabled', return immediately — zero side effects"
  - "Best-effort subprocess wrapper: non-zero exit throws inside enumerator; runSync catches + returns gracefully"
  - "Jitter between items: Math.random() * (max - min + 1) + min, then Bun.sleep — avoids fixed-interval detection"

requirements-completed: [CAP-05]

duration: ~25min
completed: 2026-05-26
---

# Phase 01 Plan 03: Opt-in Saved-Collection Sync (gallery-dl + jitter) Summary

## One-liner

Opt-in, OFF-by-default Instagram saved-collection sync: gallery-dl enumerates reel URLs via `Bun.spawn` arg array, each fed through the existing deduped submit+queue path with jittered (8–25s) batch-capped pacing; a `bun run sync` CLI triggers one manual run; gallery-dl failures are logged and returned gracefully, never crashing the worker (CAP-05).

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-26
- **Completed:** 2026-05-26
- **Tasks:** 2 of 3 tasks autonomous (Task 1 + Task 2 complete); Task 3 is a blocking-human checkpoint deferred to the user's host
- **Files modified:** 3

## Accomplishments

- `src/sync/saved-sync.ts`: gallery-dl enumeration (injectable enumerator, Bun.spawn array), jitterDelay, runSync() with off-by-default guard + batch cap + dedup + graceful 572 handling
- `src/sync/cli.ts`: manual `bun run sync` command; prints enumerated/enqueued/skipped/status; exits 0 on disabled or expected failures
- All 5 in-sandbox tests pass (off-by-default, dedup+cap, source_type='sync', graceful failure — all with stubbed enumerator; no live Instagram required)
- Full test suite: 50 / 50 pass; `bun run typecheck` clean

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add failing tests for saved-collection sync** - `6e0a6df` (test — prior session)
2. **Task 1 GREEN: gallery-dl enumeration + jittered batch sync** - `5ebb261` (feat)
3. **Task 2: sync CLI command + package.json script** - `fd0938b` (feat)
4. **Task 3: human-action checkpoint** — DEFERRED (see below)

## Files Created/Modified

- `src/sync/saved-sync.ts` — `enumerateSavedCollection` (Bun.spawn arg array), `jitterDelay`, `runSync` (off-by-default, dedup, batch cap, graceful failure); `Enumerator` + `SyncResult` + `SyncOptions` types exported
- `src/sync/cli.ts` — runnable `bun run sync` entry point; prints disabled message when SYNC_ENABLED=false; surfaces run summary (D-06)
- `package.json` — added `"sync": "bun run src/sync/cli.ts"` script

## In-Sandbox Test Results

| Test File | Pass | Fail | Notes |
|-----------|------|------|-------|
| test/saved-sync.test.ts | 5 | 0 | Off-by-default, dedup+cap, source_type, batch cap, graceful failure — stubbed enumerator |
| test/server.test.ts | 9 | 0 | Unchanged from 01-02 |
| test/watcher.test.ts | 5 | 0 | Unchanged from 01-02 |
| test/queue.test.ts | 8 | 0 | Unchanged from 01-01 |
| test/metadata.test.ts | 7 | 0 | Unchanged from 01-01 |
| test/spine.e2e.test.ts | 4 | 0 | Unchanged from 01-01 |
| test/instagram.test.ts | 7 | 0 | Unchanged from 01-01 |
| test/transcribe.test.ts | 3 | 0 | Unchanged |
| test/vision.test.ts | 2 | 0 | Unchanged |
| **Total** | **50** | **0** | `bun test` — all green |

## Decisions Made

- Injectable enumerator (`enumerator?: Enumerator` parameter defaulting to `enumerateSavedCollection`) — allows tests to stub gallery-dl without live Instagram credentials or a real saved collection. Same dependency-injection pattern used in server.test.ts (injected DB).
- No scheduler built — `SYNC_CRON` env var is documented in `.env.example` for a future phase; keeping this plan simple per user guidance.
- Dedup uses the same `INSERT OR IGNORE` + `SELECT changes()` pattern as `submitUrl` in `submit.ts` — no parallel intake logic.
- Chrome cookie lock detected from stderr text (`Permission denied` / `database is locked`) and appended as a "Close Chrome" hint in the thrown error (Pitfall 1).

## Deviations from Plan

None — plan executed exactly as written. The injectable enumerator pattern was specified in the plan's `<action>` block.

## Security Verification

| Threat | Status | Evidence |
|--------|--------|---------|
| T-03-01: Command injection via gallery-dl shell string | Mitigated | `grep -n "Bun.spawn" src/sync/saved-sync.ts` → array literal `["gallery-dl", "--cookies-from-browser", browser, "-N", "{post_url}", collectionUrl]`; no shell string |
| T-03-02: Unvalidated enumerated URLs → submit | Mitigated | `parseReelShortcode(rawUrl)` called before any DB write; non-Instagram URLs skipped with a warning |
| T-03-03: Worker crash on gallery-dl failure | Mitigated | try/catch around enumeration; 572/cookie-lock logged + returns `{status:"failed"}`; never rethrown |
| T-03-04: Instagram ban from fixed-interval pattern | Mitigated | Off by default; `SYNC_BATCH_SIZE` caps items; `jitterDelay(min, max)` uses `Math.random()` — no fixed interval |
| T-03-05: Cookie exposure in logs | Mitigated | `IG_COOKIES_BROWSER` value (browser name) is not sensitive; the actual cookies are read from the browser DB by gallery-dl at call time and never logged by this code |
| T-03-SC: No new npm packages | Confirmed | gallery-dl is a pre-installed PyPI system tool; no `npm install` or `bun add` performed |

## Checkpoint: Task 3 DEFERRED (Human Action Required — User's Host Only)

Task 3 is a `checkpoint:human-action` with `gate="blocking-human"`. It requires:

- `gallery-dl` installed (`pip install gallery-dl`) — confirmed already present on the research host at 1.32.1
- A real Instagram saved collection URL (e.g. `https://www.instagram.com/USERNAME/saved/MY-COLLECTION/12345678`)
- `IG_COOKIES_BROWSER=chrome` + Chrome **closed** before sync (Pitfall 1 cookie DB lock)
- `SYNC_ENABLED=true` in `.env`

This **cannot** be performed in this sandbox: Instagram returns 403 to datacenter IPs, gallery-dl requires browser cookies from a logged-in residential session, and no real collection URL is available here.

The autonomous behavior is fully verified in-sandbox:
- `SYNC_ENABLED=false` → no-op exit 0 (confirmed by test + manual run)
- Dedup, batch cap, graceful failure → all verified by stubbed-enumerator unit tests
- `bun run typecheck` → clean

## Known Stubs

None — all code paths are wired to the real submission + enqueue pipeline. The injectable enumerator in tests is test infrastructure, not a production stub; production callers use the default `enumerateSavedCollection` which invokes the real gallery-dl binary.

## Self-Check: PASSED

Files verified:
- src/sync/saved-sync.ts — FOUND
- src/sync/cli.ts — FOUND
- package.json (`"sync"` script) — FOUND

Commits verified:
- 6e0a6df — FOUND (Task 1 RED — saved-sync.test.ts)
- 5ebb261 — FOUND (Task 1 GREEN — saved-sync.ts)
- fd0938b — FOUND (Task 2 — cli.ts + package.json)
