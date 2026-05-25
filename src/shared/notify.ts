import type { Env } from "./types";

/** Sends a plain Telegram message via the Bot API (used by the queue consumer). */
export async function notify(env: Env, chatId: number, text: string): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );
  if (!res.ok) {
    console.error("notify failed", res.status, await res.text());
  }
}
