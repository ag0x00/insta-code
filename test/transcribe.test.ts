import { describe, expect, test } from "bun:test";
import { parseGroqVerboseJson } from "../src/enrich/parse";

describe("parseGroqVerboseJson", () => {
  test("parses text, language, and segments", () => {
    const body = {
      text: "  hello world  ",
      language: "english",
      segments: [
        { id: 0, start: 0.0, end: 1.5, text: " hello " },
        { id: 1, start: 1.5, end: 3.0, text: " world " },
      ],
    };
    const r = parseGroqVerboseJson(body);
    expect(r.text).toBe("hello world");
    expect(r.language).toBe("english");
    expect(r.segments).toEqual([
      { start: 0.0, end: 1.5, text: "hello" },
      { start: 1.5, end: 3.0, text: "world" },
    ]);
  });

  test("tolerates missing fields", () => {
    const r = parseGroqVerboseJson({});
    expect(r.text).toBe("");
    expect(r.language).toBeNull();
    expect(r.segments).toEqual([]);
  });
});
