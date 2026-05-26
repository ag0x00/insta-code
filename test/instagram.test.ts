import { describe, expect, test } from "bun:test";
import { extractFirstUrl, parseReelShortcode } from "../src/shared/instagram";

describe("parseReelShortcode", () => {
  test("extracts shortcode from reel URL with igsh query", () => {
    expect(
      parseReelShortcode(
        "https://www.instagram.com/reel/DWpSK4uDhIO/?igsh=MTIwbnQ1ZjAyNjNsdQ==",
      ),
    ).toBe("DWpSK4uDhIO");
  });

  test("handles the other example reels", () => {
    expect(
      parseReelShortcode("https://www.instagram.com/reel/DYeHzvgCURl/?igsh=x"),
    ).toBe("DYeHzvgCURl");
    expect(
      parseReelShortcode("https://www.instagram.com/reel/DVbfcdTkZ7R/"),
    ).toBe("DVbfcdTkZ7R");
  });

  test("handles /reels/ and /p/ paths and no-www", () => {
    expect(parseReelShortcode("https://instagram.com/reels/ABC123/")).toBe(
      "ABC123",
    );
    expect(parseReelShortcode("instagram.com/p/XyZ_-9/")).toBe("XyZ_-9");
  });

  test("extracts shortcode even with surrounding text", () => {
    expect(
      parseReelShortcode("look at this https://www.instagram.com/reel/DWpSK4uDhIO/ cool"),
    ).toBe("DWpSK4uDhIO");
  });

  test("returns null for non-instagram / no-url text", () => {
    expect(parseReelShortcode("hello there")).toBeNull();
    expect(parseReelShortcode("https://example.com/reel/abc/")).toBeNull();
  });
});

describe("extractFirstUrl", () => {
  test("returns the first URL", () => {
    expect(extractFirstUrl("see https://a.com and https://b.com")).toBe(
      "https://a.com",
    );
  });
  test("returns null when no URL", () => {
    expect(extractFirstUrl("no links here")).toBeNull();
  });
});
