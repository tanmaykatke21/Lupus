// SOLAR schedule screenshot → structured classes (Gemini vision), validated before use.
import type { ClassEntry } from "./classes";
import { generateJson } from "./gemini";
import { PLACES } from "./places";
import type { DayKey } from "./time";

const DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

interface RawClass {
  course: string;
  title?: string | null;
  days: string[];
  start: string;
  end?: string | null;
  building?: string | null;
  room?: string | null;
  placeId?: string | null;
}

const schema = {
  type: "object",
  properties: {
    classes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          course: { type: "string", description: "Subject and number, e.g. CSE 214" },
          title: { type: "string" },
          days: { type: "array", items: { type: "string", enum: DAYS } },
          start: { type: "string", description: "24h HH:MM" },
          end: { type: "string", description: "24h HH:MM" },
          building: { type: "string", description: "Building exactly as printed" },
          room: { type: "string" },
          placeId: { type: "string", enum: PLACES.map(p => p.id), description: "Omit when unsure" },
        },
        required: ["course", "days", "start"],
      },
    },
  },
  required: ["classes"],
};

const system = [
  "Extract every class meeting from this Stony Brook SOLAR class schedule screenshot.",
  "One entry per course+time (combine days that share a time). Use 24h times.",
  "SOLAR day codes: M=mon, TU=tue, W=wed, TH=thu, F=fri, SA=sat, SU=sun.",
  "Map the building to a placeId from this list when confident, else omit placeId. Common abbreviations: JAVITS=javits, FREY=frey,",
  "NCS=ncs, CS / COM SCI=cs, HUMANITIES=humanities, SBS=sbs, LIFE SCI=life-sci, CHEM=chemistry, PHYSICS=physics,",
  "ENGINEERING=engineering, LGT ENGR=light-eng, HVY ENGR=heavy-eng, HARRIMAN=harriman, ESS=ess, PSY A=psych-a, PSY B=psych-b,",
  "MATH=math-tower, LIBRARY=library, STALLER=staller, UNION=union, ECC=ecc, IACS=iacs, BIOENG=bioeng, OLD CS=cs.",
  `Places: ${PLACES.filter(p => p.category === "academic" || p.category === "services").map(p => `${p.id}=${p.name}`).join(", ")}`,
  "Skip online/asynchronous sections and anything that is not a class meeting. Do not guess times you cannot read.",
].join("\n");

export function validateClasses(raw: RawClass[]): ClassEntry[] {
  return raw
    .filter(c => typeof c.course === "string" && c.course.trim() && TIME.test(c.start) && Array.isArray(c.days))
    .map((c, i) => ({
      id: `c${Date.now().toString(36)}${i}`,
      course: c.course.trim().slice(0, 40),
      title: c.title?.trim().slice(0, 80) || undefined,
      days: c.days.filter((d): d is DayKey => (DAYS as string[]).includes(d)),
      start: c.start.padStart(5, "0"),
      end: c.end && TIME.test(c.end) ? c.end.padStart(5, "0") : undefined,
      building: c.building?.trim().slice(0, 60) || undefined,
      room: c.room?.trim().slice(0, 20) || undefined,
      placeId: c.placeId && PLACES.some(p => p.id === c.placeId) ? c.placeId : null,
    }))
    .filter(c => c.days.length > 0);
}

export async function extractSchedule(imageBase64: string, mimeType: string) {
  const out = await generateJson<{ classes: RawClass[] }>({
    system,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: "Extract the classes." }] }],
    schema,
  });
  return validateClasses(Array.isArray(out.classes) ? out.classes : []);
}
