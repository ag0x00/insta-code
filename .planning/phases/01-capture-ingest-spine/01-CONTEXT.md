---
phase: "01"
name: "capture-ingest-spine"
created: 2026-05-25
status: ready-for-planning
---

# Phase 1: capture-ingest-spine — Context

<domain>
## Phase Boundary

Stand up the all-Cloudflare service so that forwarding an Instagram reel **link** (or sending a **video file** fallback) to the Telegram bot results in: media downloaded/stored, audio + keyframes + metadata extracted, and a structured Finding record persisted — processed asynchronously via a durable queue, with success/failure reported back to the user.

In scope: capture (CAP-01..04), ingestion (ING-01..05), the base Finding record (KB-01), and ops plumbing (OPS-01..04).
Out of scope for this phase: transcription, vision, analysis/enrichment, tagging/cross-refs, and the browse UI (later phases).
</domain>

<decisions>
## Implementation Decisions

### Platform & runtime
- **D-01:** All-Cloudflare serverless. Workers (webhook + queue consumer), Cloudflare Queues, D1, R2, and Containers.
- **D-02:** Edge code targets `workerd` via Wrangler (TypeScript). Bun is the local toolchain (package manager, scripts) and the base image for the Container.
- **D-03:** Single Wrangler project/repo with: a webhook Worker, a queue-consumer Worker, and a Container service for media processing.

### Capture (Telegram)
- **D-04:** Telegram bot via grammY, deployed as a Worker using **webhook** mode (not long-polling) and registered against the Worker URL.
- **D-05:** Bot accepts (a) messages containing an Instagram reel URL and (b) uploaded video files (fallback). Both create a submission and enqueue a job.
- **D-06:** Bot immediately ACKs receipt, then sends a follow-up message on completion or failure (OPS-04).
- **D-07:** Deduplicate by Instagram reel **shortcode** parsed from the URL; duplicate submissions are skipped with a "already captured" reply. File-only submissions (no URL) are deduped by content hash.

### Ingestion (Container)
- **D-08:** Container image = Bun base + `yt-dlp` + `ffmpeg`. Triggered by the queue-consumer Worker.
- **D-09:** Hybrid download: try `yt-dlp` on the URL first; on failure (or when only a file was sent) use the user-supplied file pulled from R2.
- **D-10:** Extract audio to a standalone file (ffmpeg). Extract keyframes via ffmpeg (scene-change sampling with a capped count — exact strategy is Claude's discretion, see below).
- **D-11:** Capture available metadata (author/handle, caption text, post date, shortcode, duration) from yt-dlp's info JSON when present; tolerate missing fields.

### Storage
- **D-12:** D1 schema includes at least: `submissions` (raw intake + status) and `findings` (the durable record, FK to submission, media keys, metadata, status). Media bytes live in R2; D1 stores R2 keys/paths, never blobs.
- **D-13:** R2 layout keyed by shortcode/finding id: original media, extracted audio, and keyframes under predictable prefixes.

### Job pipeline & ops
- **D-14:** Cloudflare Queues carries jobs from webhook → consumer. Rely on Queue retries + a dead-letter path; persist per-submission status/error in D1 for visibility.
- **D-15:** All secrets/config via Wrangler secrets/vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, plus bindings for D1, R2, Queue, and the Container. (Groq/Claude keys are introduced in later phases.)
- **D-16:** Structured logging on the Workers/Container; failures both logged and surfaced to the user via the bot.

### Claude's Discretion
- Exact keyframe sampling strategy and count (e.g., scene-change detection vs N-evenly-spaced frames, image dimensions/format).
- D1 table/column naming and migration tooling layout.
- R2 key/prefix naming scheme details.
- Project/folder structure within the Wrangler project.
- Whether the queue-consumer and webhook are one Worker with multiple handlers or separate Workers.
</decisions>

<specifics>
## Specific Ideas

- Capture must feel instant from the phone: forward/share a reel to the bot, get an immediate ACK, walk away, get a "done" ping later. This is the ADHD-friendly core.
- Example reels to use as manual test fixtures (provided by the user):
  - https://www.instagram.com/reel/DWpSK4uDhIO/
  - https://www.instagram.com/reel/DYeHzvgCURl/
  - https://www.instagram.com/reel/DVbfcdTkZ7R/
</specifics>

<canonical_refs>
## Canonical References

**Read before planning/implementing:**
- `.planning/PROJECT.md` — Constraints and Key Decisions (all-Cloudflare stack)
- Cloudflare docs: Workers, Queues, D1, R2, and Containers (Worker → Queue → Container + R2 media pattern; Containers GA Apr 2026)
- grammY docs: webhook deployment on Cloudflare Workers
- yt-dlp: info-JSON output and selecting/downloading Instagram reel media
</canonical_refs>

<deferred>
## Deferred Ideas

- Authenticated yt-dlp via cookies to improve download success (revisit if the bare path proves too flaky).
- Cloudflare Workers AI Whisper as an alternative to Groq (kept as a fallback option; Groq is the chosen default).
</deferred>
