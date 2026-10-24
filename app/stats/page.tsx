import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { evaluate, type Score } from "@/lib/accuracy";
import { dbConfigured } from "@/lib/db";
import { accuracyRows } from "@/lib/history";

export const metadata: Metadata = { title: "Lupus · ETA accuracy" };

const s = (sec: number) => (sec >= 60 ? `${(sec / 60).toFixed(1)} min` : `${Math.round(sec)} s`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const day = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function ScoreCard({ title, score, accent }: { title: string; score: Score; accent?: boolean }) {
  return (
    <div className={`plate rivets rounded-2xl p-4 ${accent ? "ring-2 ring-brass" : ""}`}>
      <p className="text-xs font-bold uppercase tracking-widest text-muted">{title}</p>
      <p className="font-display text-4xl font-bold tabular-nums">{s(score.mae)}</p>
      <p className="text-sm text-muted">average error</p>
      <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
        <dt className="text-muted">Median</dt><dd className="tabular-nums">{s(score.median)}</dd>
        <dt className="text-muted">Within 1 min</dt><dd className="tabular-nums">{pct(score.within60)}</dd>
      </dl>
    </div>
  );
}

async function Results() {
  await connection();
  if (!dbConfigured()) {
    return <p className="rounded-xl bg-warn/15 p-4">Tiger Data isn&apos;t connected (DATABASE_URL is unset), so there&apos;s nothing to measure yet.</p>;
  }
  const rows = await accuracyRows();
  const r = evaluate(rows);
  if (r.testRows < 20) {
    return <p className="rounded-xl bg-warn/15 p-4">Only {rows.length} measured arrivals so far. Keep the poller running; results appear after a few dozen arrivals.</p>;
  }
  const better = r.etaSpot.mae > 0 ? 1 - r.lupus.mae / r.etaSpot.mae : 0;
  return (
    <>
      <p className="mb-4 text-lg">
        On {r.testRows.toLocaleString()} held-out bus arrivals, Lupus&apos;s ETAs were off by{" "}
        <strong>{s(r.lupus.mae)}</strong> on average versus <strong>{s(r.etaSpot.mae)}</strong> for ETA Spot
        {better > 0 ? <> (<strong>{pct(better)} smaller</strong>)</> : <> (no improvement yet)</>}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <ScoreCard title="ETA Spot" score={r.etaSpot} />
        <ScoreCard title="Lupus" score={r.lupus} accent />
      </div>
      <table className="mt-6 w-full text-sm">
        <caption className="mb-2 text-left font-display font-bold">By how far ahead the prediction was made</caption>
        <thead><tr className="text-left text-muted"><th className="py-1">Horizon</th><th>ETA Spot</th><th>Lupus</th><th>Arrivals</th></tr></thead>
        <tbody>
          {r.byHorizon.map(h => (
            <tr key={h.horizonMin} className="border-t border-line">
              <td className="py-1">{h.horizonMin}–{h.horizonMin === 2 ? 5 : h.horizonMin === 5 ? 10 : 20} min</td>
              <td className="tabular-nums">{s(h.etaSpot.mae)}</td>
              <td className="tabular-nums">{s(h.lupus.mae)}</td>
              <td className="tabular-nums">{h.etaSpot.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted">
        Data {r.from && day(r.from)} to {r.to && day(r.to)}. Trained on the first {r.trainRows.toLocaleString()} arrivals,
        tested on the last {r.testRows.toLocaleString()}.
      </p>
    </>
  );
}

export default function StatsPage() {
  return (
    <main className="mx-auto h-full max-w-2xl overflow-y-auto px-4 py-8">
      <Link href="/" className="text-sm text-muted underline">← Back to the map</Link>
      <h1 className="mt-2 font-display text-3xl font-bold">How accurate are bus ETAs?</h1>
      <p className="mb-6 text-muted">Measured from live Stony Brook bus data recorded in Tiger Data.</p>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-2xl bg-surface-2" />}>
        <Results />
      </Suspense>
      <section className="mt-8 space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-lg font-bold">Method</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Every 10 seconds we record each bus&apos;s position, and every minute ETA Spot&apos;s predicted arrival time for every stop.</li>
          <li>A bus &ldquo;arrives&rdquo; when its GPS position comes within 30 m of a stop on its route. For each arrival we take ETA Spot&apos;s latest prediction for that bus and stop made 2–5, 5–10 and 10–20 minutes earlier, and record the error (actual − predicted).</li>
          <li>We split arrivals by time: the earliest 70% are training data, the latest 30% are the test set. Nothing from the test period is used for training.</li>
          <li>The Lupus model takes ETA Spot&apos;s prediction and adds the average training error for the same route, hour of day and horizon (falling back to broader groups when there are fewer than 8 samples).</li>
          <li>Both models are scored on exactly the same test arrivals. We report mean and median absolute error and the share within one minute.</li>
        </ol>
        <p className="text-muted">Limits: arrivals are detected from GPS pings every ~10 s, so each actual time can be off by a few seconds; buses that skip a stop without passing within 30 m are not counted.</p>
      </section>
    </main>
  );
}
