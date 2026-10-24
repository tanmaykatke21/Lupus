// Prints the /stats accuracy study from the terminal: `npm run accuracy`.
import { config } from "dotenv";
import postgres from "postgres";
import { evaluate } from "../lib/accuracy";
import { ACCURACY_ROWS } from "../lib/queries";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const rows = await sql.unsafe<{ time: Date; route_id: number; stop_id: number; horizon_min: number; hour: number; error_sec: number }[]>(ACCURACY_ROWS);
  await sql.end();
  const r = evaluate(rows.map(x => ({ time: x.time.getTime(), routeId: x.route_id, stopId: x.stop_id, horizonMin: x.horizon_min, hour: x.hour, errorSec: x.error_sec })));
  const f = (n: number) => `${n.toFixed(0)} s`;
  console.log(`arrivals: ${rows.length} (train ${r.trainRows}, test ${r.testRows})`);
  console.log(`ETA Spot  MAE ${f(r.etaSpot.mae)}  median ${f(r.etaSpot.median)}  within 1 min ${(r.etaSpot.within60 * 100).toFixed(0)}%`);
  console.log(`Lupus     MAE ${f(r.lupus.mae)}  median ${f(r.lupus.median)}  within 1 min ${(r.lupus.within60 * 100).toFixed(0)}%`);
  for (const h of r.byHorizon) console.log(`  horizon ${h.horizonMin}+ min: ETA Spot ${f(h.etaSpot.mae)} vs Lupus ${f(h.lupus.mae)} (n=${h.etaSpot.n})`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
