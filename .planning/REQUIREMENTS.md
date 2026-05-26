# Requirements: Reel Atlas

**Defined:** 2026-05-25
**Core Value:** Forward a reel and never lose it: it becomes a permanently enriched, cross-referenced, browsable entry I can build projects on top of.

## v1 Requirements

### Capture

- [ ] **CAP-01**: User can hand an Instagram reel link to the local system (CLI / local endpoint) and have it accepted for processing
- [ ] **CAP-02**: User can drop a video file into a watched local folder (load-bearing path, also the fallback when link download fails)
- [ ] **CAP-03**: System records receipt and surfaces when processing completes or fails (local notification + log)
- [ ] **CAP-04**: Duplicate submissions of the same reel are detected and not re-processed
- [ ] **CAP-05**: User can opt in to syncing a saved Instagram collection (off by default, cookie-based, small batches with delays); new items are enqueued like any other capture

### Ingest

- [ ] **ING-01**: System downloads reel media from the link via `yt-dlp --cookies-from-browser` on the local host (residential IP + the user's browser session) — *mechanism validated 2026-05-26*
- [ ] **ING-02**: System falls back to the user-supplied dropped video file when link download fails
- [ ] **ING-03**: System extracts the audio track from the media
- [ ] **ING-04**: System extracts representative keyframes from the video
- [ ] **ING-05**: System captures available metadata (author, caption text, post date) when present

### Transcription

- [ ] **TRX-01**: System transcribes spoken audio to text with timestamps
- [ ] **TRX-02**: System detects and records the spoken language
- [ ] **TRX-03**: Transcript is stored on the finding and viewable

### Vision

- [ ] **VIS-01**: System produces a visual summary of what the reel shows from keyframes
- [ ] **VIS-02**: System extracts on-screen text shown in the reel
- [ ] **VIS-03**: Visual analysis is stored on the finding

### Analysis

- [ ] **ANL-01**: System extracts referenced artists, tools, papers, techniques, and links
- [ ] **ANL-02**: System identifies key claims and surfaces hidden assumptions
- [ ] **ANL-03**: System critically challenges claims with counterpoints and caveats
- [ ] **ANL-04**: System extracts reusable code or pseudo-code for techniques shown
- [ ] **ANL-05**: System runs web searches to fill gaps and enrich context, citing sources

### Knowledge

- [ ] **KB-01**: Each processed reel is stored as a structured finding record
- [ ] **KB-02**: Findings are auto-tagged and categorized (code / design / art / music / LLM, plus topical tags)
- [ ] **KB-03**: Findings are cross-referenced to related findings
- [ ] **KB-04**: Extracted code/pseudo-code is collected into a browsable code library cross-linked to findings
- [ ] **KB-05**: User can search across findings (full-text)

### Browse

- [ ] **BRW-01**: User can open a web app and see a visual catalog rendered as a wall of generated examples / visualizations / animations derived from findings (NOT reel thumbnails)
- [ ] **BRW-02**: User can filter and browse by category and tag
- [ ] **BRW-03**: User can search and open a finding's detail view (transcript, visual summary, references, claims, code, links)
- [ ] **BRW-04**: Catalog presents an aesthetically pleasing, animated browsing experience

### Ops

- [ ] **OPS-01**: System runs as an always-on **local** service (intake + ingest worker + web UI) on a single host
- [ ] **OPS-02**: Long-running processing happens via a **local durable (SQLite-backed) job queue** with retries
- [ ] **OPS-03**: Secrets/config (API keys, optional bot token, cookie browser) are managed via environment configuration
- [ ] **OPS-04**: Processing failures are logged and surfaced (bot notification + logs)

## v2 Requirements

### Knowledge Graph & Generative

- **GRAPH-01**: Interactive semantic graph visualization of findings and cross-references
- **EMBED-01**: Embeddings-based semantic similarity, clustering, and "related findings"
- **GEN-01**: Scaffold new generative projects from selected findings ("build on top of it")
- **ART-01** *(candidate for v1 — see ROADMAP Phase 5 scope note)*: Each finding gets a renderable "buildable artifact" (runnable snippet / visualization spec) so the catalog wall can display generated examples rather than reel thumbnails. Auto-generated vs curated is an open decision.

### Platform

- **PLAT-01**: Ingest from other platforms (TikTok, YouTube, X) via the pluggable ingestion layer
- **MULTI-01**: Multi-user accounts and sharing

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-user / accounts | Personal single-user tool; auth adds complexity with no v1 value |
| Native mobile app | Local drop-folder/URL capture + responsive web are sufficient |
| Other platforms (TikTok/YouTube/X) | Instagram-first; keep ingestion pluggable for later (v2) |
| Public sharing / publishing | Personal knowledge base, not a product |
| Real-time / live transcription | Processing is batch/async per submitted reel |
| Guaranteed Instagram download reliability | Best-effort only; manual file fallback covers ToS/breakage |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CAP-01 | Phase 1 | Pending |
| CAP-02 | Phase 1 | Pending |
| CAP-03 | Phase 1 | Pending |
| CAP-04 | Phase 1 | Pending |
| CAP-05 | Phase 1 | Pending |
| ING-01 | Phase 1 | Pending |
| ING-02 | Phase 1 | Pending |
| ING-03 | Phase 1 | Pending |
| ING-04 | Phase 1 | Pending |
| ING-05 | Phase 1 | Pending |
| KB-01 | Phase 1 | Pending |
| OPS-01 | Phase 1 | Pending |
| OPS-02 | Phase 1 | Pending |
| OPS-03 | Phase 1 | Pending |
| OPS-04 | Phase 1 | Pending |
| TRX-01 | Phase 2 | Pending |
| TRX-02 | Phase 2 | Pending |
| TRX-03 | Phase 2 | Pending |
| VIS-01 | Phase 2 | Pending |
| VIS-02 | Phase 2 | Pending |
| VIS-03 | Phase 2 | Pending |
| ANL-01 | Phase 3 | Pending |
| ANL-02 | Phase 3 | Pending |
| ANL-03 | Phase 3 | Pending |
| ANL-04 | Phase 3 | Pending |
| ANL-05 | Phase 3 | Pending |
| KB-02 | Phase 4 | Pending |
| KB-03 | Phase 4 | Pending |
| KB-04 | Phase 4 | Pending |
| KB-05 | Phase 4 | Pending |
| BRW-01 | Phase 5 | Pending |
| BRW-02 | Phase 5 | Pending |
| BRW-03 | Phase 5 | Pending |
| BRW-04 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 34 total
- Mapped to phases: 34
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-25*
*Last updated: 2026-05-26 — local-first pivot + capture topology resolved: Telegram dropped for v1; capture = drop-folder + URL intake + new **CAP-05** opt-in saved-collection sync (off by default). yt-dlp+cookies download validated; local SQLite-backed queue. v1 now 34 requirements; traceability intact.*
