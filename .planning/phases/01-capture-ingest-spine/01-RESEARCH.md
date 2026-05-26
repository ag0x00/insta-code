# Phase 1: capture-ingest-spine — Research

**Researched:** 2026-05-26
**Domain:** Local Bun + TypeScript ingest pipeline (yt-dlp, ffmpeg, bun:sqlite, fs.watch, gallery-dl)
**Confidence:** HIGH on most topics; MEDIUM on CAP-05 (saved-collection sync) due to Instagram's history of breaking third-party access

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Local-first. Single always-on host. Bun + TypeScript throughout. No Cloudflare.
- **D-02:** yt-dlp and ffmpeg are external system binaries invoked via `Bun.spawn`. Everything else runs on Bun.
- **D-03:** Long-lived Bun worker loop + thin local HTTP endpoint for URL/file submission. Process supervision is the host's concern.
- **D-04:** Three intake paths feeding one local queue: (1) watched drop-folder, (2) URL intake via CLI + local HTTP endpoint, (3) opt-in saved-collection sync.
- **D-05:** Each accepted item creates a `submission` row and enqueues a job. Telegram dropped for v1.
- **D-06:** Structured logs + per-submission status/error in SQLite; CLI prints outcome.
- **D-07:** Deduplicate URL submissions by Instagram reel shortcode; file-only submissions by content hash.
- **D-08:** Saved-collection sync is opt-in, OFF by default, cookie-based, small batches with randomized delays.
- **D-09:** Download via `yt-dlp --cookies-from-browser <browser>` (validated 2026-05-26). `scripts/fetch-reel.ts` is the seed.
- **D-10:** Fallback to user-supplied dropped file when no URL or download fails.
- **D-11:** Extract audio (ffmpeg) and representative keyframes (ffmpeg). Exact keyframe strategy is Claude's discretion.
- **D-12:** Capture metadata from yt-dlp `--write-info-json`; tolerate missing fields.
- **D-13:** SQLite via `bun:sqlite`. Two tables: `submissions` and `findings`. Store file paths, never blobs.
- **D-14:** Media/audio/keyframes are local files under `media/`, keyed by shortcode/finding-id.
- **D-15:** Local durable, SQLite-backed job queue with status tracking and retries (claim/lease + attempt-count).
- **D-16:** Config via `.env`: cookie browser, `MEDIA_DIR`, DB path, saved-sync on/off + batch/jitter knobs.
- **D-17:** Structured logging; failures logged and reflected in submission's status/error.

### Claude's Discretion
- Keyframe sampling strategy and count (scene-change vs N-evenly-spaced; image dims/format)
- SQLite table/column naming and migration approach
- `media/` key/prefix naming scheme
- Drop-folder watcher implementation and debounce/partial-write handling
- Queue claim/lease specifics (poll interval, max attempts, backoff)
- How the local HTTP intake endpoint is shaped and bound

### Deferred Ideas (OUT OF SCOPE)
- Telegram capture (local long-polling grammY bot) — dropped for v1
- Other platforms (TikTok/YouTube/X)
- Anything Cloudflare (Workers/Queues/D1/R2/Containers) — reverted
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAP-01 | User can hand an Instagram reel link to the local system (CLI / local endpoint) and have it accepted for processing | Local HTTP server (Bun.serve) on localhost only; CLI via `bun run` script; shortcode parsed from URL |
| CAP-02 | User can drop a video file into a watched local folder | `fs.watch` with debounce + stable-size check; chokidar as backup if `fs.watch` proves flaky on target host |
| CAP-03 | System records receipt and surfaces when processing completes or fails | `submissions.status` + `submissions.error` in SQLite; structured console logs; CLI prints final status |
| CAP-04 | Duplicate submissions detected and not re-processed | Unique index on `shortcode`; content hash for file drops; `ON CONFLICT DO NOTHING` in intake insert |
| CAP-05 | User can opt-in to syncing a saved Instagram collection | **gallery-dl** is recommended (see §Saved-Collection Enumeration below) |
| ING-01 | Download via `yt-dlp --cookies-from-browser` on local host | Already validated; `scripts/fetch-reel.ts` is the seed code |
| ING-02 | Fallback to user-supplied dropped file when link download fails | Submission carries `source_type` flag; worker checks for existing file path first |
| ING-03 | Extract audio track from media | `ffmpeg -i input.mp4 -vn -acodec copy output.m4a` |
| ING-04 | Extract representative keyframes from video | `ffmpeg -i input.mp4 -vf "fps=1/10,scale=640:-1" -frames:v 6 -q:v 3 frame_%03d.jpg` |
| ING-05 | Capture available metadata (author, caption, post date) when present | yt-dlp `--write-info-json` → parse `.info.json` sidecar; all fields are best-effort |
| KB-01 | Each processed reel stored as a structured finding record | `findings` table with FK to `submissions`; schema carries forward from prior art with CF deps stripped |
| OPS-01 | Always-on local service (intake + worker + web UI) on single host | Long-lived Bun process; process supervision (systemd/pm2) is user's concern |
| OPS-02 | Local durable SQLite-backed job queue with retries | `jobs` table with `status`, `locked_until`, `attempts`; atomic UPDATE claim |
| OPS-03 | Config via environment (API keys, cookie browser) | `.env` parsed by Bun natively; `process.env` with typed config loader |
| OPS-04 | Processing failures logged and surfaced | `console.error` + `submissions.status='failed'` + `submissions.error=msg` |
</phase_requirements>

---

## Summary

Phase 1 establishes the local ingest spine: three capture paths (drop-folder, URL intake, opt-in collection sync) feed a SQLite-backed job queue, which a single worker loop drains by downloading reels via yt-dlp, extracting audio and keyframes via ffmpeg, and persisting a `findings` record. Everything runs in a single Bun process on the local host using residential IP + browser cookies.

The research confirms all load-bearing mechanisms are achievable with Bun-native or well-established tooling. The biggest risk is CAP-05 (saved-collection enumeration): gallery-dl supports both `saved/` and `saved/COLLECTION-NAME/ID` URL patterns with named-collection support and a `--cookies-from-browser chrome` option, but Instagram's API for saved posts returns 572 errors intermittently (labeled "cant-fix / external-issue" by gallery-dl), so the sync feature must be treated as best-effort from day one. The queue, download, and audio/keyframe extraction are all low-risk.

The existing `src/shared/instagram.ts` (shortcode parsing) and `src/enrich/parse.ts` (Groq + Claude response parsers, `toBase64`) are runtime-agnostic and can be carried forward verbatim. Everything else in `src/` is Cloudflare-bound (`Env` bindings, D1Database, R2Bucket, Queue, Container) and must be discarded.

**Primary recommendation:** Build the worker loop and SQLite queue from scratch on `bun:sqlite` using the claim/lease pattern documented below. Reuse `scripts/fetch-reel.ts` as the download core. Use `fs.watch` (Linux, tested-working in this environment) with a 1-second debounce + stable-size probe for the drop-folder watcher. Use gallery-dl for CAP-05 enumeration only (not download — yt-dlp handles the actual download step).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| URL intake (CAP-01) | API / Local HTTP | CLI script | HTTP endpoint is the durable intake surface; CLI is a thin wrapper |
| Drop-folder watching (CAP-02) | Local process (worker) | — | fs.watch runs inside the worker Bun process |
| Status reporting (CAP-03) | Database / Storage | Console / Logs | SQLite is the durable record; logs are ephemeral |
| Deduplication (CAP-04) | Database / Storage | — | Unique index constraint enforces idempotency at the DB layer |
| Collection sync (CAP-05) | Local process (scheduler) | External tool (gallery-dl) | gallery-dl enumerates; yt-dlp downloads; Bun orchestrates both |
| Download (ING-01) | Local process (worker) | — | yt-dlp subprocess via Bun.spawn |
| Audio extraction (ING-03) | Local process (worker) | — | ffmpeg subprocess via Bun.spawn |
| Keyframe extraction (ING-04) | Local process (worker) | — | ffmpeg subprocess via Bun.spawn |
| Metadata capture (ING-05) | Local process (worker) | — | Parsed from yt-dlp's `.info.json` sidecar |
| Finding record (KB-01) | Database / Storage | — | `findings` table, `bun:sqlite` |
| Job queue (OPS-02) | Database / Storage | Local process (worker) | SQLite stores durable state; worker loop drains it |
| Config (OPS-03) | Local process | — | `process.env` + `.env` file (Bun loads `.env` natively) |

---

## Standard Stack

### Core (all Bun-native or system binaries — zero new npm packages required)

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| Bun runtime | 1.3.11 (installed) | TypeScript execution, HTTP server, file I/O, SQLite | Project convention; `CLAUDE.md` mandates Bun |
| `bun:sqlite` | built-in | Durable job queue + findings/submissions storage | Built into Bun; no dependency; replaces D1 |
| `Bun.spawn` | built-in | Invoke yt-dlp and ffmpeg as subprocesses | No shell injection risk; clean arg array |
| `Bun.serve` | built-in | Local HTTP intake endpoint (localhost-only) | Built-in HTTP server |
| `fs.watch` (Node compat) | built-in | Drop-folder watching | Tested-working on this Linux host (see §Drop-Folder Watcher) |
| `yt-dlp` | 2026.03.17 (installed) | Download reels via browser cookies | Validated working (D-09) |
| `ffmpeg` | system binary | Audio extraction + keyframe sampling | Standard; must be installed on host |

### Optional / CAP-05 Only (Python tools for collection enumeration)

| Component | Version | Purpose | Install |
|-----------|---------|---------|---------|
| `gallery-dl` | 1.32.1 (installed) | Enumerate Instagram saved collection into post URLs | `pip install gallery-dl` |
| `instaloader` | 4.15.1 (installed) | Alternative enumeration via Python API | `pip install instaloader` |

### When to Add chokidar (conditional)

| Library | Version | slopcheck | When to Use |
|---------|---------|-----------|-------------|
| `chokidar` | 5.0.0 | [OK] | Only if `fs.watch` proves unreliable on the user's target host (macOS APFS quirks, Docker volumes). On this Linux environment, `fs.watch` fires correctly for new files — chokidar is not needed. |

**Installation (if chokidar is needed):**
```bash
bun add chokidar
```

---

## Package Legitimacy Audit

> This phase is primarily Bun-native with no new npm dependencies. The only conditional npm package is `chokidar`.

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `chokidar` | npm | 13+ years (2012) | github.com/paulmillr/chokidar | [OK] | Approved (conditional — add only if fs.watch proves unreliable) |
| `readdirp` (chokidar dep) | npm | 10+ years | github.com/paulmillr/readdirp | [OK] | Approved |
| `gallery-dl` | PyPI | 8+ years | github.com/mikf/gallery-dl | [VERIFIED: PyPI] | Approved (CAP-05 only) |
| `instaloader` | PyPI | 8+ years | github.com/instaloader/instaloader | [VERIFIED: PyPI] | Approved (alternative for CAP-05) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────────────────┐
                        │              Bun Process (single host)       │
                        │                                              │
  URL paste / CLI  ────►│  Intake Surface                             │
                        │  ┌─────────────────────────────────────┐    │
  file drop       ────►│  │  HTTP endpoint (Bun.serve localhost) │    │
                        │  │  CLI command (bun run submit <url>) │    │
  gallery-dl      ────►│  │  Drop-folder watcher (fs.watch)     │    │
  (opt-in sync)        │  └──────────────┬──────────────────────┘    │
                        │                 │ INSERT submission row      │
                        │                 ▼                            │
                        │  ┌───────────────────────────────────────┐  │
                        │  │     SQLite (bun:sqlite)               │  │
                        │  │   submissions | jobs | findings        │  │
                        │  └───────────────┬───────────────────────┘  │
                        │                  │ claim next job (UPDATE)   │
                        │                  ▼                            │
                        │  ┌───────────────────────────────────────┐  │
                        │  │       Worker Loop (poll/sleep)        │  │
                        │  │  1. Claim job (atomic UPDATE)         │  │
                        │  │  2. Download (Bun.spawn yt-dlp)       │  │  ──► local media/
                        │  │     OR use dropped file path          │  │
                        │  │  3. Extract audio (Bun.spawn ffmpeg)  │  │  ──► media/{id}.m4a
                        │  │  4. Extract keyframes (ffmpeg)        │  │  ──► media/{id}/kf_*.jpg
                        │  │  5. Parse .info.json → metadata       │  │
                        │  │  6. INSERT/UPDATE findings row        │  │
                        │  │  7. Mark job done / failed            │  │
                        │  └───────────────────────────────────────┘  │
                        └─────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── db/
│   ├── schema.sql          # DDL for submissions, jobs, findings
│   ├── migrations/         # Ordered migration SQL files
│   └── db.ts               # open() → Database singleton + WAL pragma
├── queue/
│   └── queue.ts            # enqueue(), claimNext(), markDone(), markFailed()
├── intake/
│   ├── server.ts           # Bun.serve() local HTTP endpoint
│   ├── cli.ts              # CLI submission command
│   └── watcher.ts          # fs.watch drop-folder watcher + debounce
├── worker/
│   ├── loop.ts             # Main worker poll loop
│   ├── download.ts         # yt-dlp wrapper (based on scripts/fetch-reel.ts)
│   ├── media.ts            # ffmpeg: audio extraction, keyframe sampling
│   └── metadata.ts         # Parse .info.json sidecar → ReelMetadata
├── sync/
│   └── saved-sync.ts       # CAP-05: gallery-dl enumeration + batch/jitter loop
├── shared/
│   ├── instagram.ts        # KEEP — shortcode parsing (runtime-agnostic)
│   ├── types.ts            # Replace with local types (no Cloudflare bindings)
│   └── config.ts           # process.env typed config loader
scripts/
├── fetch-reel.ts           # Original validated script — used as reference only
media/                      # Git-ignored; local media files
.env                        # Git-ignored; runtime config
```

---

## Key Research Findings

### 1. CAP-05: Saved-Collection Enumeration

**Recommendation: gallery-dl** [CITED: gallery-dl GitHub extractor source]

gallery-dl 1.32.1 supports two relevant URL patterns for Instagram saved content:

| Pattern | URL Format | gallery-dl Extractor |
|---------|-----------|---------------------|
| All saved posts | `https://www.instagram.com/USERNAME/saved/` | `InstagramSavedExtractor` |
| Specific named collection | `https://www.instagram.com/USERNAME/saved/COLLECTION-NAME/COLLECTION-ID` | `InstagramCollectionExtractor` |

The `InstagramCollectionExtractor` captures `collection_name` and `collection_id` from the URL — so named collections ARE supported. The collection URL (including the numeric ID) can be copied from the browser address bar when viewing the collection.

**To enumerate post URLs without downloading media:**
```bash
# List all Instagram reel/post shortcode URLs from a named collection
gallery-dl \
  --cookies-from-browser chrome \
  -N "{post_url}" \
  "https://www.instagram.com/USERNAME/saved/COLLECTION-NAME/12345678"
```

Output: one Instagram URL per line (e.g., `https://www.instagram.com/reel/DYeHzvgCURl/`). These URLs feed directly into the existing yt-dlp download path.

**For all saved posts (unnamed):**
```bash
gallery-dl --cookies-from-browser chrome -N "{post_url}" \
  "https://www.instagram.com/USERNAME/saved/"
```

**Key fields available in gallery-dl format strings:** `{post_url}`, `{post_shortcode}`, `{shortcode}`, `{user[username]}`, `{date}`.

**Known reliability risk:** Instagram's `api/v1/feed/saved/posts/` endpoint has returned 572 errors (labeled "cant-fix / external-issue" by gallery-dl maintainers). This means saved-sync may silently fail after an Instagram API change. The implementation must catch gallery-dl subprocess errors and surface them in logs without crashing the worker. [CITED: github.com/mikf/gallery-dl/issues/8738]

**Why NOT instaloader for this:** Instaloader does support `:saved` but does NOT support individual named collections (feature request open since 2020, no implementation). [CITED: github.com/instaloader/instaloader/issues/544]. It also has flakier cookie import with Chrome (multiple open issues). Gallery-dl is the better fit.

**Cookie sharing:** gallery-dl `--cookies-from-browser chrome` reads Chrome's cookie DB directly using the same mechanism as yt-dlp. Both tools access the same Chrome profile. **Chrome must be closed** when either tool reads cookies (the DB is locked by a running Chrome process). This is the same landmine already documented for yt-dlp.

**Install:** Both gallery-dl and instaloader are already installed on this host (`pip install gallery-dl`). They are Python 3 tools — no conflict with Bun.

### 2. Ban-Safe Pacing for CAP-05 (OPS caution)

Instagram's detection systems analyze request velocity, fixed-interval patterns, and session age. Key findings: [CITED: community research synthesis]

- **Maximum safe rate:** ~50 requests per hour from a single residential IP + session = ~1 request per 72 seconds
- **Fixed-interval pattern is a primary detection signal** — always add ±50% jitter to any sleep
- **Batch size:** 10 items per sync run is a conservative, safe default for a single personal account
- **Inter-item delay:** randomize between 8–25 seconds per item (well under the 72-second maximum)
- **Inter-run gap:** at minimum 30 minutes between sync runs

**Concrete default config (in `.env`):**
```bash
SYNC_ENABLED=false
SYNC_BATCH_SIZE=10
SYNC_DELAY_MIN_MS=8000
SYNC_DELAY_MAX_MS=25000
SYNC_CRON="0 */2 * * *"   # run at most every 2 hours if enabled
```

**Worker implementation sketch:**
```typescript
async function jitterDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await Bun.sleep(ms);
}
```

The sync loop must be wrapped in a try/catch; a gallery-dl 572 / connection error should log the error and halt the sync run (not retry in a tight loop).

### 3. Local Durable SQLite-Backed Job Queue (OPS-02)

**Schema:** Three-table approach — `submissions` (intake log), `jobs` (queue), `findings` (output record).

The `jobs` table is the durable queue. Key columns:

```sql
-- Open the DB with WAL mode immediately after connect
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,            -- crypto.randomUUID()
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_until INTEGER,                     -- Unix epoch ms; NULL when not locked
  run_at       INTEGER NOT NULL,            -- Unix epoch ms; for deferred/retry scheduling
  created_at   INTEGER NOT NULL,            -- Unix epoch ms
  updated_at   INTEGER NOT NULL,            -- Unix epoch ms
  error        TEXT                         -- last error message
);

CREATE INDEX IF NOT EXISTS idx_jobs_claimable
  ON jobs (status, run_at, locked_until)
  WHERE status IN ('pending', 'processing');
```

**Atomic claim query (the core of the queue):**

SQLite serializes writers, so a single `UPDATE ... RETURNING` is atomic. No `FOR UPDATE SKIP LOCKED` is needed.

```sql
UPDATE jobs
SET
  status       = 'processing',
  locked_until = unixepoch('now', 'subsec') * 1000 + 120000, -- 2-min lease
  attempts     = attempts + 1,
  updated_at   = unixepoch('now', 'subsec') * 1000
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending'
    AND run_at <= unixepoch('now', 'subsec') * 1000
  ORDER BY run_at ASC
  LIMIT 1
)
RETURNING id, submission_id, attempts;
```

If `changes()` returns 0, no job was available — sleep and retry.

**Bun implementation (TypeScript):**
```typescript
import { Database } from "bun:sqlite";

const db = new Database("./reel-atlas.db");
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA busy_timeout = 5000");

const claimStmt = db.prepare(`
  UPDATE jobs
  SET status = 'processing',
      locked_until = unixepoch('now','subsec') * 1000 + 120000,
      attempts = attempts + 1,
      updated_at = unixepoch('now','subsec') * 1000
  WHERE id = (
    SELECT id FROM jobs
    WHERE status = 'pending'
      AND run_at <= unixepoch('now','subsec') * 1000
    ORDER BY run_at ASC LIMIT 1
  )
  RETURNING id, submission_id, attempts
`);

function claimNext(): { id: string; submission_id: string; attempts: number } | null {
  return claimStmt.get() as { id: string; submission_id: string; attempts: number } | null;
}
```

**Worker loop:**
```typescript
const POLL_INTERVAL_MS = 2_000;

async function runWorkerLoop(): Promise<never> {
  while (true) {
    const job = claimNext();
    if (!job) {
      await Bun.sleep(POLL_INTERVAL_MS);
      continue;
    }
    try {
      await processJob(job.submission_id);
      markJobDone(job.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (job.attempts >= MAX_ATTEMPTS) {
        markJobFailed(job.id, msg);
      } else {
        // Exponential backoff: 30s, 90s, 270s ...
        const backoffMs = 30_000 * Math.pow(3, job.attempts - 1);
        requeueJob(job.id, msg, backoffMs);
      }
    }
  }
}
```

**Retry/backoff:** requeue by setting `status = 'pending'` and `run_at = now + backoffMs`. Do NOT reset `attempts` — the attempt counter is cumulative.

**Lease recovery:** on startup, reset any jobs with `status = 'processing'` and `locked_until < now()` back to `status = 'pending'` — these are orphaned from a prior crash.

### 4. Drop-Folder Watcher (CAP-02)

**Recommendation: `fs.watch` with debounce + stable-size probe** [VERIFIED: tested on this host]

Testing on this Linux environment (Bun 1.3.11) confirms that `fs.watch` fires `rename` events for new files created in a watched directory after the watcher starts. The known Bun bug (issue #23992, closed as dup of #3657) does NOT reproduce here — however, to be safe, the implementation should not rely on a single event.

**Robust pattern:**
1. `fs.watch(dir, callback)` fires on `rename` (file created/deleted) or `change` (modified).
2. Debounce per-filename: reset a 1-second timer on each event for the same filename.
3. After the debounce settles, **probe file size stability**: `stat()` the file, wait 500ms, `stat()` again — if size is unchanged and the file is readable, it's fully written.
4. Enqueue only if the file passes the stability check and is not already in the DB (hash dedup).

```typescript
import fs from "fs";
import path from "path";

function watchDropFolder(dir: string, onFile: (filePath: string) => void): void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  fs.watch(dir, (event, filename) => {
    if (!filename) return;
    const ext = path.extname(filename).toLowerCase();
    if (![".mp4", ".mov", ".webm", ".mkv"].includes(ext)) return;

    // Debounce per filename
    clearTimeout(timers.get(filename));
    timers.set(
      filename,
      setTimeout(async () => {
        timers.delete(filename);
        const filePath = path.join(dir, filename);
        // Stable-size probe
        try {
          const s1 = await fs.promises.stat(filePath);
          await Bun.sleep(500);
          const s2 = await fs.promises.stat(filePath);
          if (s1.size === s2.size && s2.size > 0) {
            onFile(filePath);
          }
        } catch {
          // File was removed or never completed — ignore
        }
      }, 1_000),
    );
  });
}
```

**If the target host has Docker volumes or macOS APFS quirks:** add chokidar (`bun add chokidar`, slopcheck: [OK]). The API is identical in shape and the stable-size probe logic is unchanged.

**Landmine — Chrome cookie DB lock:** Already documented. yt-dlp AND gallery-dl require Chrome to be closed when extracting cookies. A locked SQLite cookie DB causes a silent failure with an error like `[Errno 13] Permission denied`. Log the error clearly and suggest the user close Chrome.

### 5. yt-dlp Metadata Fields (ING-01, ING-05)

Confirmed from yt-dlp extractor source (`yt_dlp/extractor/instagram.py`) [VERIFIED: yt-dlp GitHub source]:

| info.json field | Meaning | Reliable for IG? |
|-----------------|---------|-----------------|
| `id` | Instagram shortcode (e.g., `DYeHzvgCURl`) | Yes — this IS the shortcode |
| `channel` | Owner's @username (handle) | Yes |
| `uploader` | Owner's full display name | Usually; may be empty |
| `description` | Post caption text | Yes when cookie-authenticated |
| `timestamp` | Unix epoch int (post date) | Yes when cookie-authenticated |
| `upload_date` | YYYYMMDD string derived from `timestamp` | Yes (yt-dlp derives it automatically) |
| `duration` | Video length in seconds (float) | Yes |

**Mapping to `ReelMetadata`:**
```typescript
interface ReelMetadata {
  author_handle: string | null;  // → info["channel"]
  caption: string | null;        // → info["description"]
  posted_at: string | null;      // → info["upload_date"] (YYYYMMDD) or null
  duration_sec: number | null;   // → info["duration"]
}
```

**Output template:** The existing `scripts/fetch-reel.ts` uses `-o "%(id)s.%(ext)s"` with `--restrict-filenames`. This produces:
- Video: `{MEDIA_DIR}/{shortcode}.mp4` (or `.webm` if not merged)
- Info JSON: `{MEDIA_DIR}/{shortcode}.info.json`

The sidecar is always at `{MEDIA_DIR}/{id}.info.json` where `id` is the shortcode. Parse with `JSON.parse(await Bun.file(jsonPath).text())`.

**Key yt-dlp flags for the worker:**
```bash
yt-dlp \
  --no-playlist \
  --retries 3 \
  --sleep-requests 1 \
  --write-info-json \
  --restrict-filenames \
  --cookies-from-browser chrome \
  -o "MEDIA_DIR/%(id)s.%(ext)s" \
  "<reel-url>"
```

### 6. ffmpeg: Audio Extraction and Keyframe Sampling (ING-03, ING-04)

**Note: ffmpeg is NOT currently installed on this host.** The plan must include a verification step that errors clearly if ffmpeg is missing, and the setup instructions must include `apt install ffmpeg` (or equivalent). [VERIFIED: tested via `which ffmpeg`]

**Audio extraction (copy, no transcode):**
```bash
ffmpeg -i "input.mp4" -vn -acodec copy "output.m4a" -y
```
This is instant (no re-encoding) and preserves quality. Output file: `media/{shortcode}.m4a`.

**Keyframe sampling — recommended: evenly-spaced, 6 frames, 640px wide:**
```bash
ffmpeg -i "input.mp4" \
  -vf "fps=1/10,scale=640:-1" \
  -frames:v 6 \
  -q:v 3 \
  "media/{shortcode}/kf_%03d.jpg" -y
```

- `fps=1/10`: one frame every 10 seconds — for a 60s reel this gives 6 frames
- `scale=640:-1`: 640px wide, aspect-ratio-preserving height — good balance for Claude Vision
- `-frames:v 6`: hard cap to avoid very long videos producing too many frames
- `-q:v 3`: JPEG quality 3 (1=best, 31=worst); 2–4 is the typical range for thumbnails
- Output: `media/{shortcode}/kf_001.jpg`, `kf_002.jpg`, etc.

**Claude's discretion note:** Scene-change detection (`select=gt(scene\,0.4)`) produces more representative frames for fast-cut reels but results in a variable number of frames. Evenly-spaced is simpler and predictable. Recommended: start with evenly-spaced; switch to scene-change if frame quality proves poor.

**Keyframe path scheme:**
```
media/
  {shortcode}.mp4          ← original video
  {shortcode}.info.json    ← yt-dlp metadata sidecar
  {shortcode}.m4a          ← extracted audio
  {shortcode}/
    kf_001.jpg             ← keyframes
    kf_002.jpg
    ...
```

Store `keyframe_keys` in the `findings` row as a JSON array of relative paths or filenames.

### 7. Reuse Analysis: Existing `src/` Code

| File | Reuse? | Reason |
|------|--------|--------|
| `src/shared/instagram.ts` | **YES — carry forward verbatim** | Pure regex functions; no Cloudflare deps; existing tests pass |
| `src/enrich/parse.ts` | **YES — carry forward verbatim** | `parseGroqVerboseJson`, `parseClaudeVision`, `toBase64` are runtime-agnostic; needed in Phase 2 |
| `src/db/schema.sql` | **ADAPT** | Schema is good but `submissions` has Telegram-specific columns (`telegram_chat_id`, `telegram_message_id`); strip those, add `source_type` |
| `src/db/queries.ts` | **DISCARD** | All functions use `D1Database` (Cloudflare type); rewrite with `bun:sqlite` Statement API |
| `src/shared/dto.ts` | **ADAPT** | Good type shapes; strip `JobMessage.telegramChatId`, `EnrichJob.telegramChatId`; keep Finding, ReelMetadata, TranscriptResult, VisionResult |
| `src/shared/types.ts` | **DISCARD** | Imports `@cloudflare/containers` and defines `Env` with D1/R2/Queue/Container bindings |
| `src/shared/notify.ts` | **DISCARD** | Telegram-only; replaced by structured logs + submission.status |
| `src/consumer/index.ts` | **DISCARD** | Cloudflare Queue consumer; replaced by local worker loop |
| `src/webhook/bot.ts` | **DISCARD** | Telegram/grammY webhook; Telegram dropped for v1 |
| `src/enrich/transcribe.ts` | **DISCARD in Phase 1** | References `env.MEDIA.get()` (R2); will be rewritten in Phase 2 |
| `src/enrich/vision.ts` | **DISCARD in Phase 1** | Same R2 dependency; Phase 2 |
| `src/index.ts` | **DISCARD** | Cloudflare Worker entry point |
| `scripts/fetch-reel.ts` | **REFERENCE** | The validated yt-dlp wrapper; `download.ts` should replicate/embed this logic |
| `test/instagram.test.ts` | **KEEP** | Already tests the reusable shortcode parsing |

**Existing test infrastructure:** `bun test` is the runner (per `CLAUDE.md`). Existing tests in `test/` use `bun:test` — this is the correct framework to continue with. The `tsconfig.json` currently has `"types": ["@cloudflare/workers-types"]` — this must be updated to `"types": ["bun-types"]`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP server | Custom `net.createServer` TCP server | `Bun.serve()` | Built-in; handles HTTP/1.1 properly |
| SQLite connection pooling | Manual connection pool | Single `bun:sqlite` Database instance | SQLite is single-writer; one connection is correct |
| Cookie extraction from Chrome | Custom DPAPI/AES-GCM decryption | `yt-dlp --cookies-from-browser` or `gallery-dl --cookies-from-browser` | Chrome's cookie DB uses OS-specific encryption; both tools handle this |
| Saved collection enumeration | Instagram Private API calls | `gallery-dl` | gallery-dl maintains the reverse-engineered API surface and handles pagination, cursor state, and auth |
| Atomic job claiming | Advisory locks or app-level mutexes | SQLite `UPDATE ... WHERE id = (SELECT id ... LIMIT 1) RETURNING` | SQLite serializes writers; one atomic UPDATE is correct and race-free |
| File-write completion detection | Polling loop with timeouts | Stable-size probe (two `stat()` calls 500ms apart) | Simple and works reliably for local file copies and ffmpeg output |
| Subprocess management | `child_process.exec` shell strings | `Bun.spawn(["yt-dlp", ...args])` | No shell injection; clean arg array; no globbing surprises |

---

## Common Pitfalls

### Pitfall 1: Chrome Cookie DB Lock
**What goes wrong:** `gallery-dl --cookies-from-browser chrome` and `yt-dlp --cookies-from-browser chrome` fail with `[Errno 13] Permission denied` or a SQLite "database is locked" error.
**Why it happens:** Chrome holds an exclusive lock on its `Cookies` SQLite DB while running.
**How to avoid:** Document in the README: "Chrome must be closed before running collection sync." The sync scheduler should detect this error and emit a clear message (`"Close Chrome before running saved-collection sync"`) rather than a generic failure.
**Warning signs:** Exit code != 0 from yt-dlp/gallery-dl; stderr contains "Permission denied" or "database is locked".

### Pitfall 2: yt-dlp Output File Format Mismatch
**What goes wrong:** The worker expects `{MEDIA_DIR}/{shortcode}.mp4` but yt-dlp produces `{MEDIA_DIR}/{shortcode}.webm` or a `.NA.` filename (when `--restrict-filenames` sanitizes the ID).
**Why it happens:** Instagram sometimes serves VP9/webm; the actual file extension depends on available formats. Without `--merge-output-format`, yt-dlp may produce `.webm`. The `--restrict-filenames` flag can also alter characters in the ID.
**How to avoid:** After yt-dlp exits successfully, glob `{MEDIA_DIR}/{shortcode}.*` to find the video file rather than hardcoding the extension. Alternatively, add `--merge-output-format mp4` to force MP4 output (requires ffmpeg to be installed).
**Warning signs:** File not found at expected path after successful yt-dlp exit.

### Pitfall 3: Missing ffmpeg
**What goes wrong:** The worker crashes on the audio/keyframe step with `ENOENT` or `command not found`.
**Why it happens:** ffmpeg is NOT installed on this host. The plan must include an explicit install step.
**How to avoid:** At worker startup, probe `ffmpeg -version` (same pattern as `hasYtDlp()` in `scripts/fetch-reel.ts`). Fail fast with a clear error if ffmpeg is missing.
**Warning signs:** Worker exits immediately after download with cryptic spawn error.

### Pitfall 4: SQLite "database is locked" Under Worker Restart
**What goes wrong:** The worker crashes mid-job, is restarted, and the DB is in a locked state (or the job is stuck in `processing`).
**Why it happens:** A crash while holding a write transaction can leave the WAL in an intermediate state; jobs with `status='processing'` and an expired `locked_until` are orphaned.
**How to avoid:** On startup, run:
```sql
UPDATE jobs SET status = 'pending', locked_until = NULL
WHERE status = 'processing' AND locked_until < unixepoch('now','subsec') * 1000;
```
Also set `PRAGMA busy_timeout = 5000` to auto-retry on locks. WAL mode (`PRAGMA journal_mode = WAL`) allows readers and one writer concurrently.

### Pitfall 5: gallery-dl 572 Error on Saved Posts
**What goes wrong:** The sync run exits with a gallery-dl error and no URLs are enumerated.
**Why it happens:** Instagram intermittently returns 572 to the saved-posts API endpoint; labeled "external-issue / cant-fix" by gallery-dl maintainers.
**How to avoid:** Treat gallery-dl non-zero exit as a warning, not a hard failure. Log the stderr, update the sync run's status in SQLite, and schedule the next sync at the normal interval (not immediately). Never crash the worker on this.

### Pitfall 6: Duplicate Submissions from fs.watch Event Bursts
**What goes wrong:** The same file is enqueued multiple times because `fs.watch` fires several events during a single copy operation.
**Why it happens:** `cp` or file manager triggers `rename` + multiple `change` events.
**How to avoid:** Per-filename debounce (1-second timer, reset on each event) + content hash dedup at the DB level (unique index on `content_hash`). The DB constraint is the last line of defense.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | All | Yes | 1.3.11 | — |
| yt-dlp | ING-01 | Yes | 2026.03.17 | Manual file drop (ING-02) |
| ffmpeg | ING-03, ING-04 | **No** | — | **None — blocking; must install** |
| Python 3 | CAP-05 (gallery-dl) | Yes | 3.11.15 | — |
| gallery-dl | CAP-05 | Yes (installed) | 1.32.1 | instaloader (less capable for named collections) |
| Chrome | Cookie auth | Not verified here (dev host) | — | Other browser via `IG_COOKIES_BROWSER` |

**Missing dependencies with no fallback:**
- `ffmpeg` — **must be installed before the worker can process any job** (`apt install ffmpeg` or `brew install ffmpeg`). Plan must include a setup/install task.

**Missing dependencies with fallback:**
- Chrome (for cookies): user can set `IG_COOKIES_BROWSER=firefox` if Chrome is not the logged-in browser.

---

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1` in `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Single-user local tool; no auth surface |
| V3 Session Management | No | No web sessions in Phase 1 |
| V4 Access Control | Partial | HTTP endpoint must bind to `127.0.0.1` only, never `0.0.0.0` |
| V5 Input Validation | Yes | Validate reel URLs before passing to yt-dlp; use arg array (not shell string) |
| V6 Cryptography | No | Content hash (SHA-256 via `crypto.subtle`) for dedup only — not security-sensitive |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell injection via reel URL | Tampering | `Bun.spawn(["yt-dlp", ...args])` — never `exec(shellString)` |
| Path traversal in drop-folder (malicious filenames) | Tampering | `path.basename()` the filename before joining with dir; reject filenames with `..` |
| Accidental LAN exposure of HTTP intake | Elevation of Privilege | Bind `Bun.serve` to `127.0.0.1:PORT` not `0.0.0.0`; document this explicitly |
| Secrets in logs | Info Disclosure | Log `[REDACTED]` for API keys; never log `process.env` wholesale |
| Malformed `.info.json` | Tampering | Parse with `try/catch`; treat all fields as optional strings; tolerate corrupt JSON |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Chrome must be closed for gallery-dl `--cookies-from-browser chrome` to succeed | Pitfall 1, CAP-05 | Might work on some OS versions with different locking behavior — low risk |
| A2 | `fs.watch` fires correctly for new files on the user's production host (not just this dev host) | Drop-Folder Watcher | If the target is Docker-on-macOS or network FS, `fs.watch` may be unreliable → add chokidar |
| A3 | gallery-dl `--cookies-from-browser chrome` works on the user's host without Permission denied errors | CAP-05 | If Chrome uses OS keyring on Linux (Gnome Keyring / KWallet), decryption may fail; fallback is to export cookies.txt via browser extension |
| A4 | yt-dlp produces `.mp4` output for all IG reels (not `.webm`) | ING-01 | Some reels may be VP9-only → glob for actual file rather than hardcoding extension |
| A5 | gallery-dl saved posts enumeration is functional at plan-execution time | CAP-05 | Instagram API changes could break it; treat sync as best-effort, always test before relying on it |

---

## Open Questions

1. **Production host OS and filesystem**
   - What we know: dev host is Linux; `fs.watch` works here
   - What's unclear: target production host OS (home server? VPS?)
   - Recommendation: plan includes a `bun run test:watch` smoke test for the watcher; if it fails, the plan adds chokidar

2. **Collection URL discovery for CAP-05**
   - What we know: gallery-dl needs the full URL including numeric collection ID (`/saved/COLLECTION-NAME/12345678`)
   - What's unclear: the user may not know how to find the numeric ID
   - Recommendation: document the "open collection in browser, copy URL from address bar" workflow in README; alternatively implement an enumeration mode that lists all collections (`/saved/` without collection ID)

3. **yt-dlp merge format**
   - What we know: yt-dlp may produce `.webm` for some reels
   - What's unclear: whether the user prefers MP4 or is fine with format-agnostic handling
   - Recommendation: add `--merge-output-format mp4` to the yt-dlp args (requires ffmpeg); document that this is why ffmpeg is a hard dependency

---

## Sources

### Primary (HIGH confidence)
- yt-dlp/yt-dlp GitHub — `yt_dlp/extractor/instagram.py` — Instagram info.json field mapping [VERIFIED: inspected source via pip install]
- yt-dlp/yt-dlp GitHub — `YoutubeDL.process_ie_result` — `upload_date` derivation from `timestamp` [VERIFIED: source inspection]
- mikf/gallery-dl GitHub — `gallery_dl/extractor/instagram.py` — URL patterns, collection support, field names [VERIFIED: source inspection + `gallery-dl --list-extractors`]
- gallery-dl 1.32.1 `--help` output — `-g`, `-N`, `--simulate`, `--cookies-from-browser` flags [VERIFIED: live tool]
- instaloader 4.15.1 `--help` output — `:saved`, `--load-cookies`, named collection gap [VERIFIED: live tool]
- Bun `fs.watch` behavior — tested live on this host (new-file events, multi-event burst during write) [VERIFIED: Bash testing]
- bun:sqlite WAL mode + `PRAGMA` [CITED: bun.com/docs/runtime/sqlite]
- slopcheck [OK] verdict for `chokidar` 5.0.0 and `readdirp` [VERIFIED: slopcheck run]

### Secondary (MEDIUM confidence)
- SQLite atomic `UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING` claim pattern [CITED: dev.to SQLite queue articles; cross-referenced with SQLite serialized-writer guarantee]
- Instagram rate-limit and ban-risk guidance (50 req/hour, randomized delays) [CITED: multiple community sources; consistent across sources]
- ffmpeg audio copy and keyframe filter syntax [CITED: ffmpeg.org documentation synthesis from multiple sources]

### Tertiary (LOW confidence)
- gallery-dl `--cookies-from-browser chrome` failing with Permission denied on some Linux hosts [CITED: github.com/mikf/gallery-dl/issues/4894 — no definitive resolution in issue]
- gallery-dl 572 error on saved posts endpoint [CITED: github.com/mikf/gallery-dl/issues/8738 — labeled cant-fix]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all Bun-native; yt-dlp validated working; gallery-dl confirmed in source
- Architecture: HIGH — single-process local worker is straightforward
- Saved-collection sync: MEDIUM — gallery-dl supports the URL patterns but the Instagram API endpoint is fragile
- Pitfalls: HIGH — Chrome cookie lock and ffmpeg absence verified directly on this host
- Rate-limit guidance: MEDIUM — synthesized from community sources, not official IG docs (IG has no official scraping policy)

**Research date:** 2026-05-26
**Valid until:** 2026-06-25 for stable items; 2026-06-02 for CAP-05/gallery-dl (Instagram changes frequently)

---

## Recommended Approach (for the Planner)

Build the phase as four sequential logical groups: **(1) Foundation** — reset `tsconfig.json` to `bun-types`, install ffmpeg on host, scaffold the new directory structure, write the SQLite schema (stripped of Telegram columns) and migration runner, and open the DB with WAL + busy_timeout; **(2) Intake surface** — implement the local HTTP endpoint (`Bun.serve` on `127.0.0.1`), the CLI command, and the drop-folder watcher (`fs.watch` + debounce + stable-size probe), all inserting into `submissions` and `jobs` with shortcode/hash dedup; **(3) Worker loop** — implement the atomic claim/lease queue, the yt-dlp download wrapper (based on `scripts/fetch-reel.ts`), the ffmpeg audio extraction and keyframe sampling, the `.info.json` metadata parser, and the `findings` row upsert; **(4) CAP-05 opt-in sync** — implement the gallery-dl subprocess wrapper with jitter delays and batch-size cap, disabled by default via `SYNC_ENABLED=false`. Each group can be a wave. The existing `test/instagram.test.ts` passes without changes; add unit tests for the metadata parser and queue claim logic. The Chrome-cookie-lock and missing-ffmpeg scenarios are the two most likely blockers at execution time — both should fail fast with actionable error messages.
