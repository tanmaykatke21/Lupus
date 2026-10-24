import { connection } from "next/server";
import { geminiConfigured } from "@/lib/gemini";
import { CACHE, errorJson, json, rateLimit } from "@/lib/http";
import { extractSchedule } from "@/lib/scheduleOcr";

const MAX_BYTES = 6 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

// POST multipart/form-data with `image` → { classes } for the user to review.
export async function POST(request: Request) {
  await connection();
  const limited = rateLimit(request, 6);
  if (limited) return limited;
  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return json({ error: "Attach a screenshot as `image`" }, CACHE.none, 400);
  if (!TYPES.includes(file.type)) return json({ error: "Use a PNG, JPEG, WebP or HEIC image" }, CACHE.none, 415);
  if (file.size > MAX_BYTES) return json({ error: "Image must be under 6 MB" }, CACHE.none, 413);
  if (!geminiConfigured()) return json({ error: "Screenshot import is not configured" }, CACHE.none, 503);
  try {
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    return json({ classes: await extractSchedule(data, file.type) }, CACHE.none);
  } catch (err) {
    return errorJson(err);
  }
}
