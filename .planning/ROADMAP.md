# Roadmap: Reel Atlas

## Overview

Build a self-hosted reel research system as a thin end-to-end spine first, then deepen the intelligence. Phase 1 stands up **local** capture (manual-drop folder + URL intake, optionally a local Telegram bot) and ingestion (yt-dlp-with-cookies download + audio/keyframe/metadata extraction) so a captured reel produces a stored finding. Phase 2 adds understanding (transcription + visual analysis). Phase 3 adds the analysis/enrichment layer (references, claims, code, web search). Phase 4 turns findings into a real knowledge system (tags, categories, cross-references, code library, search). Phase 5 delivers the visual, animated catalog browser. Each phase leaves a usable system.

> **Architecture pivot (2026-05-26):** the system is now **local-first** (Bun + SQLite + local media + a local SQLite-backed job queue) instead of all-Cloudflare. Reason: Instagram 403s Cloudflare datacenter IPs for reel media, and reliable download needs a residential IP + the user's browser cookies — both of which a local host provides. Validated: `yt-dlp --cookies-from-browser chrome` pulled a 53.9 MiB reel locally. The Phase 1 & 2 code was built against the (now-reverted) Cloudflare stack and **needs re-platforming to local** — re-plan via `/gsd-plan-phase 1`. The Phase 2 *enrichment logic* (Groq transcription, Claude vision, pure parsers) is runtime-portable and largely survives; only its runtime (Workers/Queues/D1/R2 → Bun/local-queue/SQLite/disk) changes.

## Phases

- [ ] **Phase 1: Capture & Ingest Spine** - Forward a reel to the bot → media downloaded, audio/keyframes/metadata extracted, finding stored
- [ ] **Phase 2: Understand (Transcribe + See)** - Each captured reel gets an automatic transcript and visual summary
- [ ] **Phase 3: Analyze & Enrich** - Findings gain references, challenged claims, extracted code, and web-enriched context
- [ ] **Phase 4: Knowledge System** - Findings are tagged, categorized, cross-linked, searchable; code becomes a browsable library
- [ ] **Phase 5: Visual Catalog Browser** - Browse the whole catalog visually with filtering, search, detail views, and animation

## Phase Details

### Phase 1: Capture & Ingest Spine
**Goal**: Stand up the always-on **local** service so capturing a reel link (via CLI / local endpoint / optional local Telegram bot) or dropping a video file results in downloaded media (yt-dlp with browser cookies), extracted audio + keyframes + metadata, and a stored finding record — processed via a local durable (SQLite-backed) job queue.
**Depends on**: Nothing (first phase)
**Mode:** mvp
**Requirements**: CAP-01, CAP-02, CAP-03, CAP-04, ING-01, ING-02, ING-03, ING-04, ING-05, KB-01, OPS-01, OPS-02, OPS-03, OPS-04
**Success Criteria** (what must be TRUE):
  1. User can hand a reel link to the local system (and/or drop a video file) and get a completion/failure result
  2. When link download fails, a dropped video file lets processing continue
  3. A stored finding exists with the media, extracted audio, keyframes, and any caption/metadata
  4. Duplicate submissions of the same reel are skipped
  5. The intake, worker, and queue run as an always-on local service driven by env config, with failures logged and surfaced
**Plans**: re-plan required (was 3 plans against the reverted Cloudflare stack)

Plans (⚠️ built against reverted all-Cloudflare arch — superseded by local-first re-plan):
- [~] 01-01: ~~Cloudflare project skeleton + data model (Wrangler, D1/R2/Queue bindings)~~ → re-do as Bun app skeleton + `bun:sqlite` schema + local media dirs
- [~] 01-02: ~~Capture Worker — grammY Telegram webhook, file-to-R2, enqueue~~ → re-do as local intake (drop-folder watcher + URL CLI/endpoint, optional grammY long-polling bot), enqueue to local queue
- [~] 01-03: ~~Ingest Container + Queue consumer~~ → re-do as local ingest worker (yt-dlp `--cookies-from-browser` + ffmpeg as local processes), finding finalization, local notify

_Original Cloudflare implementation built + locally verified (tsc, bun test, D1 migration, wrangler dry-run) but **reverted** by the 2026-05-26 pivot. Needs re-platforming to local-first via `/gsd-plan-phase 1`. The validated `scripts/fetch-reel.ts` yt-dlp wrapper is the seed of the new local download step._

### Phase 2: Understand (Transcribe + See)
**Goal**: Automatically enrich every captured reel with a timestamped transcript (and detected language) and a visual analysis (scene summary + on-screen text) derived from keyframes, stored on the finding.
**Depends on**: Phase 1
**Mode:** mvp
**Requirements**: TRX-01, TRX-02, TRX-03, VIS-01, VIS-02, VIS-03
**Success Criteria** (what must be TRUE):
  1. Each processed reel has a timestamped transcript with detected language
  2. Each processed reel has a visual summary and extracted on-screen text
  3. Transcript and visual analysis are stored on the finding and viewable
**Plans**: 3 plans

Plans:
- [x] 02-01: Enrichment data model + enrich queue + pipeline wiring (ingest→enrich handoff) — ⚠️ queue/data-model re-platforms to local (SQLite-backed queue + `bun:sqlite`)
- [x] 02-02: Transcription (Groq Whisper `verbose_json` — text/language/segments) — ✅ runtime-portable, survives the pivot
- [x] 02-03: Vision (Claude over keyframes — visual summary + on-screen text, prompt caching) — ✅ runtime-portable, survives the pivot

_Enrichment logic (transcribe/vision/pure parsers, 12 tests) is runtime-portable and largely survives; only its runtime (Workers/Queues/D1/R2 → Bun/local-queue/SQLite/disk) changes during the Phase 1 re-platform. Live verification still pending GROQ_API_KEY + ANTHROPIC_API_KEY._

### Phase 3: Analyze & Enrich
**Goal**: Add the intelligence layer: extract references, identify and critically challenge claims (surfacing assumptions), extract reusable code/pseudo-code, and run web searches to fill gaps and enrich context with citations.
**Depends on**: Phase 2
**Mode:** mvp
**Requirements**: ANL-01, ANL-02, ANL-03, ANL-04, ANL-05
**Success Criteria** (what must be TRUE):
  1. Each finding lists extracted references (artists, tools, papers, techniques, links)
  2. Each finding surfaces key claims with hidden assumptions and critical counterpoints
  3. Reusable code or pseudo-code is extracted where techniques are shown
  4. Findings are enriched with web-search context and cited sources
**Plans**: TBD

Plans:
- [ ] 03-01: TBD (set during `/gsd-plan-phase 3`)

### Phase 4: Knowledge System
**Goal**: Turn the pile of findings into a connected knowledge base: auto-tagging and categorization, cross-references between related findings, a code/pseudo-code library cross-linked to findings, and full-text search.
**Depends on**: Phase 3
**Mode:** mvp
**Requirements**: KB-02, KB-03, KB-04, KB-05
**Success Criteria** (what must be TRUE):
  1. Findings are auto-tagged and categorized (code / design / art / music / LLM + topical tags)
  2. Related findings are cross-referenced
  3. Extracted code is browsable as a library cross-linked back to findings
  4. User can search across findings and get relevant results
**Plans**: TBD

Plans:
- [ ] 04-01: TBD (set during `/gsd-plan-phase 4`)

### Phase 5: Visual Catalog Browser
**Goal**: Deliver the web app for browsing the catalog visually as **a wall of generated examples / visualizations / animations** (the decomposed outputs — NOT reel thumbnails), with filter by category/tag, search, a rich detail view, and an aesthetically pleasing, animated experience.
**Depends on**: Phase 4
**Mode:** mvp
**Requirements**: BRW-01, BRW-02, BRW-03, BRW-04
**Success Criteria** (what must be TRUE):
  1. User can open the web app and see a visual wall of findings rendered as generated artifacts/visualizations (not reel thumbnails)
  2. User can filter/browse by category and tag and search
  3. User can open a finding detail view with transcript, visual summary, references, claims, code, and links
  4. Browsing feels aesthetically pleasing and animated

> **Scope note (user clarification, 2026-05-26):** the catalog is a wall of *cool examples/visualizations/animations* derived from reels, not the reels themselves. This implies findings need a renderable/"buildable" artifact (e.g. runnable snippet or visualization spec). Whether those artifacts are auto-generated per finding or curated is an **open fork to settle in a Phase 5 discussion**, and may add a phase between Knowledge System and Browse (relates to v2 `GEN-01`).
**Plans**: TBD

Plans:
- [ ] 05-01: TBD (set during `/gsd-plan-phase 5`)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Capture & Ingest Spine | 0/TBD | ⚠️ Re-plan for local-first (Cloudflare build reverted) | - |
| 2. Understand (Transcribe + See) | 3/3 | Logic portable; runtime re-platforms during Phase 1 | - |
| 3. Analyze & Enrich | 0/TBD | Not started | - |
| 4. Knowledge System | 0/TBD | Not started | - |
| 5. Visual Catalog Browser | 0/TBD | Not started | - |
