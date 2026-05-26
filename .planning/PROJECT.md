# Reel Atlas

> Project name is a working title — easy to change later.

## What This Is

A self-hosted, single-user research system for Instagram reels about code, design, art, music, and LLMs. You capture a reel locally — drop a video file, hand it a link, or (opt-in) sync a saved collection; the system downloads it, transcribes the audio, understands the visuals, extracts references, analyzes and challenges the claims, fills gaps with web search, and records an enriched, cross-referenced finding in a knowledge base you can browse as a visual catalog — so prior art is never lost and can be built upon.

## Core Value

Forward a reel and never lose it: it becomes a permanently enriched, cross-referenced, browsable entry I can build generative design/art/code projects on top of.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Capture a reel by dropping a video file, handing a link to the local system, or (opt-in) syncing a saved Instagram collection
- [ ] Download media (yt-dlp with browser cookies on the local host, manual file fallback), extract audio + keyframes + caption/metadata
- [ ] Transcribe audio with timestamps and detect language
- [ ] Understand the visuals (scene summary + on-screen text) from keyframes
- [ ] Extract references (artists, tools, papers, techniques, links)
- [ ] Identify and critically challenge claims; surface hidden assumptions
- [ ] Extract reusable code / pseudo-code for techniques shown
- [ ] Enrich findings with web search, citing sources
- [ ] Store each reel as a structured finding with tags, categories, and cross-references
- [ ] Collect extracted code into a browsable code library cross-linked to findings
- [ ] Browse the catalog visually in a web app (filter, search, detail view), with an aesthetically pleasing animated experience
- [ ] Run always-on, self-hosted, with a durable job queue and failure notifications

### Out of Scope

- Multi-user / accounts — this is a personal single-user tool; auth adds complexity with no v1 value.
- Native mobile app — local drop-folder/URL capture + responsive web browsing are enough for v1.
- Other platforms (TikTok, YouTube, X) — Instagram-first; the ingestion layer should stay pluggable for later.
- Public sharing / publishing the catalog — personal knowledge base, not a product.
- Real-time / live transcription — processing is batch/async per submitted reel.
- Guaranteed Instagram download reliability — best-effort only; manual file fallback covers ToS/breakage reality.

## Context

- Triggered by an ADHD-friendly need: today reels get bookmarked and forgotten. The goal is near-zero-friction capture (forward to a bot) plus durable, enriched storage so nothing is lost and projects can be built on top.
- Domain of the reels: creative-technical — generative design/art, music, code experiments, and LLM techniques. Findings should preserve technique-level detail (code/pseudo-code) and aesthetic/emotional references.
- Example reels provided by the user (public reel URLs) span this creative-technical space.
- Instagram has no official API for arbitrary reel media/audio; programmatic downloading is a ToS gray area and downloader tooling breaks periodically — hence the hybrid ingestion strategy with a manual file fallback.
- **Architecture pivot (2026-05-26):** reverted from all-Cloudflare to **local-first**. Two findings drove this: (1) Instagram returns `403` to Cloudflare datacenter egress IPs for reel media (verified — anonymous, real browser-UA, and the oembed endpoint all 403), so the load-bearing download cannot run on serverless edge; (2) downloading reliably needs a **residential IP + the user's logged-in browser cookies**, which a local host provides. Validated the mechanism end-to-end: `yt-dlp --cookies-from-browser chrome <reel-url>` pulled a 53.9 MiB reel (785 cookies extracted) on the user's machine. A research PDF (Reddit synthesis) also flagged that all programmatic IG access is unofficial and **account bans are a real, current risk** — pushing manual-drop to be load-bearing and saved-collection auto-sync to opt-in/deferred.
- **UI intent (clarified 2026-05-26):** the browsable catalog is a *wall of cool examples, visualizations, and animations* — the decomposed/generated outputs — **not** a grid of reel thumbnails. Reels are raw sources for ingestion + decomposition. This pulls the generative angle toward the core experience and shapes Phase 5 (see ROADMAP scope note + REQUIREMENTS ART-01).

## Constraints

- **Platform**: Single **local always-on host** (your machine / home server / small VPS) running the whole system — capture intake, ingest worker, and web UI — on **Bun + TypeScript**. This realigns with the original CLAUDE.md constraints (SQLite + local media on one small host); the all-Cloudflare detour is **reverted** (see Key Decisions) because Instagram 403s Cloudflare datacenter egress IPs, so the load-bearing reel download can't run there.
- **Capture**: Three paths feeding one **local intake queue**: (1) a watched **manual-drop folder** for video files (zero account-ban risk), (2) **local URL intake** (CLI / local endpoint) that fetches a reel via yt-dlp, and (3) **opt-in saved-collection sync** — off by default, cookie-based, small batches with delays (you enable it knowingly given the ban risk). Telegram is **dropped for v1**.
- **Ingestion**: `yt-dlp` + `ffmpeg` as local system binaries. Reel download uses `yt-dlp --cookies-from-browser <browser>` — **validated 2026-05-26**: pulled a 53.9 MiB reel using 785 Chrome cookies from a residential IP. Manual file drop remains the load-bearing fallback for ToS/breakage.
- **Transcription**: Groq Whisper API (whisper-large-v3) via `fetch` — fast/cheap; kept pluggable. (Unchanged — runtime-portable.)
- **AI**: Claude API for vision + analysis/enrichment, with prompt caching. (Unchanged — runtime-portable.)
- **Storage**: **SQLite (`bun:sqlite`)** for findings/metadata/tags/cross-references; media/audio/keyframes as **local files on disk**. Replaces D1/R2.
- **Job pipeline**: A **local durable job queue (SQLite-backed)** with retries drives async processing. Replaces Cloudflare Queues.
- **Legal/privacy**: best-effort download, personal/private use only; runs on your own machine with your own browser session cookies; manual file fallback for compliance.
- **Cost**: per-reel Groq + Claude cost only — **no cloud infra bill**. Models must be configurable to control spend.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| **Local-first: single always-on host** (Bun + SQLite + local media + local job queue) | Realigns with original CLAUDE.md constraints; residential IP + browser cookies are required to fetch reels; no per-reel infra cost; full privacy | ✅ Adopted 2026-05-26 |
| ~~All-Cloudflare serverless (Workers + Queues + D1 + R2 + Containers)~~ | **Reverted 2026-05-26**: Instagram 403s Cloudflare datacenter egress IPs for reel media (verified — anonymous, browser-UA, and oembed all 403), so the load-bearing download can't run there | ⚠️ Reverted → local-first |
| Reel download via `yt-dlp --cookies-from-browser` on the local host | Uses residential IP + your logged-in session — the only reliable path past IG's anonymous/datacenter blocking | ✅ Validated 2026-05-26 (53.9 MiB reel, 785 Chrome cookies) |
| Manual-drop folder as load-bearing capture + fallback | Zero account-ban risk; works regardless of IG breakage; intake is mechanism-agnostic | ✅ Adopted 2026-05-26 |
| ~~Telegram capture (local long-polling grammY bot)~~ | Dropped for v1 (2026-05-26) — capture is drop-folder + URL intake + opt-in sync; revisit in v2 if phone-forward friction is missed | ❌ Dropped (v1) |
| Saved-collection sync — **opt-in, off by default**, cookie-based, small batches w/ delays | Convenient capture of the saved collection, but carries real account-ban risk (per research PDF); user opts in knowingly | ✅ Adopted 2026-05-26 (opt-in, Phase 1) |
| SQLite (`bun:sqlite`) + local media files | Relational store w/ cross-refs on one host; replaces D1/R2 | ✅ Adopted 2026-05-26 |
| Local SQLite-backed job queue with retries | Durable async pipeline without Cloudflare Queues | ✅ Adopted 2026-05-26 |
| Claude API for vision + analysis (prompt caching) | Strong multimodal understanding; runtime-portable (kept from prior plan) | — Pending |
| Groq Whisper for transcription | Fast/cheap hosted Whisper via fetch; runtime-portable (kept from prior plan) | — Pending |
| Full intelligence pipeline in v1 | User explicitly wants references, claims, code, and web-enrichment from the start | — Pending |
| Catalog = wall of generated artifacts, not reel thumbnails | User's UI intent: surface decomposed examples/visualizations/animations to build on | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-26 — architecture pivot to local-first (Bun + SQLite + local media + local queue); yt-dlp+browser-cookies capture validated; all-Cloudflare reverted. Phase 1/2 code needs re-platforming (track via /gsd-plan-phase).*
