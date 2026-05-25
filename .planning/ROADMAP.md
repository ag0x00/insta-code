# Roadmap: Reel Atlas

## Overview

Build a self-hosted reel research system as a thin end-to-end spine first, then deepen the intelligence. Phase 1 stands up capture (Telegram bot) and ingestion (download + audio/keyframe/metadata extraction) so a forwarded reel produces a stored finding. Phase 2 adds understanding (transcription + visual analysis). Phase 3 adds the analysis/enrichment layer (references, claims, code, web search). Phase 4 turns findings into a real knowledge system (tags, categories, cross-references, code library, search). Phase 5 delivers the visual, animated catalog browser. Each phase leaves a usable system.

## Phases

- [ ] **Phase 1: Capture & Ingest Spine** - Forward a reel to the bot → media downloaded, audio/keyframes/metadata extracted, finding stored
- [ ] **Phase 2: Understand (Transcribe + See)** - Each captured reel gets an automatic transcript and visual summary
- [ ] **Phase 3: Analyze & Enrich** - Findings gain references, challenged claims, extracted code, and web-enriched context
- [ ] **Phase 4: Knowledge System** - Findings are tagged, categorized, cross-linked, searchable; code becomes a browsable library
- [ ] **Phase 5: Visual Catalog Browser** - Browse the whole catalog visually with filtering, search, detail views, and animation

## Phase Details

### Phase 1: Capture & Ingest Spine
**Goal**: Standing up the always-on service so forwarding a reel link (or sending a video file) to the Telegram bot results in downloaded media, extracted audio + keyframes + metadata, and a stored finding record — processed via a durable job queue.
**Depends on**: Nothing (first phase)
**Mode:** mvp
**Requirements**: CAP-01, CAP-02, CAP-03, CAP-04, ING-01, ING-02, ING-03, ING-04, ING-05, KB-01, OPS-01, OPS-02, OPS-03, OPS-04
**Success Criteria** (what must be TRUE):
  1. User can forward an Instagram reel link to the bot and receive an acknowledgement, then a completion/failure notification
  2. When link download fails, user can send the video file and processing continues
  3. A stored finding exists with the media, extracted audio, keyframes, and any caption/metadata
  4. Duplicate submissions of the same reel are skipped
  5. The bot, worker, and queue run as an always-on service driven by env config, with failures logged and surfaced
**Plans**: 3 plans

Plans:
- [ ] 01-01: Cloudflare project skeleton + data model (Wrangler, D1/R2/Queue bindings, submissions/findings schema, shared job + Finding types)
- [ ] 01-02: Capture Worker — grammY Telegram bot (webhook), reel-shortcode parsing, dedupe, file-to-R2, enqueue + ACK
- [ ] 01-03: Ingest Container (yt-dlp + ffmpeg) + Queue consumer — hybrid download, audio/keyframe/metadata extraction, Finding finalization, user notify

### Phase 2: Understand (Transcribe + See)
**Goal**: Automatically enrich every captured reel with a timestamped transcript (and detected language) and a visual analysis (scene summary + on-screen text) derived from keyframes, stored on the finding.
**Depends on**: Phase 1
**Mode:** mvp
**Requirements**: TRX-01, TRX-02, TRX-03, VIS-01, VIS-02, VIS-03
**Success Criteria** (what must be TRUE):
  1. Each processed reel has a timestamped transcript with detected language
  2. Each processed reel has a visual summary and extracted on-screen text
  3. Transcript and visual analysis are stored on the finding and viewable
**Plans**: TBD

Plans:
- [ ] 02-01: TBD (set during `/gsd-plan-phase 2`)

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
**Goal**: Deliver the web app for browsing the catalog visually — thumbnail cards, filter by category/tag, search, a rich detail view, and an aesthetically pleasing, animated experience.
**Depends on**: Phase 4
**Mode:** mvp
**Requirements**: BRW-01, BRW-02, BRW-03, BRW-04
**Success Criteria** (what must be TRUE):
  1. User can open the web app and see a visual catalog of findings as thumbnail cards
  2. User can filter/browse by category and tag and search
  3. User can open a finding detail view with transcript, visual summary, references, claims, code, and links
  4. Browsing feels aesthetically pleasing and animated
**Plans**: TBD

Plans:
- [ ] 05-01: TBD (set during `/gsd-plan-phase 5`)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Capture & Ingest Spine | 0/3 | Planned | - |
| 2. Understand (Transcribe + See) | 0/TBD | Not started | - |
| 3. Analyze & Enrich | 0/TBD | Not started | - |
| 4. Knowledge System | 0/TBD | Not started | - |
| 5. Visual Catalog Browser | 0/TBD | Not started | - |
