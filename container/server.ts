import { ingest } from "./ingest";
import type { JobMessage } from "../src/shared/dto";

const PORT = Number(process.env.PORT ?? 8080);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return new Response("ok");
    }

    if (req.method === "POST" && url.pathname === "/ingest") {
      let job: JobMessage;
      try {
        job = (await req.json()) as JobMessage;
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      try {
        const result = await ingest(job);
        return Response.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("ingest error", job.submissionId, message);
        return Response.json({ error: message }, { status: 500 });
      }
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`ingest container listening on :${PORT}`);
