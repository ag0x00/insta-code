import { getContainer } from "@cloudflare/containers";
import {
  getFindingIdBySubmission,
  getSubmission,
  setSubmissionStatus,
  upsertFinding,
} from "../db/queries";
import { notify } from "../shared/notify";
import type { Env, IngestResult, JobMessage } from "../shared/types";

const MAX_ATTEMPTS = 3;

async function runIngest(env: Env, job: JobMessage): Promise<IngestResult> {
  const stub = getContainer(env.INGEST_CONTAINER, job.submissionId);
  const res = await stub.fetch(
    new Request("http://ingest/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job),
    }),
  );
  if (!res.ok) {
    throw new Error(`ingest container responded ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as IngestResult;
}

async function processOne(env: Env, job: JobMessage): Promise<void> {
  await setSubmissionStatus(env.DB, job.submissionId, "processing");
  const result = await runIngest(env, job);

  const submission = await getSubmission(env.DB, job.submissionId);
  await upsertFinding(env.DB, {
    id: crypto.randomUUID(),
    submissionId: job.submissionId,
    reelShortcode: submission?.reel_shortcode ?? null,
    result,
  });
  await setSubmissionStatus(env.DB, job.submissionId, "done");

  const label = result.metadata.caption?.slice(0, 80) ?? submission?.reel_shortcode ?? "reel";
  await notify(env, job.telegramChatId, `✓ Captured: ${label}`);

  // Hand off to the enrichment pipeline (transcription + vision).
  const findingId = await getFindingIdBySubmission(env.DB, job.submissionId);
  if (findingId) {
    await env.ENRICH_QUEUE.send({ findingId, telegramChatId: job.telegramChatId });
  }
}

/** Cloudflare Queue consumer for `reel-ingest`. max_batch_size is 1 (see wrangler.toml). */
export async function handleIngestBatch(
  batch: MessageBatch<JobMessage>,
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    const job = msg.body;
    try {
      await processOne(env, job);
      msg.ack();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("ingest failed", job.submissionId, message);
      await setSubmissionStatus(env.DB, job.submissionId, "failed", message);

      // Only notify the user once we've exhausted retries (avoid spam).
      if (msg.attempts >= MAX_ATTEMPTS) {
        await notify(
          env,
          job.telegramChatId,
          `⚠️ Couldn't capture that one — download failed. Try sending the video file instead.`,
        );
        msg.ack(); // give up; dead-letter handled by queue config
      } else {
        msg.retry();
      }
    }
  }
}
