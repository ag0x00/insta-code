/**
 * Tests for the yt-dlp .info.json metadata parser.
 * Verifies field mapping and tolerance of missing/corrupt input.
 */

import { describe, expect, test } from "bun:test";
import { parseInfoJson } from "../src/worker/metadata";

describe("parseInfoJson", () => {
  test("maps standard yt-dlp fields to ReelMetadata", () => {
    const info = {
      id: "DYeHzvgCURl",
      channel: "some_user",
      uploader: "Some User",
      description: "A cool reel #design",
      upload_date: "20260526",
      duration: 42.5,
    };

    const meta = parseInfoJson(info);
    expect(meta.author_handle).toBe("some_user");
    expect(meta.caption).toBe("A cool reel #design");
    expect(meta.posted_at).toBe("20260526");
    expect(meta.duration_sec).toBe(42.5);
  });

  test("falls back to uploader when channel is missing", () => {
    const info = {
      uploader: "fallback_user",
      description: "caption text",
      duration: 10,
    };

    const meta = parseInfoJson(info);
    expect(meta.author_handle).toBe("fallback_user");
  });

  test("all fields null when info.json has no relevant fields", () => {
    const meta = parseInfoJson({ id: "abc", title: "unknown" });
    expect(meta.author_handle).toBeNull();
    expect(meta.caption).toBeNull();
    expect(meta.posted_at).toBeNull();
    expect(meta.duration_sec).toBeNull();
  });

  test("does not throw on corrupt / non-object JSON", () => {
    expect(() => parseInfoJson(null)).not.toThrow();
    expect(() => parseInfoJson(undefined)).not.toThrow();
    expect(() => parseInfoJson("a string")).not.toThrow();
    expect(() => parseInfoJson(42)).not.toThrow();
    expect(() => parseInfoJson([])).not.toThrow();

    const meta = parseInfoJson(null);
    expect(meta.author_handle).toBeNull();
    expect(meta.caption).toBeNull();
    expect(meta.posted_at).toBeNull();
    expect(meta.duration_sec).toBeNull();
  });

  test("does not throw on deeply wrong types in fields", () => {
    const info = {
      channel: { nested: "object" }, // wrong type
      description: 12345,            // wrong type
      upload_date: null,             // null
      duration: "not-a-number",     // unparseable string
    };

    // parseInfoJson accepts `unknown` so any shape is valid at call site
    const meta = parseInfoJson(info as unknown);
    expect(meta.author_handle).toBeNull();
    expect(meta.caption).toBeNull();
    expect(meta.posted_at).toBeNull();
    expect(meta.duration_sec).toBeNull();
  });

  test("parses duration from numeric string", () => {
    const meta = parseInfoJson({ duration: "30.0" });
    expect(meta.duration_sec).toBe(30);
  });

  test("empty string fields are treated as null", () => {
    const meta = parseInfoJson({ channel: "", description: "  ", upload_date: "" });
    expect(meta.author_handle).toBeNull();
    expect(meta.caption).toBeNull();
    expect(meta.posted_at).toBeNull();
  });
});
