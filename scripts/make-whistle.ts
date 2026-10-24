// One-time: generate the steam whistle with ElevenLabs sound effects → public/sounds/whistle.mp3.
// Run: `npm run make:whistle` (needs ELEVENLABS_API_KEY in .env.local). Commit the mp3.
import { config } from "dotenv";
import { writeFileSync } from "node:fs";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "Two short blasts of a vintage steam locomotive whistle, clean and bright, no background noise",
      duration_seconds: 2.5,
      prompt_influence: 0.6,
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync("public/sounds/whistle.mp3", buf);
  console.log(`saved public/sounds/whistle.mp3 (${Math.round(buf.length / 1024)} KB)`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
