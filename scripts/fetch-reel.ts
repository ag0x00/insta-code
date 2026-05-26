#!/usr/bin/env bun
/**
 * Local reel fetcher — run on YOUR machine, not in a cloud sandbox.
 *
 * Instagram 403s anonymous/datacenter requests, so this uses your logged-in
 * browser's cookies and your residential IP. It wraps yt-dlp and passes every
 * argument as an array, so URLs with `?` / `&` never hit shell globbing.
 *
 * Usage:
 *   bun run scripts/fetch-reel.ts <url> [<url> ...]
 *   bun run scripts/fetch-reel.ts --browser firefox <url>
 *   bun run scripts/fetch-reel.ts --out ./media --no-cookies <url>
 *
 * Env:
 *   IG_BROWSER   default browser for cookies (default: chrome)
 *   IG_OUT_DIR   default output directory   (default: ./media)
 */

const SUPPORTED_BROWSERS = [
  "brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale",
];

type Options = {
  urls: string[];
  browser: string;
  outDir: string;
  useCookies: boolean;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    urls: [],
    browser: process.env.IG_BROWSER ?? "chrome",
    outDir: process.env.IG_OUT_DIR ?? "./media",
    useCookies: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--browser":
        opts.browser = argv[++i] ?? opts.browser;
        break;
      case "--out":
        opts.outDir = argv[++i] ?? opts.outDir;
        break;
      case "--no-cookies":
        opts.useCookies = false;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown flag: ${arg}`);
          process.exit(2);
        }
        opts.urls.push(arg);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(
    [
      "fetch-reel — download Instagram reels locally via yt-dlp",
      "",
      "  bun run scripts/fetch-reel.ts <url> [<url> ...]",
      "",
      "Flags:",
      "  --browser <name>  cookie source browser (default: chrome)",
      "  --out <dir>       output directory (default: ./media)",
      "  --no-cookies      skip --cookies-from-browser (anonymous; will 403)",
      "",
      `Supported browsers: ${SUPPORTED_BROWSERS.join(", ")}`,
    ].join("\n"),
  );
}

async function hasYtDlp(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["yt-dlp", "--version"], { stdout: "pipe", stderr: "pipe" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

async function fetchOne(url: string, opts: Options): Promise<boolean> {
  const args = [
    "--no-playlist",
    "--retries", "3",
    "--sleep-requests", "1",
    "--write-info-json",
    "--restrict-filenames",
    "-o", `${opts.outDir}/%(id)s.%(ext)s`,
  ];
  if (opts.useCookies) {
    args.push("--cookies-from-browser", opts.browser);
  }
  args.push(url);

  console.log(`\n→ fetching ${url}`);
  const proc = Bun.spawn(["yt-dlp", ...args], { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`✗ yt-dlp exited ${code} for ${url}`);
    return false;
  }
  console.log(`✓ saved → ${opts.outDir}/`);
  return true;
}

async function main(): Promise<void> {
  const opts = parseArgs(Bun.argv.slice(2));

  if (opts.urls.length === 0) {
    printHelp();
    process.exit(opts.urls.length === 0 ? 1 : 0);
  }

  if (opts.useCookies && !SUPPORTED_BROWSERS.includes(opts.browser)) {
    console.error(
      `Unsupported browser "${opts.browser}". Supported: ${SUPPORTED_BROWSERS.join(", ")}`,
    );
    process.exit(2);
  }

  if (!(await hasYtDlp())) {
    console.error(
      "yt-dlp not found on PATH. Install it (e.g. `brew install yt-dlp`, " +
        "`pipx install yt-dlp`, or see github.com/yt-dlp/yt-dlp) and retry.",
    );
    process.exit(127);
  }

  let ok = 0;
  for (const url of opts.urls) {
    if (await fetchOne(url, opts)) ok++;
  }

  console.log(`\nDone: ${ok}/${opts.urls.length} succeeded.`);
  process.exit(ok === opts.urls.length ? 0 : 1);
}

main();
