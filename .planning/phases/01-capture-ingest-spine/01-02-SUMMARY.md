---
phase: 01-capture-ingest-spine
plan: 02
status: complete
verified: local
---

# Plan 01-02 Summary — Capture Worker (Telegram bot)

## What was built
- `src/shared/instagram.ts`: `parseReelShortcode` (handles `/reel/`, `/reels/`, `/p/`, query strings, no-www, surrounding text) + `extractFirstUrl`.
- `test/instagram.test.ts`: 7 passing cases incl. the three example reels.
- `src/db/queries.ts`: parameterized helpers — `insertSubmission`, `findSubmissionByShortcode`, `findSubmissionByHash`, `getSubmission`, `setSubmissionStatus`, idempotent `upsertFinding`, `rowToFinding`.
- `src/webhook/bot.ts`: grammY bot — URL messages (parse → dedupe by shortcode → insert → enqueue → ACK; duplicates reply "Already captured ✓"); video/document messages (download from Telegram → store in R2 under `uploads/` → SHA-256 dedupe → insert → enqueue → ACK).
- `src/index.ts` `fetch` handler: verifies the `x-telegram-bot-api-secret-token` header against `TELEGRAM_WEBHOOK_SECRET` before invoking the grammY `webhookCallback`; `/health` endpoint.

## Decisions / notes
- Webhook mode (not long-polling), since the Worker is the public endpoint.
- All SQL uses bound parameters (no string interpolation).
- File dedupe via SHA-256 of the uploaded bytes; URL dedupe via shortcode unique index.

## Verification
- `bun test` → 7 pass. `bunx tsc` passes. Bundle validates in `wrangler deploy --dry-run`.

## Pending (human)
- BotFather token + webhook secret, deploy, and webhook registration; then forward a reel to confirm ACK + D1 row (checkpoint in this plan).
