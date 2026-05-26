---
phase: "02"
name: "understand-transcribe-see"
created: 2026-05-26
status: complete
---

# Phase 2: understand-transcribe-see — Context

<domain>
## Phase Boundary

After ingestion produces a Finding with `audio_key` + `keyframe_keys` in R2, automatically enrich it
with understanding: a timestamped transcript + detected language (Groq Whisper) and a visual summary
+ extracted on-screen text (Claude vision). Store all of it on the finding.

In scope: TRX-01/02/03, VIS-01/02/03.
Out of scope: references/claims/code extraction + web enrichment (Phase 3), tagging/cross-refs
(Phase 4), the browse UI (Phase 5).
</domain>

<decisions>
## Implementation Decisions

### Pipeline shape
- **D-01:** Enrichment is a **separate Queue** (`reel-enrich`), decoupled from ingest. The ingest
  consumer enqueues `{findingId, telegramChatId}` after the Finding is persisted.
- **D-02:** Enrichment reads its inputs (`audio_key`, `keyframe_keys`) from R2, so a transcription/
  vision retry never triggers a re-download.
- **D-03:** A single Worker `queue()` handler routes by `batch.queue` (`reel-ingest` vs `reel-enrich`).
- **D-04:** Transcription and vision run concurrently (`Promise.all`); each input is optional/tolerated.

### Transcription
- **D-05:** Groq `whisper-large-v3`, `response_format=verbose_json`, multipart upload of the R2 audio.
- **D-06:** Persist `transcript`, `transcript_language`, and `transcript_segments` (JSON `{start,end,text}`).

### Vision
- **D-07:** Claude Messages API over up to 8 base64 keyframes; model from `CLAUDE_MODEL` env
  (default `claude-sonnet-4-6`, override `claude-haiku-4-5` to cut cost).
- **D-08:** System prompt carries `cache_control: ephemeral` (prompt caching). Model returns strict
  JSON `{visual_summary, onscreen_text}`; parser tolerates code fences / non-JSON.

### Storage & status
- **D-09:** New `findings` columns via migration `0002_enrichment.sql`; `enrich_status`
  (`pending|processing|done|failed`) + `enriched_at`.
- **D-10:** Pure parsing helpers live in `src/enrich/parse.ts` (no workers/bun globals) so tests
  import them without dragging in `workers-types`.

### Claude's Discretion
- Exact Whisper/Claude prompt wording, max_tokens, frame cap, and notification copy.
</decisions>

<specifics>
## Specific Ideas
- Final "🧠 Understood" Telegram ping after enrichment completes (in addition to the "✓ Captured" ping).
</specifics>

<canonical_refs>
## Canonical References
- `.planning/PROJECT.md` (locked: Groq + Claude, all-Cloudflare)
- `src/consumer/index.ts` (queue consumer / retry / notify pattern to mirror)
- Groq audio transcriptions API (`verbose_json`); Anthropic Messages API (image blocks + prompt caching)
- claude-api skill guidance (prompt caching)
</canonical_refs>

<deferred>
## Deferred Ideas
- Cloudflare Workers AI Whisper as an alternative transcription backend (Groq is the default).
- Embeddings of transcript/visual_summary for later semantic search (Phase 4+).
</deferred>
