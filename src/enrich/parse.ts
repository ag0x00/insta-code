// Pure parsing/encoding helpers — NO workers-types/bun-types deps, so both the
// Worker and the test suite can import them cleanly.
import type { TranscriptResult, TranscriptSegment, VisionResult } from "../shared/dto";

/** Parses a Groq/OpenAI Whisper `verbose_json` body into a TranscriptResult. */
export function parseGroqVerboseJson(body: unknown): TranscriptResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const rawSegments = Array.isArray(b.segments) ? (b.segments as Record<string, unknown>[]) : [];
  const segments: TranscriptSegment[] = rawSegments.map((s) => ({
    start: typeof s.start === "number" ? s.start : 0,
    end: typeof s.end === "number" ? s.end : 0,
    text: typeof s.text === "string" ? s.text.trim() : "",
  }));
  return {
    text: typeof b.text === "string" ? b.text.trim() : "",
    language: typeof b.language === "string" ? b.language : null,
    segments,
  };
}

/** Extracts the JSON {visual_summary,onscreen_text} from a Claude messages response. */
export function parseClaudeVision(body: unknown): VisionResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const content = Array.isArray(b.content) ? (b.content as Record<string, unknown>[]) : [];
  const text = content
    .filter((blk) => blk.type === "text" && typeof blk.text === "string")
    .map((blk) => blk.text as string)
    .join("\n")
    .trim();

  // Tolerate accidental code fences.
  const json = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return {
      visual_summary: typeof parsed.visual_summary === "string" ? parsed.visual_summary : "",
      onscreen_text: typeof parsed.onscreen_text === "string" ? parsed.onscreen_text : "",
    };
  } catch {
    // Fall back to treating the whole response as the summary.
    return { visual_summary: text, onscreen_text: "" };
  }
}

/** Base64-encodes binary data (chunked to avoid call-stack limits). */
export function toBase64(bytes: ArrayBuffer): string {
  let binary = "";
  const arr = new Uint8Array(bytes);
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}
