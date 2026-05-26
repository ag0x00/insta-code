---
phase: 01-capture-ingest-spine
plan: 03
status: complete
verified: local
---

# Plan 01-03 Summary — Ingest container + Queue consumer

## What was built
- `container/Dockerfile`: `oven/bun` base + `ffmpeg` + the standalone `yt-dlp` binary; runs `container/server.ts` on :8080.
- `container/server.ts`: Bun HTTP server exposing `POST /ingest` (and `/health`).
- `container/ingest.ts`: hybrid acquire (yt-dlp from `sourceUrl`, else uploaded file from R2), `--write-info-json` metadata parse, ffmpeg audio extraction (mono 16 kHz mp3, Whisper-friendly), keyframe extraction (scene-change with evenly-spaced fallback, capped at 8), uploads media/audio/keyframes to R2 via `Bun.S3Client`, returns `IngestResult`. Binaries spawned with argument arrays (no shell injection).
- `src/index.ts`: `IngestContainer extends Container<Env>` (forwards R2 S3 creds via `envVars`).
- `src/consumer/index.ts`: Queue consumer — marks `processing` → dispatches job to the Container → `upsertFinding` (idempotent) → `done` → notifies user; on failure marks `failed`, retries, and notifies only after exhausting `max_retries` (avoids spam).
- `src/shared/notify.ts`: Telegram `sendMessage` helper.

## Decisions / notes
- Container talks to R2 over the S3 API so large media never passes through the Worker.
- Failure UX nudges the user toward the manual file fallback ("send the video file instead").
- `upsertFinding` keyed on `submission_id` for safe retries.

## Verification
- `bunx tsc` (Worker + container) passes; `bun test` passes; `wrangler deploy --dry-run` validates bindings + container reference. Docker image build + live end-to-end run require Docker/Cloudflare (human step).

## Pending (human)
- Provide R2 S3 token + secrets, `bun run deploy` (Docker builds the image), then forward the three example reels + a file fallback + a failure case to confirm the spine end-to-end (human-verify checkpoint in this plan).
