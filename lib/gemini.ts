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

/** Calls Gemini with a JSON schema and returns the parsed object (still validate it!). */
export async function generateJson<T>(opts: {
  system: string;
  contents: Parameters<GoogleGenAI["models"]["generateContent"]>[0]["contents"];
  schema: unknown;
}): Promise<T> {
  const res = await gemini().models.generateContent({
    model: GEMINI_MODEL,
    contents: opts.contents,
    config: {
      systemInstruction: opts.system,
      responseMimeType: "application/json",
      responseJsonSchema: opts.schema,
      temperature: 0.2,
    },
  });
  const text = res.text;
  if (!text) throw new Error("Gemini returned no text");
  return JSON.parse(text) as T;
}
