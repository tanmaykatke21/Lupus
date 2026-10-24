import { FunctionCallingConfigMode, GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";
import type { ModelClient } from "./run";
import { TOOL_DECLARATIONS } from "./tools";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/** ModelClient backed by the Gemini API. The key stays on the server; it is never sent to the browser. */
export function geminiClient(apiKey: string, model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL): ModelClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async step({ system, turns }) {
      const res = await ai.models.generateContent({
        model,
        contents: turns as Content[],
        config: {
          systemInstruction: system,
          temperature: 0.2,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS as unknown as FunctionDeclaration[] }],
          // Every turn must be a tool call, so the final answer always arrives through show_answer.
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
        },
      });
      const calls = (res.functionCalls ?? [])
        .filter((fc) => fc.name)
        .map((fc) => ({ id: fc.id, name: fc.name as string, args: (fc.args ?? {}) as Record<string, unknown> }));
      // Send the model's own parts back unchanged: newer models attach signatures to tool calls that must be returned.
      const parts = res.candidates?.[0]?.content?.parts ?? calls.map((c) => ({ functionCall: c }));
      return {
        calls,
        modelTurn: { role: "model", parts: parts as Record<string, unknown>[] },
        text: calls.length === 0 ? res.text : undefined,
      };
    },
  };
}
