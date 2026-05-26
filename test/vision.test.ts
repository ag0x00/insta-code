import { describe, expect, test } from "bun:test";
import { parseClaudeVision } from "../src/enrich/parse";

const wrap = (text: string) => ({ content: [{ type: "text", text }] });

describe("parseClaudeVision", () => {
  test("parses a clean JSON response", () => {
    const r = parseClaudeVision(
      wrap(JSON.stringify({ visual_summary: "A p5.js sketch", onscreen_text: "noise()" })),
    );
    expect(r.visual_summary).toBe("A p5.js sketch");
    expect(r.onscreen_text).toBe("noise()");
  });

  test("tolerates ```json code fences", () => {
    const r = parseClaudeVision(
      wrap('```json\n{"visual_summary":"x","onscreen_text":""}\n```'),
    );
    expect(r.visual_summary).toBe("x");
    expect(r.onscreen_text).toBe("");
  });

  test("falls back to raw text when not JSON", () => {
    const r = parseClaudeVision(wrap("just a description"));
    expect(r.visual_summary).toBe("just a description");
    expect(r.onscreen_text).toBe("");
  });
});
