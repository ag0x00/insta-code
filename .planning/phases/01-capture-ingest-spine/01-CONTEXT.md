---
phase: "01"
name: "capture-ingest-spine"
created: 2026-05-25
updated: 2026-05-26
status: ready-for-planning
---

# Phase 1: capture-ingest-spine — Context

> **Rewritten 2026-05-26 for the local-first pivot.** The prior all-Cloudflare/Telegram context (and its 3 plans) were reverted; archived under `_archive-cloudflare/`. See `.planning/PROJECT.md` Key Decisions for the pivot rationale.

<domain>
## Phase Boundary

Stand up the always-on **local** service so that capturing an Instagram reel — by dropping a video file into a watched folder, handing a link to a local CLI/endpoint, or (opt-in) syncing a saved collection — results in: media downloaded (yt-dlp with browser cookies) or ingested from the dropped file, audio + keyframes + metadata extracted (ffmpeg), and a structured Finding record persisted in SQLite — processed asynchronously via a local durable (SQLite-backed) job queue, with success/failure logged and surfaced locally.

In scope: capture (CAP-01..05), ingestion (ING-01..05), the base Finding record (KB-01), and ops plumbing (OPS-01..04).
Out of scope for this phase: transcription, vision, analysis/enrichment, tagging/cross-refs, and the browse UI (later phases).
</domain>

<decisions>
## Implementation Decisions

### Platform & runtime
- **D-01:** **Local-first.** Single always-on host (the user's machine / home server / small VPS). Bun + TypeScript throughout. No Cloudflare, no edge runtime.
- **D-02:** `yt-dlp` and `ffmpeg` are external **system binaries** invoked as subprocesses (via `Bun.spawn`). Everything else (intake, worker, queue, later web) runs on Bun.
- **D-03:** The system is a long-lived Bun process (the ingest worker loop) plus a thin intake surface (a CLI command and a small local HTTP endpoint for URL/file submission). Process supervision (systemd/pm2/etc.) is the user's host concern, not built here.

### Capture (local intake)
- **D-04:** Three intake paths, all feeding one local queue: (1) a **watched drop-folder** for video files (load-bearing, zero account-ban risk), (2) **URL intake** via a CLI command and a small local HTTP endpoint, (3) **opt-in saved-collection sync**.
- **D-05:** Each accepted item creates a `submission` row and enqueues a job. Telegram is **dropped for v1** (see Deferred).
- **D-06:** Receipt + completion/failure are surfaced locally: structured logs + per-submission status/error persisted in SQLite; the CLI prints the outcome.
- **D-07:** Deduplicate URL submissions by Instagram reel **shortcode** (parsed from the URL / yt-dlp id); duplicates are skipped. File-only (dropped) submissions dedupe by **content hash**.
- **D-08:** **Saved-collection sync is opt-in, OFF by default.** Cookie-based, your-account-only, processes in **small batches with randomized delays (jitter)** to avoid a fixed-interval signature. It enumerates the saved collection into reel URLs, then feeds each through the same download path as D-04/D-09. The enumeration tool (yt-dlp cannot list a saved collection; candidates: `gallery-dl`, `instaloader`) is an open research question — see RESEARCH.

### Ingestion
- **D-09:** Download via `yt-dlp --cookies-from-browser <browser>` on the local host (residential IP + the user's logged-in session). **Validated 2026-05-26** (53.9 MiB reel, 785 Chrome cookies). `scripts/fetch-reel.ts` is the seed of this step — the worker should reuse/wrap that approach, not pass URLs through a shell.
- **D-10:** Fallback to the user-supplied dropped file when no URL is given or the download fails (ING-02).
- **D-11:** Extract audio to a standalone file (ffmpeg) and representative keyframes (ffmpeg). Exact keyframe strategy/count is Claude's discretion (see below).
- **D-12:** Capture available metadata (author/handle, caption, post date, shortcode, duration) from yt-dlp's `--write-info-json` output when present; tolerate missing fields.

### Storage
- **D-13:** **SQLite via `bun:sqlite`.** At least two tables: `submissions` (raw intake + status) and `findings` (durable record, FK to submission, media paths, metadata, status). The DB stores **file paths, never blobs**.
- **D-14:** Media/audio/keyframes are **local files on disk** under a `media/` dir, keyed by shortcode/finding id under predictable prefixes. `media/` is git-ignored.

### Job pipeline & ops
- **D-15:** **Local durable, SQLite-backed job queue** with status tracking and retries (a claim/lease + attempt-count pattern). A single worker loop drains it. Replaces Cloudflare Queues; jobs survive process restart.
- **D-16:** Config via environment (`.env`): cookie browser (e.g. `IG_COOKIES_BROWSER`), `MEDIA_DIR`, DB path, saved-sync on/off + batch/jitter knobs. (Groq/Claude keys arrive in Phase 2.) No bot token.
- **D-17:** Structured logging; failures both logged and reflected in the submission's status/error so the CLI/endpoint can report them.

### Claude's Discretion
- Keyframe sampling strategy and count (scene-change vs N-evenly-spaced; image dims/format).
- SQLite table/column naming and migration approach (raw SQL vs a tiny migration runner).
- `media/` key/prefix naming scheme.
- Drop-folder watcher implementation (`fs.watch` vs a small lib) and debounce/partial-write handling.
- Queue claim/lease specifics (poll interval, max attempts, backoff).
- How the local HTTP intake endpoint is shaped and bound (localhost-only).
</decisions>

<specifics>
## Specific Ideas

- Capture should be low-friction: drop a file or paste a URL, walk away, find an enriched entry later. (Phone-forward via Telegram was the original ADHD hook but is dropped for v1; drop-folder + URL cover it.)
- The validated download produced a merged `Video by rndyrbrts [DYeHzvgCURl].mp4` plus an info-json sidecar — reuse `--write-info-json` for metadata (D-12).
- Example reels to use as manual test fixtures (provided by the user):
  - https://www.instagram.com/reel/DWpSK4uDhIO/
  - https://www.instagram.com/reel/DYeHzvgCURl/
  - https://www.instagram.com/reel/DVbfcdTkZ7R/
</specifics>

<canonical_refs>
## Canonical References

**Read before planning/implementing:**
- `.planning/PROJECT.md` — local-first Constraints + Key Decisions (pivot rationale)
- `.planning/REQUIREMENTS.md` — CAP-01..05, ING-01..05, KB-01, OPS-01..04 wording
- `scripts/fetch-reel.ts` — the validated `yt-dlp --cookies-from-browser` wrapper (seed of the download step)
- `CLAUDE.md` — Bun tooling conventions (bun install/run/test; yt-dlp/ffmpeg are system binaries)
- yt-dlp: `--cookies-from-browser`, `--write-info-json`, `--no-playlist`; ffmpeg: audio extraction + keyframe sampling
- `bun:sqlite` docs (prepared statements, transactions); Bun.spawn for subprocesses
</canonical_refs>

<deferred>
## Deferred Ideas

- **Telegram capture (local long-polling grammY bot)** — dropped for v1; revisit in v2 if phone-forward friction is missed.
- Other platforms (TikTok/YouTube/X) — keep the download/intake layer pluggable, but Instagram-only for now.
- Anything Cloudflare (Workers/Queues/D1/R2/Containers) — reverted.
</deferred>
