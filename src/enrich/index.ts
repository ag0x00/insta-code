import { getFinding, markEnriched, setEnrichStatus } from "../db/queries";
import { notify } from "../shared/notify";
import type { EnrichJob, Env } from "../shared/types";
import { transcribe } from "./transcribe";
import { analyzeVisuals } from "./vision";

const MAX_ATTEMPTS = 3;

async function processOne(env: Env, job: EnrichJob): Promise<void> {
  const finding = await getFinding(env.DB, job.findingId);
  if (!finding) throw new Error(`finding not found: ${job.findingId}`);

  await setEnrichStatus(env.DB, job.findingId, "processing");

  // Transcription and vision are independent; run both, tolerate a missing input.
  const tasks: Promise<void>[] = [];
  if (finding.audio_key) tasks.push(transcribe(env, job.findingId, finding.audio_key));
  if (finding.keyframe_keys.length > 0) {
    tasks.push(analyzeVisuals(env, job.findingId, finding.keyframe_keys));
  }
  await Promise.all(tasks);

  await markEnriched(env.DB, job.findingId);
  await notify(env, job.telegramChatId, "🧠 Understood — transcript + visual analysis ready.");
}

/** Cloudflare Queue consumer for `reel-enrich`. max_batch_size is 1. */
export async function handleEnrichBatch(
  batch: MessageBatch<EnrichJob>,
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    const job = msg.body;
    try {
      await processOne(env, job);
      msg.ack();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("enrich failed", job.findingId, message);
      await setEnrichStatus(env.DB, job.findingId, "failed");
      if (msg.attempts >= MAX_ATTEMPTS) {
        msg.ack(); // give up; dead-letter handled by queue config
      } else {
        msg.retry();
      }
    }
  }
}
