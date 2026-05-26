/**
 * Typed config loader — reads process.env (Bun loads .env natively).
 * Never logs secrets wholesale (Security: Info Disclosure mitigation).
 */

export interface Config {
  /** Path to the SQLite database file. Default: ./reel-atlas.db */
  DB_PATH: string;
  /** Directory for downloaded media files. Default: ./media */
  MEDIA_DIR: string;
  /** Browser whose cookie store yt-dlp reads. Default: chrome */
  IG_COOKIES_BROWSER: string;
  /** Local HTTP intake port. Default: 3000 */
  HTTP_PORT: number;
  /** Directory to watch for dropped video files. Default: ./drop */
  DROP_DIR: string;
  /** Whether opt-in saved-collection sync is enabled. Default: false */
  SYNC_ENABLED: boolean;
  /** Max items per sync batch. Default: 10 */
  SYNC_BATCH_SIZE: number;
  /** Minimum delay between sync items in ms. Default: 8000 */
  SYNC_DELAY_MIN_MS: number;
  /** Maximum delay between sync items in ms. Default: 25000 */
  SYNC_DELAY_MAX_MS: number;
  /** Gallery-dl collection URL for saved sync. */
  SYNC_COLLECTION_URL: string | null;
  /** Phase 2: Groq API key (never logged). */
  GROQ_API_KEY: string | null;
  /** Phase 2: Groq Whisper model. Default: whisper-large-v3 */
  GROQ_WHISPER_MODEL: string;
  /** Phase 2: Anthropic API key (never logged). */
  ANTHROPIC_API_KEY: string | null;
  /** Phase 2: Claude model. Default: claude-opus-4-5 */
  CLAUDE_MODEL: string;
}

function parseIntEnv(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (!raw) return defaultVal;
  const n = parseInt(raw, 10);
  return isNaN(n) ? defaultVal : n;
}

function parseBoolEnv(key: string, defaultVal: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return defaultVal;
  return raw.toLowerCase() === "true" || raw === "1";
}

function loadConfig(): Config {
  return {
    DB_PATH: process.env["DB_PATH"] ?? "./reel-atlas.db",
    MEDIA_DIR: process.env["MEDIA_DIR"] ?? "./media",
    IG_COOKIES_BROWSER: process.env["IG_COOKIES_BROWSER"] ?? "chrome",
    HTTP_PORT: parseIntEnv("HTTP_PORT", 3000),
    DROP_DIR: process.env["DROP_DIR"] ?? "./drop",
    SYNC_ENABLED: parseBoolEnv("SYNC_ENABLED", false),
    SYNC_BATCH_SIZE: parseIntEnv("SYNC_BATCH_SIZE", 10),
    SYNC_DELAY_MIN_MS: parseIntEnv("SYNC_DELAY_MIN_MS", 8000),
    SYNC_DELAY_MAX_MS: parseIntEnv("SYNC_DELAY_MAX_MS", 25000),
    SYNC_COLLECTION_URL: process.env["SYNC_COLLECTION_URL"] ?? null,
    // Phase 2 keys — never log these values
    GROQ_API_KEY: process.env["GROQ_API_KEY"] ?? null,
    GROQ_WHISPER_MODEL: process.env["GROQ_WHISPER_MODEL"] ?? "whisper-large-v3",
    ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ?? null,
    CLAUDE_MODEL: process.env["CLAUDE_MODEL"] ?? "claude-opus-4-5",
  };
}

/** Singleton config instance. */
export const config: Config = loadConfig();

/**
 * Returns a safe summary of config for logging — redacts all secret fields.
 */
export function safeConfigSummary(cfg: Config): Record<string, unknown> {
  return {
    DB_PATH: cfg.DB_PATH,
    MEDIA_DIR: cfg.MEDIA_DIR,
    IG_COOKIES_BROWSER: cfg.IG_COOKIES_BROWSER,
    HTTP_PORT: cfg.HTTP_PORT,
    DROP_DIR: cfg.DROP_DIR,
    SYNC_ENABLED: cfg.SYNC_ENABLED,
    SYNC_BATCH_SIZE: cfg.SYNC_BATCH_SIZE,
    GROQ_API_KEY: cfg.GROQ_API_KEY ? "[SET]" : "[NOT SET]",
    ANTHROPIC_API_KEY: cfg.ANTHROPIC_API_KEY ? "[SET]" : "[NOT SET]",
  };
}
