import { updateFindingVision } from "../db/queries";
import type { Env } from "../shared/types";
import { parseClaudeVision, toBase64 } from "./parse";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_FRAMES = 8;

const SYSTEM_PROMPT = `You analyze keyframes sampled from a short Instagram reel about code, design, art, music, or LLMs.
Return ONLY a JSON object with exactly these keys:
- "visual_summary": a concise paragraph describing what is shown across the frames (techniques, tools, visuals, what is being demonstrated).
- "onscreen_text": all legible on-screen text concatenated (captions, code, labels), or "" if none.
Do not include markdown fences or any prose outside the JSON object.`;

/** Loads keyframes from R2, sends them to Claude, and stores the visual analysis. */
export async function analyzeVisuals(
  env: Env,
  findingId: string,
  keyframeKeys: string[],
): Promise<void> {
  const keys = keyframeKeys.slice(0, MAX_FRAMES);
  const imageBlocks: unknown[] = [];
  for (const key of keys) {
    const obj = await env.MEDIA.get(key);
    if (!obj) continue;
    imageBlocks.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: toBase64(await obj.arrayBuffer()) },
    });
  }
  if (imageBlocks.length === 0) {
    throw new Error("no keyframes available in R2 for vision analysis");
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: "Analyze these reel keyframes and return the JSON described." },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`anthropic vision ${res.status}: ${await res.text()}`);
  }

  const result = parseClaudeVision(await res.json());
  await updateFindingVision(env.DB, findingId, result);
}
