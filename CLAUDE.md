# Project conventions

## Tooling

- Use **Bun** as the default package manager and JavaScript/TypeScript runtime for this project.
  - Install dependencies with `bun install` (not `npm install`).
  - Run scripts with `bun run <script>`.
  - Run files with `bun <file>` and one-off binaries with `bunx <pkg>` (instead of `node` / `npx`).
  - Use `bun test` for the test runner.
  - **Note:** `yt-dlp` and `ffmpeg` are external **system binaries** invoked as subprocesses (not Bun packages); everything else — app, ingest worker, web UI, tests — runs on Bun.

<!-- GSD:project-start source:PROJECT.md -->

## Project

**Reel Atlas**

A self-hosted, single-user research system for Instagram reels about code, design, art, music, and LLMs. You capture a reel locally — drop a video file, hand it a link, or (opt-in) sync a saved collection; the system downloads it, transcribes the audio, understands the visuals, extracts references, analyzes and challenges the claims, fills gaps with web search, and records an enriched, cross-referenced finding in a knowledge base you can browse as a visual catalog — so prior art is never lost and can be built upon.

**Core Value:** Capture a reel and never lose it: it becomes a permanently enriched, cross-referenced, browsable entry I can build generative design/art/code projects on top of.

### Constraints

- **Tech stack**: Bun + TypeScript — per project convention (see CLAUDE.md).
- **Architecture**: Local-first — single always-on host (Bun + `bun:sqlite` + local media + a local SQLite-backed job queue). *(Not Cloudflare: Instagram 403s datacenter IPs; reliable reel download needs a residential IP + browser cookies, which a local host has.)*
- **Capture**: Local intake — watched drop-folder (load-bearing) + URL intake (CLI/endpoint) + **opt-in** saved-collection sync (off by default, cookie-based, small batches with **randomized delays** to avoid pattern-matching). Telegram dropped for v1.
- **Ingestion**: `yt-dlp --cookies-from-browser` + ffmpeg system binaries; manual file fallback — resilience against ToS/breakage. *(Download mechanism validated 2026-05-26.)*
- **Storage**: SQLite (bun:sqlite) + local media files on disk — simple, private, relational with cross-references.
- **Transcription**: hosted Whisper API (e.g. Groq/OpenAI whisper-large-v3) — avoids heavy local GPU on a small always-on host; keep pluggable.
- **AI**: Claude API for vision + analysis/enrichment, with prompt caching — quality multimodal understanding and reasoning.
- **Deployment**: single small always-on host (cheap VPS or home server) running ingest worker + web.
- **Legal/privacy**: best-effort download, personal/private use only; manual file fallback for compliance.
- **Cost**: per-reel transcription + LLM cost; models must be configurable to control spend.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->

## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
