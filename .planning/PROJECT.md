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

- **Platform**: All-Cloudflare serverless — Workers (Telegram webhook + queue consumers), Cloudflare Queues (job pipeline), D1 (knowledge DB), R2 (media storage), Containers (yt-dlp/ffmpeg). No always-on host to maintain.
- **Edge runtime**: Workers run on `workerd` (V8 isolates) via Wrangler — **not** Bun. Bun stays the local toolchain (package manager, scripts) and the base of the Container image; TypeScript throughout.
- **Capture**: Telegram bot (grammY) running on a Worker via webhook — lowest-friction, always-available capture.
- **Ingestion**: Cloudflare Container image bundling yt-dlp + ffmpeg; hybrid (yt-dlp from link, manual file fallback). **Caveat:** Cloudflare egress IPs are more prone to Instagram blocking/ratelimiting (and reels often need login cookies), so the manual file fallback is load-bearing, not just a backup.
- **Transcription**: Groq Whisper API (whisper-large-v3) via `fetch` — fast/cheap; kept pluggable.
- **AI**: Claude API for vision + analysis/enrichment, with prompt caching.
- **Storage**: D1 for findings/metadata/tags/cross-references; R2 for media/audio/keyframes.
- **Legal/privacy**: best-effort download, personal/private use only; manual file fallback for compliance.
- **Cost**: per-reel Groq + Claude cost plus Cloudflare usage (Containers billed on active CPU); models must be configurable to control spend.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| All-Cloudflare serverless (Workers + Queues + D1 + R2 + Containers) | No always-on host to babysit; Containers (GA Apr 2026) run yt-dlp/ffmpeg; native Queues/D1/R2 cover the pipeline | — Pending |
| ~~Self-hosted always-on host~~ | Superseded by all-Cloudflare on 2026-05-25 | ⚠️ Revisit (replaced) |
| Edge code on workerd, Bun for local tooling + Container image | Workers don't run Bun; keeps Bun preference where it applies | — Pending |
| Hybrid ingestion (yt-dlp + manual file fallback) | Low-friction when it works, resilient when it doesn't; fallback load-bearing on CF IPs | — Pending |
| Telegram bot (grammY on a Worker) as capture entry point | Near-zero friction, always-available, great for ADHD capture | — Pending |
| Cloudflare Queues for the job pipeline | Native durable queue with retries; replaces a SQLite-backed queue | — Pending |
| D1 knowledge store + R2 media | Serverless SQLite (relational + cross-refs) + cheap object storage, no egress fees | — Pending |
| Claude API for vision + analysis | Strong multimodal understanding and critical reasoning | — Pending |
| Groq Whisper for transcription | Fast/cheap hosted Whisper via fetch; keep pluggable | — Pending |
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
*Last updated: 2026-05-25 after Phase 1 discussion (locked all-Cloudflare architecture)*
