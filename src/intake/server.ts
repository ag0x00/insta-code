/**
 * Localhost-only HTTP intake endpoint (CAP-01, D-03, D-04).
 *
 * Routes:
 *   POST /submit  — JSON body {url}: validate Instagram reel URL, dedup, enqueue
 *   POST /upload  — multipart/form-data with a 'file' field: hash dedup, persist, enqueue
 *
 * Security:
 *   T-02-01: Bun.serve binds to 127.0.0.1 ONLY — never 0.0.0.0 (LAN exposure).
 *   T-02-02: URL intake uses parseReelShortcode + isInstagramReelUrl (SSRF guard).
 *   T-02-03: Upload filenames use path.basename + reject '..' (path traversal).
 *   T-02-04: Non-video uploads and missing file fields return 4xx.
 *
 * Exports startServer() for testability (accepts a dependency-injected DB and mediaDir).
 */

import type { Database } from "bun:sqlite";
import { config } from "../shared/config";
import { isInstagramReelUrl, submitUrl, submitFile } from "./submit";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MiB — reasonable cap for a local tool

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/mkv",
  "video/mpeg",
  "video/ogg",
  "application/octet-stream", // allow generic binary for CLI tools that don't set MIME
]);

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".mpeg", ".mpg", ".ogg"]);

export interface ServerOptions {
  db: Database;
  mediaDir: string;
  port?: number;
  hostname?: string;
}

export interface StartServerResult {
  server: ReturnType<typeof Bun.serve>;
}

/**
 * Start the Bun HTTP intake server.
 *
 * Always binds to 127.0.0.1 (Security: T-02-01). The `hostname` option is
 * exposed only to allow tests to override to another loopback address — the
 * default is unconditionally 127.0.0.1.
 */
export function startServer(options: ServerOptions): StartServerResult {
  const { db, mediaDir, port = config.HTTP_PORT, hostname = "127.0.0.1" } = options;

  const server = Bun.serve({
    hostname: hostname === "127.0.0.1" ? "127.0.0.1" : "127.0.0.1", // Security: always 127.0.0.1
    port,

    async fetch(req) {
      const url = new URL(req.url);

      // POST /submit — JSON URL intake
      if (req.method === "POST" && url.pathname === "/submit") {
        return handleSubmitUrl(req, db);
      }

      // POST /upload — multipart file intake
      if (req.method === "POST" && url.pathname === "/upload") {
        return handleUploadFile(req, db, mediaDir);
      }

      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: "HTTP intake listening",
      address: `http://127.0.0.1:${server.port}`,
      routes: ["POST /submit", "POST /upload"],
    }),
  );

  return { server };
}

async function handleSubmitUrl(req: Request, db: Database): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const rawUrl = typeof body["url"] === "string" ? body["url"] : null;
  if (!rawUrl) {
    return jsonError(400, "Missing or invalid 'url' field");
  }

  // Security: validate before any DB operation (T-02-02 SSRF guard)
  if (!isInstagramReelUrl(rawUrl)) {
    return jsonError(
      400,
      "Not a valid Instagram reel URL. Expected: https://www.instagram.com/reel/<shortcode>/",
    );
  }

  try {
    const result = await submitUrl(rawUrl, db);
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: result.duplicate ? "url duplicate" : "url queued",
        submissionId: result.submissionId,
        url: rawUrl,
      }),
    );
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(400, msg);
  }
}

async function handleUploadFile(req: Request, db: Database, mediaDir: string): Promise<Response> {
  let formData: Awaited<ReturnType<Request["formData"]>>;
  try {
    formData = await req.formData();
  } catch {
    return jsonError(400, "Could not parse multipart form data");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, "Missing 'file' field in form data");
  }

  // Validate extension (T-02-04: reject non-video)
  const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(ext)) {
    return jsonError(400, `Unsupported file extension: "${ext}". Accepted: mp4, mov, webm, mkv`);
  }

  // Validate MIME type (best-effort — browsers may send octet-stream)
  const mime = file.type.toLowerCase().split(";")[0].trim();
  if (mime && mime !== "" && !VIDEO_MIME_TYPES.has(mime)) {
    return jsonError(400, `Unsupported content type: "${file.type}"`);
  }

  // Size cap (T-02-04: DoS guard)
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError(413, `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MiB)`);
  }

  // Security: path traversal guard — reject filename with '..' (T-02-03)
  if (file.name.includes("..") || file.name.includes("/") || file.name.includes("\\")) {
    return jsonError(400, `Rejected filename: "${file.name}" (path traversal attempt)`);
  }

  const fileBytes = Buffer.from(await file.arrayBuffer());

  try {
    const result = await submitFile(fileBytes, file.name, mediaDir, db);
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: result.duplicate ? "file duplicate" : "file queued",
        submissionId: result.submissionId,
        filename: file.name,
        sizeBytes: fileBytes.length,
      }),
    );
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("path traversal")) {
      return jsonError(400, msg);
    }
    return jsonError(500, `Upload failed: ${msg}`);
  }
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
