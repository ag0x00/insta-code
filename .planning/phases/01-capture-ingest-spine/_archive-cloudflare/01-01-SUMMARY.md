---
phase: 01-capture-ingest-spine
plan: 01
status: complete
verified: local
---

# Plan 01-01 Summary — Project skeleton + data model

## What was built
- Wrangler + Bun TypeScript project: `package.json`, `tsconfig.json` (Worker, workers-types), `container/tsconfig.json` (Bun, bun-types), `.gitignore`, `.dev.vars.example`.
- `wrangler.toml` with bindings: D1 (`DB`), R2 (`MEDIA`), Queue producer + consumer (`reel-ingest` + DLQ `reel-ingest-dlq`), and the `IngestContainer` Container/Durable Object.
- D1 schema + migration `src/db/migrations/0001_init.sql` (and canonical `src/db/schema.sql`): `submissions` and `findings` tables with shortcode/hash dedupe indexes.
- Shared types split for cross-runtime use: `src/shared/dto.ts` (plain DTOs — `JobMessage`, `Finding`, `IngestResult`, `ReelMetadata`, etc.) and `src/shared/types.ts` (`Env` bindings + secrets, re-exports DTOs).
- `README.md` with local-dev and deploy/setup instructions.

## Decisions / notes
- Single Worker exports both `fetch` (webhook) and `queue` (consumer); Container is a separate DO class.
- DTOs kept free of workers-types/bun-types globals so both the Worker and the Bun container import the same `JobMessage`/`IngestResult` contract.
- Added R2 S3 credential env (`R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET`) so the container reads/writes media directly to R2 (keeps large blobs out of the Worker).

## Verification
- `bunx tsc -p tsconfig.json` and `bunx tsc -p container/tsconfig.json` pass.
- `bun run db:migrate:local` applies the migration; `submissions` + `findings` exist.
- `bunx wrangler deploy --dry-run` recognizes all bindings and bundles cleanly.

## Pending (human)
- Cloudflare login + provisioning of D1/R2/Queue and pasting the D1 `database_id` (checkpoint in this plan).
