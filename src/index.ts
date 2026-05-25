import { Container } from "@cloudflare/containers";
import { webhookCallback } from "grammy";
import { handleQueueBatch } from "./consumer";
import { createBot } from "./webhook/bot";
import type { Env, JobMessage } from "./shared/types";

/**
 * The ingest Container (yt-dlp + ffmpeg), backed by ./container/Dockerfile.
 * R2 S3 credentials are forwarded so the container reads the uploaded file and
 * writes media/audio/keyframe artifacts directly to R2 (keeping large blobs out
 * of the Worker). See README for the R2_* setup.
 *
 * NOTE: Cloudflare Containers went GA Apr 2026; verify the @cloudflare/containers
 * version's envVars/getContainer signatures against current docs on first deploy.
 */
export class IngestContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "10m";
  // R2 S3 credentials forwarded into the container process (this.env is set by
  // the base constructor before subclass field initializers run).
  envVars = {
    R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: this.env.R2_BUCKET,
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") {
      return new Response("ok");
    }

    // Telegram webhook: verify the secret header before doing anything.
    const secret = req.headers.get("x-telegram-bot-api-secret-token");
    if (req.method !== "POST" || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("not found", { status: 404 });
    }

    const bot = createBot(env);
    return webhookCallback(bot, "cloudflare-mod")(req);
  },

  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};
