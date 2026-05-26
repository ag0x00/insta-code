---
phase: "02"
name: "understand-transcribe-see"
created: 2026-05-26
updated: 2026-05-26
status: ready-for-planning
---

# Phase 2: understand-transcribe-see — Context

> **Rewritten 2026-05-26 for the local-first pivot.** The prior all-Cloudflare context (separate `reel-enrich` Cloudflare Queue, R2 inputs, Telegram pings) and its 3 plans were reverted; archived under `_archive-cloudflare/`. Phase 1 already shipped the local spine (Bun + `bun:sqlite` + local `media/` + a SQLite-backed job queue) and **pre-provisioned the enrichment columns** on the `findings` table. This phase fills them.

<domain>
## Phase Boundary

After Phase 1 ingestion produces a `findings` row with `audio_key` + `keyframe_keys` (local file paths under `MEDIA_DIR`) and `enrich_status='pending'`, automatically enrich it: a timestamped transcript + detected language (Groq Whisper) and a visual summary + extracted on-screen text (Claude vision). Persist all of it onto the finding and mark `enrich_status='done'`.

In scope: TRX-01/02/03, VIS-01/02/03.
Out of scope: references/claims/code extraction + web enrichment (Phase 3), tagging/cross-refs (Phase 4), the browse UI (Phase 5).
</domain>

<decisions>
## Implementation Decisions

### Pipeline shape (local)
- **D-01:** Enrichment is a **separate local pass decoupled from ingest**, so a Groq/Claude failure or retry never re-downloads the reel. Implement by extending the existing SQLite-backed queue (`src/queue/queue.ts`) — the ingest worker, after persisting a finding, enqueues an **enrich job** (e.g. a `kind`/job-type column or a second lightweight queue), and the same worker loop drains it. Keep it simple — reuse the existing claim/lease + retry/backoff machinery; do NOT build a parallel queue system. (Exact mechanism — job-kind column vs. polling `findings WHERE enrich_status='pending'` — is a research/planning call; favor the smallest change to the Phase 1 queue.)
- **D-02:** Enrichment reads inputs from **local files** under `MEDIA_DIR` (`audio_key`, `keyframe_keys` paths from the finding row) — NOT R2. No re-download on retry.
- **D-03:** Transcription and vision run concurrently (`Promise.all`); each is independently optional/tolerated — one failing must not blank the other. Per-step status reflected so a partial result is preserved.

### Transcription
- **D-04:** Groq `whisper-large-v3`, `response_format=verbose_json`, multipart upload of the local audio file (read via `Bun.file(path)`). Model configurable via env (e.g. `GROQ_MODEL`), key via `GROQ_API_KEY`.
- **D-05:** Persist `transcript`, `transcript_language`, `transcript_segments` (JSON `{start,end,text}`) onto the finding. Reuse the existing pure parser `parseGroqVerboseJson` in `src/enrich/parse.ts` (already present + unit-tested by `test/transcribe.test.ts`).

### Vision
- **D-06:** Claude Messages API over a capped set of base64 keyframes (read from local files). **Default model `claude-haiku-4-5`** (cost is fractions of a cent/reel at this scale, quality is strong for scene+OCR), overridable via `CLAUDE_MODEL` env (e.g. `claude-sonnet-4-6`). Key via `ANTHROPIC_API_KEY`. *(Decision locked 2026-05-26: Haiku 4.5 for vision; Sonnet reserved for Phase 3 reasoning.)*
- **D-07:** System prompt carries `cache_control: ephemeral` (prompt caching). Model returns strict JSON `{visual_summary, onscreen_text}`; reuse the existing tolerant parser `parseClaudeVision` in `src/enrich/parse.ts` (handles code fences / non-JSON; unit-tested by `test/vision.test.ts`).

### Storage & status
- **D-08:** The enrichment columns ALREADY EXIST on `findings` (added in Phase 1's `schema.sql`): `transcript`, `transcript_language`, `transcript_segments`, `visual_summary`, `onscreen_text`, `enrich_status` (`pending|processing|done|failed`), `enriched_at`. No new migration needed unless a column is missing — verify against `src/db/schema.sql` first.
- **D-09:** On success set `enrich_status='done'` + `enriched_at`; on failure set `'failed'` with the error surfaced (logs + visible via `bun run findings`). Idempotent on retry.

### Notifications
- **D-10:** Completion/failure surfaced locally (structured logs + `enrich_status` visible in `bun run findings`). No Telegram "Understood" ping (Telegram dropped in v1).

### Claude's Discretion
- Exact Whisper/Claude prompt wording, `max_tokens`, keyframe cap (the old default was up to 8), and the precise enrich-job mechanism (job-kind column vs. pending-poll) within D-01's "smallest change" guidance.
</decisions>

<reuse_and_recovery>
## Reuse / Recovery (post-Phase-1)
- **KEEP (present + tested):** `src/enrich/parse.ts` — `parseGroqVerboseJson` and `parseClaudeVision`, plus `test/transcribe.test.ts` + `test/vision.test.ts` (they import only the pure parsers, which is why they pass today).
- **RECOVER + RE-PLATFORM from git history:** the Cloudflare-bound `src/enrich/transcribe.ts`, `src/enrich/vision.ts`, `src/enrich/index.ts` were deleted in Phase 1 (commit `8f0ed64`); their last good version is at parent commit **`607fc16`** (e.g. `git show 607fc16:src/enrich/transcribe.ts`). Recover the Groq multipart call + Claude image-block/prompt-caching structure, then swap the runtime: R2 `env.MEDIA.get` → `Bun.file(localPath)`; `env.DB`/`updateFindingTranscript` (D1) → `bun:sqlite` UPDATE on `findings`; drop the `Env`/workers types.
</reuse_and_recovery>

<canonical_refs>
## Canonical References
- `.planning/PROJECT.md` — local-first constraints; Groq + Claude (prompt caching); Haiku-4.5-for-vision decision
- `.planning/phases/01-capture-ingest-spine/01-VERIFICATION.md` + `01-0{1,2,3}-SUMMARY.md` — what the local spine provides (findings rows, queue, worker loop, MEDIA_DIR layout)
- `src/db/schema.sql` — the findings enrichment columns (already present)
- `src/queue/queue.ts`, `src/worker/loop.ts`, `src/worker/process.ts` — the local queue + worker loop to extend
- `src/enrich/parse.ts` — the pure parsers to reuse
- git `607fc16:src/enrich/transcribe.ts` and `607fc16:src/enrich/vision.ts` — portable Groq/Claude logic to recover
- Groq audio transcriptions API (`verbose_json`); Anthropic Messages API (image blocks + prompt caching); `claude-api` skill guidance
</canonical_refs>

<deferred>
## Deferred Ideas
- Embeddings of transcript/visual_summary for semantic search (Phase 4+).
- Telegram "Understood" ping (Telegram dropped in v1).
</deferred>
