const URL_RE = /https?:\/\/[^\s]+/i;

// Matches instagram.com/reel/<code>, /reels/<code>, /p/<code>, with optional
// leading subdomain and any trailing path/query.
const SHORTCODE_RE =
  /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:reels?|p)\/([A-Za-z0-9_-]+)/i;

/** Returns the first URL found in a free-text message, or null. */
export function extractFirstUrl(text: string): string | null {
  const m = text.match(URL_RE);
  return m ? m[0] : null;
}

/**
 * Extracts the Instagram reel/post shortcode from a message containing an
 * Instagram URL. Tolerates query strings (e.g. ?igsh=...) and trailing slashes.
 * Returns null when no Instagram URL is present.
 */
export function parseReelShortcode(text: string): string | null {
  const m = text.match(SHORTCODE_RE);
  return m ? m[1] : null;
}
