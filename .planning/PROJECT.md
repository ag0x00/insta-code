# Reel Atlas

> Project name is a working title — easy to change later.

## What This Is

A self-hosted, single-user research system for Instagram reels about code, design, art, music, and LLMs. You forward a reel to a Telegram bot; the system downloads it, transcribes the audio, understands the visuals, extracts references, analyzes and challenges the claims, fills gaps with web search, and records an enriched, cross-referenced finding in a knowledge base you can browse as a visual catalog — so prior art is never lost and can be built upon.

## Core Value

Forward a reel and never lose it: it becomes a permanently enriched, cross-referenced, browsable entry I can build generative design/art/code projects on top of.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Capture a reel by forwarding a link (or a video file fallback) to a Telegram bot
- [ ] Download media (hybrid: yt-dlp from link, manual file fallback), extract audio + keyframes + caption/metadata
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
- Native mobile app — Telegram capture + responsive web browsing are enough for v1.
- Other platforms (TikTok, YouTube, X) — Instagram-first; the ingestion layer should stay pluggable for later.
- Public sharing / publishing the catalog — personal knowledge base, not a product.
- Real-time / live transcription — processing is batch/async per submitted reel.
- Guaranteed Instagram download reliability — best-effort only; manual file fallback covers ToS/breakage reality.

## Context

- Triggered by an ADHD-friendly need: today reels get bookmarked and forgotten. The goal is near-zero-friction capture (forward to a bot) plus durable, enriched storage so nothing is lost and projects can be built on top.
- Domain of the reels: creative-technical — generative design/art, music, code experiments, and LLM techniques. Findings should preserve technique-level detail (code/pseudo-code) and aesthetic/emotional references.
- Example reels provided by the user (public reel URLs) span this creative-technical space.
- Instagram has no official API for arbitrary reel media/audio; programmatic downloading is a ToS gray area and downloader tooling breaks periodically — hence the hybrid ingestion strategy with a manual file fallback.

## Constraints

- **Tech stack**: Bun + TypeScript — per project convention (see CLAUDE.md).
- **Capture**: Telegram bot (grammY) — lowest-friction entry point for ADHD capture, always available from phone.
- **Ingestion**: yt-dlp + ffmpeg system binaries; hybrid with manual file fallback — resilience against ToS/breakage.
- **Storage**: SQLite (bun:sqlite) + local media files on disk — simple, private, relational with cross-references.
- **Transcription**: hosted Whisper API (e.g. Groq/OpenAI whisper-large-v3) — avoids heavy local GPU on a small always-on host; keep pluggable.
- **AI**: Claude API for vision + analysis/enrichment, with prompt caching — quality multimodal understanding and reasoning.
- **Deployment**: single small always-on host (cheap VPS or home server) running bot + worker + web.
- **Legal/privacy**: best-effort download, personal/private use only; manual file fallback for compliance.
- **Cost**: per-reel transcription + LLM cost; models must be configurable to control spend.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hybrid ingestion (yt-dlp + manual file fallback) | Low-friction when it works, resilient to ToS/breakage when it doesn't | — Pending |
| Telegram bot as capture entry point | Near-zero friction, always-available, great for ADHD capture | — Pending |
| Self-hosted always-on deployment | Capture must work anytime from phone, not only when laptop is on | — Pending |
| Bun + TypeScript | Project convention | — Pending |
| SQLite knowledge store + local media | Simple, private, relational + cross-references without infra | — Pending |
| Claude API for vision + analysis | Strong multimodal understanding and critical reasoning | — Pending |
| Hosted Whisper for transcription | Avoid heavy local GPU on a small host; keep pluggable | — Pending |
| Full intelligence pipeline in v1 | User explicitly wants references, claims, code, and web-enrichment from the start | — Pending |

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
*Last updated: 2026-05-25 after initialization*
