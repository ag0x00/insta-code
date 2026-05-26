---
phase: 02-understand-transcribe-see
plan: 01
status: complete
verified: local
---

# Plan 02-01 Summary — Enrichment model + queue + wiring

## Built
- `src/db/migrations/0002_enrichment.sql` (+ `schema.sql`): `transcript`, `transcript_language`, `transcript_segments` (JSON), `visual_summary`, `onscreen_text`, `enrich_status` (default `pending`), `enriched_at` on `findings`.
- `src/shared/dto.ts`: `EnrichJob`, `TranscriptSegment`, `TranscriptResult`, `VisionResult`, `EnrichStatus`; extended `Finding`.
- `src/shared/types.ts` (`Env`): `ENRICH_QUEUE`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`.
- `wrangler.toml`: `reel-enrich` producer + consumer + `reel-enrich-dlq`; `CLAUDE_MODEL` var (`claude-sonnet-4-6`).
- `src/db/queries.ts`: `getFinding`, `getFindingIdBySubmission`, `setEnrichStatus`, `updateFindingTranscript`, `updateFindingVision`, `markEnriched`; `rowToFinding` now parses `transcript_segments`.
- `src/consumer/index.ts`: renamed `handleQueueBatch`→`handleIngestBatch`; enqueues `ENRICH_QUEUE` after `upsertFinding`.
- `src/index.ts`: `queue()` routes by `batch.queue`; `src/enrich/index.ts` consumer skeleton.

## Verified (local)
- `bun run db:migrate:local` applies 0002; `bunx tsc` (both); dry-run shows `ENRICH_QUEUE`.

## Pending (human)
- `bunx wrangler queues create reel-enrich` + `reel-enrich-dlq`; `bun run db:migrate` (remote).
