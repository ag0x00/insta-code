import { Bot, type Context } from "grammy";
import {
  findSubmissionByHash,
  findSubmissionByShortcode,
  insertSubmission,
} from "../db/queries";
import { extractFirstUrl, parseReelShortcode } from "../shared/instagram";
import type { Env, JobMessage } from "../shared/types";

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function enqueue(env: Env, job: JobMessage): Promise<void> {
  await env.INGEST_QUEUE.send(job);
}

/** Builds a grammY bot wired to the Worker env. Stateless per request. */
export function createBot(env: Env): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // 1) A message containing an Instagram reel URL.
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const shortcode = parseReelShortcode(text);
    if (!shortcode) {
      // Not an IG link and not handled elsewhere — gentle nudge.
      await ctx.reply("Send me an Instagram reel link, or share the video file.");
      return;
    }

    const existing = await findSubmissionByShortcode(env.DB, shortcode);
    if (existing) {
      await ctx.reply("Already captured ✓");
      return;
    }

    const id = crypto.randomUUID();
    const url = extractFirstUrl(text) ?? text.trim();
    await insertSubmission(env.DB, {
      id,
      telegramChatId: ctx.chat.id,
      telegramMessageId: ctx.message.message_id,
      sourceUrl: url,
      reelShortcode: shortcode,
    });
    await enqueue(env, { submissionId: id, sourceUrl: url, telegramChatId: ctx.chat.id });
    await ctx.reply("Got it — processing… I'll ping you when it's captured.");
  });

  // 2) An uploaded video (video or document) — fallback path.
  const handleFile = async (ctx: Context, fileId: string) => {
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      await ctx.reply("Couldn't read that file — try sending it again.");
      return;
    }
    const res = await fetch(
      `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
    );
    const bytes = await res.arrayBuffer();
    const hash = await sha256Hex(bytes);

    const existing = await findSubmissionByHash(env.DB, hash);
    if (existing) {
      await ctx.reply("Already captured ✓");
      return;
    }

    const id = crypto.randomUUID();
    const key = `uploads/${id}`;
    await env.MEDIA.put(key, bytes);
    await insertSubmission(env.DB, {
      id,
      telegramChatId: ctx.chat!.id,
      telegramMessageId: ctx.msg!.message_id,
      uploadedFileKey: key,
      contentHash: hash,
    });
    await enqueue(env, {
      submissionId: id,
      uploadedFileKey: key,
      telegramChatId: ctx.chat!.id,
    });
    await ctx.reply("Got your file — processing… I'll ping you when it's captured.");
  };

  bot.on("message:video", (ctx) => handleFile(ctx, ctx.message.video.file_id));
  bot.on("message:document", (ctx) => handleFile(ctx, ctx.message.document.file_id));

  return bot;
}
