// ModelClient backed by Gemini function calling. The key stays on the server.
import { FunctionCallingConfigMode, type Content, type FunctionDeclaration } from "@google/genai";
import { gemini, GEMINI_MODEL } from "../gemini";
import type { ModelClient } from "./run";
import { TOOL_DECLARATIONS } from "./tools";

const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest";
const STEP_TIMEOUT_MS = 15_000;
const retryable = (err: unknown) =>
  /"code":\s*(429|500|503|504)|UNAVAILABLE|DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED|timed? ?out|aborted/i.test(String((err as Error)?.message ?? err));

export function geminiClient(): ModelClient {
  return {
    async step({ system, turns }) {
      let lastErr: unknown;
      // Overloaded or slow? Try the lighter model before giving up.
      for (const model of [...new Set([GEMINI_MODEL, FALLBACK_MODEL])]) {
        try {
          const res = await gemini().models.generateContent({
            model,
            contents: turns as Content[],
            config: {
              systemInstruction: system,
              temperature: 0.2,
              tools: [{ functionDeclarations: TOOL_DECLARATIONS as unknown as FunctionDeclaration[] }],
              // Every turn must be a tool call, so the final answer always arrives through show_answer.
              toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
              abortSignal: AbortSignal.timeout(STEP_TIMEOUT_MS),
            },
          });
          const calls = (res.functionCalls ?? [])
            .filter(fc => fc.name)
            .map(fc => ({ id: fc.id, name: fc.name as string, args: (fc.args ?? {}) as Record<string, unknown> }));
          // Return the model's own parts unchanged: newer models attach signatures to tool calls.
          const parts = res.candidates?.[0]?.content?.parts ?? calls.map(c => ({ functionCall: c }));
          return { calls, modelTurn: { role: "model", parts: parts as Record<string, unknown>[] }, text: calls.length ? undefined : res.text };
        } catch (err) {
          lastErr = err;
          if (!retryable(err)) throw err;
          console.warn(`[agent] ${model} unavailable, trying next model`);
        }
      }
      throw lastErr;
    },
  };
}
