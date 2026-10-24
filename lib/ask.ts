// Natural-language requests → a validated action. Gemini only chooses among ids we supply;
// coordinates and train times always come from our own data.
import schedule from "@/data/lirr-stony-brook.json";
import { generateJson } from "./gemini";
import { upcomingTrains, type LirrSchedule, type LirrTrain, type RealtimeMap } from "./lirr";
import { PLACES, type PlaceCategory } from "./places";
import { campusDate, campusTime } from "./lirr";

export interface AskClass { id: string; course: string; title?: string }

export type AskAction =
  | { type: "place"; placeId: string; reply: string }
  | { type: "category"; category: PlaceCategory; reply: string }
  | { type: "train"; train: LirrTrain; reply: string }
  | { type: "class"; classId: string; reply: string }
  | { type: "none"; reply: string };

interface RawAnswer {
  action: "place" | "category" | "train" | "class" | "none";
  placeId?: string | null;
  category?: string | null;
  trainDirection?: "west" | "east" | null;
  trainAfter?: string | null; // "HH:MM" 24h, campus time
  classId?: string | null;
  reply: string;
}

const CATEGORIES: PlaceCategory[] = ["academic", "dorm", "dining", "medical", "transit", "athletics", "services", "parking"];

export function askSchema(classes: AskClass[]) {
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: ["place", "category", "train", "class", "none"] },
      placeId: { type: "string", enum: PLACES.map(p => p.id) },
      category: { type: "string", enum: CATEGORIES },
      trainDirection: { type: "string", enum: ["west", "east"] },
      trainAfter: { type: "string", description: "Earliest departure the user wants, HH:MM 24h. Omit for the next train." },
      // An empty enum is invalid, so only offer classId when there are classes.
      ...(classes.length ? { classId: { type: "string", enum: classes.map(c => c.id) } } : {}),
      reply: { type: "string", description: "One short sentence for the user, in their language" },
    },
    required: ["action", "reply"],
  };
}

export function askPrompt(classes: AskClass[], nowLabel: string) {
  return [
    "You route requests for a Stony Brook University campus transit app. Pick exactly one action.",
    "- place: the user named or described a specific campus place. Use placeId from the list.",
    "- category: the user wants the nearest of a kind (coffee/food → dining, sleep/dorm → dorm, doctor/ER → medical).",
    "- train: the user wants to catch an LIRR train from Stony Brook. 'the city', 'NYC', 'Penn', 'Manhattan' → west; 'Port Jeff' → east.",
    "  Put the earliest acceptable departure time in trainAfter (e.g. '6pm train' → '18:00'); null means the next one.",
    "- class: the user refers to one of their classes. Use classId from the list.",
    "- none: anything else; explain briefly in reply.",
    "Only include the fields your action needs. Never invent places, ids, coordinates or train times.",
    `Current campus time: ${nowLabel}.`,
    `Places (id: name [category] aliases): ${PLACES.map(p => `${p.id}: ${p.name} [${p.category}] ${p.aliases.join(", ")}`).join("; ")}`,
    `User's classes (id: course title): ${classes.length ? classes.map(c => `${c.id}: ${c.course} ${c.title ?? ""}`).join("; ") : "none"}`,
  ].join("\n");
}

/** Validates Gemini's raw answer against our own data and resolves trains. */
export function resolveAnswer(raw: RawAnswer, classes: AskClass[], now: number, rt: RealtimeMap | null): AskAction {
  const reply = typeof raw.reply === "string" ? raw.reply.slice(0, 200) : "";
  switch (raw.action) {
    case "place":
      if (raw.placeId && PLACES.some(p => p.id === raw.placeId)) return { type: "place", placeId: raw.placeId, reply };
      break;
    case "category":
      if (raw.category && (CATEGORIES as string[]).includes(raw.category)) {
        return { type: "category", category: raw.category as PlaceCategory, reply };
      }
      break;
    case "class":
      if (raw.classId && classes.some(c => c.id === raw.classId)) return { type: "class", classId: raw.classId, reply };
      break;
    case "train": {
      const direction = raw.trainDirection === "east" ? "east" : "west";
      let after = now;
      if (raw.trainAfter && /^\d{1,2}:\d{2}$/.test(raw.trainAfter)) {
        const [h, m] = raw.trainAfter.split(":").map(Number);
        const t = campusTime(campusDate(now), h * 60 + m);
        after = Math.max(now, t);
      }
      const trains = upcomingTrains(schedule as LirrSchedule, rt, { now: after, kind: "departures", direction, limit: 5, windowMin: 18 * 60 })
        .filter(t => !t.canceled);
      if (trains[0]) return { type: "train", train: trains[0], reply };
      return { type: "none", reply: "I couldn't find a matching train in the schedule." };
    }
  }
  return { type: "none", reply: reply || "Sorry, I didn't catch that. Try a building or “next train to the city”." };
}

export async function ask(q: string, classes: AskClass[], now: number, rt: RealtimeMap | null) {
  const nowLabel = new Date(now).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", hour: "numeric", minute: "2-digit" });
  const raw = await generateJson<RawAnswer>({
    system: askPrompt(classes, nowLabel),
    contents: q,
    schema: askSchema(classes),
  });
  return resolveAnswer(raw, classes, now, rt);
}
