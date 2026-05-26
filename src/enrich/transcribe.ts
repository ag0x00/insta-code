import { updateFindingTranscript } from "../db/queries";
import type { Env } from "../shared/types";
import { parseGroqVerboseJson } from "./parse";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3";

/** Fetches the finding's audio from R2, transcribes via Groq, and stores the result. */
export async function transcribe(env: Env, findingId: string, audioKey: string): Promise<void> {
  const obj = await env.MEDIA.get(audioKey);
  if (!obj) throw new Error(`audio not found in R2: ${audioKey}`);
  const audio = await obj.arrayBuffer();

  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/mpeg" }), "audio.mp3");
  form.append("model", GROQ_MODEL);
  form.append("response_format", "verbose_json");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`groq transcription ${res.status}: ${await res.text()}`);
  }

  const result = parseGroqVerboseJson(await res.json());
  await updateFindingTranscript(env.DB, findingId, result);
}
