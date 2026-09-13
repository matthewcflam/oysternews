// Measures mechanism, not correctness: frequency is not accuracy. Don't turn a signal here
// into a rule without a judged sample.

import type { Article } from "../../src/lib/types.ts";
import { fetchBundle, newestStamp, shiftStamp } from "../../worker/fetch.ts";
import { filterArticles } from "../../worker/filter.ts";
import { parseBundle } from "../../worker/parse.ts";
import { explainPlacement, type PlacementTrace } from "../../worker/place.ts";
import { loadRefData } from "../../worker/refdata.ts";

const DEFAULT_BUNDLES = 4;

// lone-mention's pins column must read 0.0% now that place.ts DROPs those pins; a nonzero
// value means the rule was bypassed or reordered.
const SHAPES: { name: string; note: string; test: (t: PlacementTrace) => boolean }[] = [
  {
    name: "lone-mention",
    note: "winner mentioned once — containers only now; ANY pin here is a bug",
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

  // Read-only measurement: no watermark, no state, never touches the published pool.
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
        `   pins ${String(pinHits.length).padStart(5)}  ${pct(pinHits.length, pins.length)}`
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
        console.log(
          `    ${article.domain}  ->  ${trace.placement.location?.name}  [${trace.reason}]`
        );
        console.log(
          `    winner x${trace.winnerMentions}` +
            (level?.runnerUp
              ? `, runner-up ${level.runnerUp.name} x${level.runnerUp.mentions}`
              : "") +
            (trace.countryRatio !== null ? `, country ${trace.countryRatio.toFixed(1)}x city` : "")
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
