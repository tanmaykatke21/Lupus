// Offline stand-in for Gemini (AGENT_MODE=mock): demos without a key or quota, and tests.
// Understands simple "from X to Y by <time>" questions and uses the same tools as the real agent.
// From Tanmay's agent, adapted to our place search.
import { scorePlaces, type Place } from "../places";
import type { ModelClient, ToolCall } from "./run";

const SKIP = ["the", "and", "for", "lab", "class", "will", "make", "at", "get", "to", "me", "my"];

/** Places named in free text: every 1–4 word phrase, longest first, without overlaps. */
function placesIn(text: string): { place: Place; at: number }[] {
  const words = text.toLowerCase().replace(/[^a-z0-9&' ]+/g, " ").split(/\s+/).filter(Boolean);
  const found: { place: Place; at: number; len: number }[] = [];
  for (let len = 4; len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const phrase = words.slice(i, i + len).join(" ");
      if (phrase.length < 3 || SKIP.includes(phrase)) continue;
      const hit = scorePlaces(phrase, 1)[0];
      const overlaps = found.some(f => i < f.at + f.len && f.at < i + len);
      if (hit && hit.score >= 80 && !overlaps && !found.some(f => f.place.id === hit.place.id)) found.push({ place: hit.place, at: i, len });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** "at 2", "by 2:30pm", "at 14:00" → "14:00" (afternoon for 1–7 without am/pm, like a class time). */
export function deadlineIn(text: string): string | null {
  const m = /\b(?:at|by|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 7) h += 12;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function mockClient(hasLocation: boolean): ModelClient {
  return {
    async step({ turns }) {
      // Read every rider message so a follow-up like "from SAC" combines with the question.
      const texts: string[] = [];
      let askedForStart = false;
      for (const t of turns) {
        const text = (t.parts[0] as { text?: string })?.text;
        if (typeof text !== "string") continue;
        if (t.role === "model") askedForStart = /starting from/i.test(text);
        else texts.push(askedForStart ? `from ${text}` : text);
      }
      const question = texts.join(" ");
      const last = turns.at(-1)?.parts[0] as { functionResponse?: { name: string; response: Record<string, unknown> } } | undefined;
      let calls: ToolCall[];

      if (last?.functionResponse?.name === "plan_trip") {
        const r = last.functionResponse.response;
        calls = [r.error
          ? { name: "show_answer", args: { verdict: "need_info", message: String(r.error) } }
          : { name: "show_answer", args: { verdict: "info", message: "Here's your fastest way there right now.", plan_id: r.plan_id } }];
      } else {
        const found = placesIn(question);
        const words = question.toLowerCase().replace(/[^a-z0-9&' ]+/g, " ").split(/\s+/).filter(Boolean);
        const marked = found.find(f => words[f.at - 1] === "from" || (words[f.at - 1] === "at" && /^(i'?m|am)$/.test(words[f.at - 2] ?? "")));
        const from = marked?.place ?? (found.length >= 2 ? found[0].place : null);
        const to = found.filter(f => f.place !== from).at(-1)?.place;
        if (!to) {
          calls = [{ name: "show_answer", args: { verdict: "need_info", message: "Where are you going? Try a building name, like Javits." } }];
        } else if (!from && !hasLocation) {
          calls = [{ name: "show_answer", args: { verdict: "need_info", message: `Where are you starting from on the way to ${to.name}?` } }];
        } else {
          const arriveBy = deadlineIn(question);
          calls = [{ name: "plan_trip", args: { from_place_id: from?.id ?? "current_location", to_place_id: to.id, ...(arriveBy && { arrive_by: arriveBy }) } }];
        }
      }
      return { calls, modelTurn: { role: "model", parts: calls.map(c => ({ functionCall: c })) } };
    },
  };
}
