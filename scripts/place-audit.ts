/**
 * Placement failure taxonomy, measured over real GDELT (HANDOFF.md §5.2).
 *
 *   fetch N bundles -> parse -> filter -> explainPlacement() -> tabulate
 *
 * **Why this exists.** §5.2's 69.7% pin accuracy is a gate the project passes
 * once. What makes the map better is knowing *which* placements are wrong and
 * why, and that could not be read off `{kind, location}` — 15 wrong rule-H
 * placements had to be classified by hand, at which point they turned out to be
 * five mechanically distinct classes. `explainPlacement()` exposes the counts
 * the rule reasoned over; this script tabulates them at a scale no human can
 * judge.
 *
 * **This measures mechanism, not correctness.** Nothing here knows whether a
 * placement is right — only a human reading the headline does (§5.1). What it
 * gives you is the population frequency of each *suspicious shape*, so that a
 * class worth 3 records in a 60-record audit can be sized against the whole
 * feed before anyone writes a rule to fix it. The hand audit says which shapes
 * correlate with being wrong; this says how much of the feed has them.
 *
 * **Do not turn a signal here into a rule without a judged sample.** The
 * project has already been burned by exactly that: mention count looked like it
 * graded pin confidence on six records (p=0.053) and went flat on 110
 * (p=0.736). Frequency is not accuracy. See §5.2 decision 3.
 *
 * Run:  node scripts/place-audit.ts [bundles] [--examples N]
 *       bundles defaults to 4 (one hour of GDELT), --examples prints the
 *       highest-suspicion placements for eyeballing.
 */

import { fetchBundle, newestStamp, shiftStamp } from "../worker/fetch.ts";
import { filterArticles } from "../worker/filter.ts";
import { parseBundle } from "../worker/parse.ts";
import { type PlacementTrace, explainPlacement } from "../worker/place.ts";
import { loadRefData } from "../worker/refdata.ts";
import type { Article } from "../lib/types.ts";

const DEFAULT_BUNDLES = 4;

/**
 * The suspicious shapes, each one a failure class from the hand audit.
 *
 * These are *predicates over the trace*, not verdicts. `lone-mention` is the
 * Windsor Machines shape (a corporate earnings story whose every location
 * appeared once, pinned confidently at whichever came first); `narrow-win` is
 * the BTCC shape (the article previews Knockhill and recaps Thruxton, so the
 * subject loses 4-2 to the background). A story can carry several.
 */
const SHAPES: { name: string; note: string; test: (t: PlacementTrace) => boolean }[] = [
  {
    name: "lone-mention",
    note: "winner mentioned once — the story may have no place at all",
    test: (t) => t.placement.kind !== "DROP" && t.winnerMentions === 1,
  },
  {
    name: "tie-broken",
    note: "winner tied at the top and won on earliest offset alone",
    test: (t) => t.tieBroken,
  },
  {
    name: "narrow-win",
    note: "runner-up within one mention — frequency is not aboutness",
    test: (t) => {
      const level = t.placement.kind === "PIN" ? t.city : (t.adm1 ?? t.country);
      return !!level?.runnerUp && level.mentions - level.runnerUp.mentions <= 1;
    },
  },
  {
    name: "margin-near-miss",
    note: "a container margin was missed by <20% — the pin is a coin flip",
    test: (t) =>
      t.reason === "city-survives" &&
      ((t.adm1Ratio !== null && t.adm1Ratio >= 1.6) ||
        (t.countryRatio !== null && t.countryRatio >= 2.4)),
  },
  {
    name: "runaway-country",
    note: "country cleared 3x by a wide margin — check for source-country bias",
    test: (t) => t.reason === "country-dominates" && (t.countryRatio ?? 0) >= 6,
  },
];

function pct(n: number, total: number): string {
  return total ? `${((100 * n) / total).toFixed(1)}%`.padStart(6) : "     -";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const exampleFlag = args.indexOf("--examples");
  const examples = exampleFlag === -1 ? 0 : Number(args[exampleFlag + 1] ?? 5);
  const bundles = Number(args.find((a) => /^\d+$/.test(a)) ?? DEFAULT_BUNDLES);

  const data = await loadRefData();

  // Walk backwards from the newest completed bundle. Unlike the worker there is
  // no watermark and no state: this is a read-only measurement and must never
  // touch the published pool.
  let stamp = await newestStamp();
  const articles: Article[] = [];
  for (let i = 0; i < bundles; i++) {
    const bundle = await fetchBundle(stamp);
    if (bundle) articles.push(...parseBundle(bundle.csv).articles);
    stamp = shiftStamp(stamp, -15);
  }

  const filtered = filterArticles(articles, data);
  const traces = filtered.kept.map((article) => ({
    article,
    trace: explainPlacement(article, data),
  }));

  const placed = traces.filter(({ trace }) => trace.placement.kind !== "DROP");
  const pins = traces.filter(({ trace }) => trace.placement.kind === "PIN");

  console.log(`\n  ${articles.length} articles, ${filtered.kept.length} after filter\n`);

  console.log("  branch                 n      share");
  const byReason = new Map<string, number>();
  for (const { trace } of traces) byReason.set(trace.reason, (byReason.get(trace.reason) ?? 0) + 1);
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(20)} ${String(n).padStart(5)}  ${pct(n, traces.length)}`);
  }

  console.log(`\n  suspicious shapes, over ${placed.length} placed (${pins.length} pins)`);
  for (const shape of SHAPES) {
    const hits = placed.filter(({ trace }) => shape.test(trace));
    const pinHits = hits.filter(({ trace }) => trace.placement.kind === "PIN");
    console.log(
      `  ${shape.name.padEnd(20)} ${String(hits.length).padStart(5)}  ${pct(hits.length, placed.length)}` +
        `   pins ${String(pinHits.length).padStart(5)}  ${pct(pinHits.length, pins.length)}`,
    );
    console.log(`  ${"".padEnd(20)} ${shape.note}`);
  }

  if (examples) {
    for (const shape of SHAPES) {
      const hits = placed.filter(({ trace }) => shape.test(trace)).slice(0, examples);
      if (!hits.length) continue;
      console.log(`\n  --- ${shape.name} ---`);
      for (const { article, trace } of hits) {
        const level = trace.placement.kind === "PIN" ? trace.city : (trace.adm1 ?? trace.country);
        console.log(`  ${article.title.slice(0, 88)}`);
        console.log(`    ${article.domain}  ->  ${trace.placement.location?.name}  [${trace.reason}]`);
        console.log(
          `    winner x${trace.winnerMentions}` +
            (level?.runnerUp ? `, runner-up ${level.runnerUp.name} x${level.runnerUp.mentions}` : "") +
            (trace.countryRatio !== null ? `, country ${trace.countryRatio.toFixed(1)}x city` : ""),
        );
      }
    }
  }
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
