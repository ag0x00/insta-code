# Reel Atlas

A self-hosted, single-user research catalog for Instagram reels (code, design, art, music, LLMs). Forward a reel to a Telegram bot and it gets downloaded, processed, and stored as a cross-referenced finding you can browse.

**This repo currently implements Phase 1 — the Capture & Ingest Spine.** Later phases add transcription, visual understanding, analysis/enrichment, the knowledge system, and the visual catalog UI (see `.planning/ROADMAP.md`).

## Architecture (all-Cloudflare)

```
phone → Telegram → Worker (grammY webhook)
                      │  dedupe + persist submission (D1), store uploads (R2)
                      ▼
              Cloudflare Queue (reel-ingest)
                      │
                      ▼
              Worker queue-consumer ──► IngestContainer (yt-dlp + ffmpeg)
                      │                    │ download/extract, push artifacts → R2 (S3 API)
                      ▼                    ▼
              D1: findings row        R2: media / audio / keyframes
                      │
                      ▼
              Telegram "✓ Captured" notification
```

- **Worker** (`src/index.ts`): Telegram webhook (`fetch`) + Queue consumer (`queue`) + the `IngestContainer` Durable Object class.
- **Container** (`container/`): Bun + yt-dlp + ffmpeg; hybrid download with manual-file fallback, audio + keyframe extraction, metadata parse; reads/writes R2 via the S3 API.
- **D1**: `submissions` (intake/status) and `findings` (durable record). **R2**: media bytes.

## Local development

```bash
bun install
cp .dev.vars.example .dev.vars   # fill in TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET
bun run db:migrate:local         # create tables in local D1
bun test                         # unit tests (shortcode parser)
bun run typecheck                # tsc for Worker + container
bun run dev                      # wrangler dev (Worker only; container needs Docker)
```

## Deploy (one-time setup)

Requires a Cloudflare account, Docker (to build the container image), and a Telegram bot. Steps that need **you** (cannot be automated):

1. **Auth:** `bunx wrangler login`
2. **Provision resources:**
   ```bash
   bunx wrangler d1 create reel-atlas          # paste database_id into wrangler.toml
   bunx wrangler r2 bucket create reel-atlas-media
   bunx wrangler queues create reel-ingest
   bunx wrangler queues create reel-ingest-dlq
   ```
3. **Migrate remote D1:** `bun run db:migrate`
4. **R2 S3 credentials** (the container talks to R2 via the S3 API). In the Cloudflare dashboard: R2 → *Manage API tokens* → create a token with read/write to the bucket. Then set:
   ```bash
   bunx wrangler secret put R2_ACCOUNT_ID        # your Cloudflare account ID
   bunx wrangler secret put R2_ACCESS_KEY_ID
   bunx wrangler secret put R2_SECRET_ACCESS_KEY
   bunx wrangler secret put R2_BUCKET            # reel-atlas-media
   ```
5. **Telegram bot:** create one via [@BotFather](https://t.me/BotFather), then:
   ```bash
   bunx wrangler secret put TELEGRAM_BOT_TOKEN       # from BotFather
   bunx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # any long random string
   ```
6. **Deploy:** `bun run deploy` (builds the container image — Docker must be running).
7. **Register the webhook** (point Telegram at your deployed Worker, with the secret):
   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d "url=https://reel-atlas.<your-subdomain>.workers.dev" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
8. **Test:** forward a reel to your bot. You should get an instant ACK, then a `✓ Captured` message; check the `findings` table in D1.

## Notes & caveats

- **Instagram downloads are best-effort.** Cloudflare egress IPs are more prone to blocking/ratelimiting (and many reels need login cookies), so the **manual file fallback** (send the video to the bot) is a first-class path, not just a backup.
- Cloudflare Containers went GA in April 2026; if the `@cloudflare/containers` API has shifted, the `IngestContainer` wiring in `src/index.ts` is the place to adjust.
