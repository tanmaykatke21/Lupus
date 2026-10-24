// Server-only Gemini helpers. Model is configurable; the SDK's docs use gemini-flash-latest.
import { GoogleGenAI } from "@google/genai";

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

let client: GoogleGenAI | null = null;

export class NotConfiguredError extends Error {}

// Check before entering a `use cache` function: errors thrown inside one lose their class.
export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;

export function gemini() {
  if (!process.env.GEMINI_API_KEY) throw new NotConfiguredError("GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

// Tried in order when a model is overloaded (503/504/429) or slow.
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest";
const ATTEMPT_TIMEOUT_MS = 12_000;

function retryable(err: unknown) {
  const msg = String((err as Error)?.message ?? err);
  return /"code":\s*(429|500|503|504)|UNAVAILABLE|DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED|timed? ?out|aborted/i.test(msg);
}

/** Calls Gemini with a JSON schema and returns the parsed object (still validate it!). */
export async function generateJson<T>(opts: {
  system: string;
  contents: Parameters<GoogleGenAI["models"]["generateContent"]>[0]["contents"];
  schema: unknown;
}): Promise<T> {
  const models = [...new Set([GEMINI_MODEL, FALLBACK_MODEL])];
  let lastErr: unknown;
  for (const model of models) {
    try {
      const res = await gemini().models.generateContent({
        model,
        contents: opts.contents,
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseJsonSchema: opts.schema,
          temperature: 0.2,
          abortSignal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        },
      });
      const text = res.text;
      if (!text) throw new Error("Gemini returned no text");
      return JSON.parse(text) as T;
    } catch (err) {
      lastErr = err;
      if (!retryable(err)) throw err;
      console.warn(`[gemini] ${model} unavailable, trying next model`);
    }
  }
  throw lastErr;
}
