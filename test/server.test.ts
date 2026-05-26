/**
 * server.test.ts — Task 1 RED phase tests.
 *
 * Tests the localhost-only HTTP intake endpoint for:
 *   - POST /submit {url} → valid reel URL creates a pending job (200)
 *   - POST /submit {url} → duplicate URL returns {duplicate:true}, no second job
 *   - POST /submit {url} → non-Instagram URL returns 400, nothing inserted
 *   - POST /upload (multipart) → video file creates source_type='file' submission + job
 *   - Server binds to 127.0.0.1 only
 */

import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb } from "../src/db/db";
import { runMigration } from "../src/db/migrate";
import { startServer } from "../src/intake/server";
import os from "os";
import path from "path";
import fs from "fs";

// Use a temp DB + temp media dir for each test
let db: Database;
let mediaDir: string;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeEach(async () => {
  // Create isolated temp DB
  const dbPath = path.join(os.tmpdir(), `reel-atlas-server-test-${crypto.randomUUID()}.db`);
  await runMigration(dbPath);
  db = openDb(dbPath);

  // Create isolated temp media dir
  mediaDir = path.join(os.tmpdir(), `reel-atlas-media-${crypto.randomUUID()}`);
  fs.mkdirSync(mediaDir, { recursive: true });

  // Start the server on a random port
  const result = startServer({ db, mediaDir, port: 0 });
  server = result.server;
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterEach(() => {
  server.stop(true);
  db.close();
  // Clean up temp media dir
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

describe("POST /submit — URL intake", () => {
  it("accepts a valid reel URL and returns a submission id + queued job", async () => {
    const res = await fetch(`${baseUrl}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.instagram.com/reel/DYeHzvgCURl/" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("submissionId");
    expect(body.duplicate).toBeFalsy();

    // A pending job must exist
    const job = db.query<{ status: string }, [string]>(
      "SELECT status FROM jobs WHERE submission_id = ?",
    ).get(body.submissionId as string);
    expect(job).not.toBeNull();
    expect(job?.status).toBe("pending");
  });

  it("returns a duplicate response and no second job for a repeated URL", async () => {
    const url = "https://www.instagram.com/reel/DYeHzvgCURl/";

    // First submission
    await fetch(`${baseUrl}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    // Second submission — same URL (same shortcode)
    const res = await fetch(`${baseUrl}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.duplicate).toBe(true);

    // Only one job should exist
    const jobs = db.query<{ id: string }, []>("SELECT id FROM jobs").all();
    expect(jobs.length).toBe(1);
  });

  it("returns 400 for a non-Instagram URL and inserts nothing", async () => {
    const res = await fetch(`${baseUrl}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/not-a-reel" }),
    });
    expect(res.status).toBe(400);

    const submissions = db.query<{ id: string }, []>("SELECT id FROM submissions").all();
    expect(submissions.length).toBe(0);
  });

  it("returns 400 for a missing url field", async () => {
    const res = await fetch(`${baseUrl}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /upload — file intake", () => {
  it("accepts a video file upload and creates a source_type='file' submission + job", async () => {
    const videoContent = Buffer.from("FAKE_VIDEO_CONTENT_FOR_TEST");
    const form = new FormData();
    const blob = new Blob([videoContent], { type: "video/mp4" });
    form.append("file", blob, "test-reel.mp4");

    const res = await fetch(`${baseUrl}/upload`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("submissionId");
    expect(body.duplicate).toBeFalsy();

    // Check submission row
    const sub = db.query<{ source_type: string; file_path: string | null }, [string]>(
      "SELECT source_type, file_path FROM submissions WHERE id = ?",
    ).get(body.submissionId as string);
    expect(sub).not.toBeNull();
    expect(sub?.source_type).toBe("file");
    expect(sub?.file_path).not.toBeNull();

    // File must exist on disk
    expect(fs.existsSync(sub!.file_path!)).toBe(true);

    // A pending job must exist
    const job = db.query<{ status: string }, [string]>(
      "SELECT status FROM jobs WHERE submission_id = ?",
    ).get(body.submissionId as string);
    expect(job?.status).toBe("pending");
  });

  it("deduplicates file uploads by content hash — same content creates only one submission", async () => {
    const videoContent = Buffer.from("FAKE_VIDEO_CONTENT_DEDUP_TEST");
    const form1 = new FormData();
    form1.append("file", new Blob([videoContent], { type: "video/mp4" }), "reel-a.mp4");

    const res1 = await fetch(`${baseUrl}/upload`, { method: "POST", body: form1 });
    expect(res1.status).toBe(200);

    const form2 = new FormData();
    form2.append("file", new Blob([videoContent], { type: "video/mp4" }), "reel-b.mp4");

    const res2 = await fetch(`${baseUrl}/upload`, { method: "POST", body: form2 });
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as Record<string, unknown>;
    expect(body2.duplicate).toBe(true);

    // Only one job
    const jobs = db.query<{ id: string }, []>("SELECT id FROM jobs").all();
    expect(jobs.length).toBe(1);
  });

  it("rejects a filename containing .. (path traversal)", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("data")], { type: "video/mp4" }), "../evil.mp4");

    const res = await fetch(`${baseUrl}/upload`, { method: "POST", body: form });
    expect(res.status).toBe(400);
  });

  it("returns 400 when no file is attached", async () => {
    const form = new FormData();
    const res = await fetch(`${baseUrl}/upload`, { method: "POST", body: form });
    expect(res.status).toBe(400);
  });
});

describe("Server bind address", () => {
  it("is bound to 127.0.0.1 not 0.0.0.0", () => {
    // The hostname property on the Bun server is what we check
    expect(server.hostname).toBe("127.0.0.1");
  });
});
