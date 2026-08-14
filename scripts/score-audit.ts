/**
 * Score a returned judging sheet against §5.1's pre-registered thresholds.
 *
 *   judged-<draw>.jsonl + audit_sample_judge.jsonl -> accuracy, intervals, classes
 *
 * **§5.1's thresholds are hardcoded here and must not be edited to fit a
 * result.** They were fixed on 2026-08-08, before the first audit ran, precisely
 * so the outcome could not be rationalised afterwards — and the criterion has
 * already fired once and been honoured (§0 rule 8), which is most of what makes
 * this project's evidence worth anything. If a number below is wrong, the fix is
 * a conversation, not a diff.
 *
 * **The tie-break is the LOWER bound, not the point estimate**, and it is chosen
 * in the conservative direction. At these sample sizes it decides: the rule-H
 * pins scored 69.7% on 33 records, and one single record judged the other way
 * would have put the lower bound at 49.6% and killed the project.
 *
 * `band()` therefore reads the thresholds off the lower bound alone, which looks
 * stricter than §5.1's tables — they are stated on the point estimate — but is
 * exactly equivalent to them. The lower bound is never above the point estimate,
 * so the only case where the two land in different bands is the case §5.1 calls
 * a straddle, and there it already mandates the lower bound. Branching on
 * "does it straddle" would be the same answer with somewhere to hide a bug.
 *
 * The second half joins the verdicts back to `explainPlacement()`'s trace. That
 * is what the judge's extra click buys — the failure taxonomy at usable n rather
 * than the 15 records classified by hand. **Accuracy per shape is the number to
 * read**, not the shape's frequency: `place-audit.ts` already gives frequency,
 * and frequency is not accuracy (§5.2 decision 3, where mention count looked
 * strong on six records and went flat on 110).
 *
 * Run:  node scripts/score-audit.ts judged-<draw>.jsonl [--sample path]
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PlacementTrace } from "../worker/place.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SAMPLE = path.join(REPO_ROOT, "spikes", "gdelt", "audit_sample_judge.jsonl");

/** §5.1, fixed 2026-08-08. Do not edit to fit a result. */
const THRESHOLDS = {
  PIN: [
    { min: 70, verdict: "PROCEED as planned" },
    { min: 50, verdict: "PROCEED — the About page must state the measured accuracy and interval" },
    { min: 0, verdict: "KILL THE PROJECT — reconsider the data source before more pipeline code" },
  ],
  CONTAINER: [
    { min: 60, verdict: "Containers ship as specified (§2.2)" },
    { min: 0, verdict: "KILL CONTAINERS — drop country-and-ADM1-only records (FINDINGS §6 path 1)" },
  ],
};

type Judgement = { id: string; verdict: string; reason: string };
type SampleRecord = {
  id: string;
  title: string;
  domain: string;
  kind: "PIN" | "CONTAINER";
  placedAt: string;
  trace: PlacementTrace;
};

/**
 * 95% Wilson score interval.
 *
 * Not the textbook normal approximation, which at n=26 and p=0.81 produces an
 * upper bound above 100% and is simply wrong near the edges. Wilson shrinks
 * toward 0.5 and stays inside [0,1], which is why §5.1 specified it.
 */
function wilson(correct: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = correct / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [100 * (centre - half), 100 * (centre + half)];
}

function readJsonl<T>(body: string): T[] {
  return body
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

function band(kind: "PIN" | "CONTAINER", lower: number): string {
  return THRESHOLDS[kind].find((t) => lower >= t.min)!.verdict;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const judgedPath = args.find((a) => !a.startsWith("--"));
  if (!judgedPath) {
    console.error("usage: node scripts/score-audit.ts judged-<draw>.jsonl [--sample path]");
    process.exitCode = 1;
    return;
  }
  const samplePath = args.includes("--sample") ? args[args.indexOf("--sample") + 1] : DEFAULT_SAMPLE;

  const sample = new Map(
    readJsonl<SampleRecord>(await readFile(samplePath, "utf8")).map((r) => [r.id, r]),
  );
  const judged = readJsonl<Judgement>(await readFile(judgedPath, "utf8")).filter((j) => j.verdict);

  const rows = judged
    .map((j) => ({ ...j, record: sample.get(j.id) }))
    .filter((r): r is Judgement & { record: SampleRecord } => !!r.record);

  const unknown = judged.length - rows.length;
  if (unknown) console.log(`\n  WARN  ${unknown} verdicts had no matching sample record`);

  console.log(`\n  ${judged.length} judged of ${sample.size} drawn\n`);
  console.log("  level        judgeable  correct   accuracy   95% Wilson        §5.1 says");

  for (const kind of ["PIN", "CONTAINER"] as const) {
    const all = rows.filter((r) => r.record.kind === kind);
    const judgeable = all.filter((r) => r.verdict === "CORRECT" || r.verdict === "WRONG");
    const correct = judgeable.filter((r) => r.verdict === "CORRECT").length;
    if (!judgeable.length) continue;

    const [lo, hi] = wilson(correct, judgeable.length);
    const point = (100 * correct) / judgeable.length;
    console.log(
      `  ${kind.padEnd(12)} ${String(judgeable.length).padStart(6)}` +
        `${String(correct).padStart(9)}` +
        `${point.toFixed(1).padStart(10)}%   [${lo.toFixed(1)}, ${hi.toFixed(1)}]`.padEnd(24) +
        `  ${band(kind, lo)}`,
    );
    const unjudgeable = all.length - judgeable.length;
    if (unjudgeable) {
      console.log(
        `  ${"".padEnd(12)} ${unjudgeable} UNJUDGEABLE, excluded from the denominator and reported (§5.1)`,
      );
    }
  }

  console.log("\n  The decision follows the LOWER bound, not the point estimate (§5.1).");

  // --- why the wrong ones were wrong ---------------------------------------
  const wrong = rows.filter((r) => r.verdict === "WRONG");
  if (wrong.length) {
    console.log(`\n  why ${wrong.length} were wrong`);
    const byReason = new Map<string, number>();
    for (const r of wrong) byReason.set(r.reason || "(none)", (byReason.get(r.reason || "(none)") ?? 0) + 1);
    for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason.padEnd(16)} ${String(n).padStart(4)}  ${((100 * n) / wrong.length).toFixed(1)}%`);
    }
  }

  // --- do the trace shapes predict wrongness? ------------------------------
  const shapes: { name: string; test: (t: PlacementTrace) => boolean }[] = [
    { name: "lone-mention", test: (t) => t.winnerMentions === 1 },
    { name: "tie-broken", test: (t) => t.tieBroken },
    {
      name: "narrow-win",
      test: (t) => {
        const level = t.placement.kind === "PIN" ? t.city : (t.adm1 ?? t.country);
        return !!level?.runnerUp && level.mentions - level.runnerUp.mentions <= 1;
      },
    },
    { name: "runaway-country", test: (t) => t.reason === "country-dominates" && (t.countryRatio ?? 0) >= 6 },
  ];

  const judgeable = rows.filter((r) => r.verdict === "CORRECT" || r.verdict === "WRONG");
  console.log("\n  accuracy by trace shape — is the signal real?");
  console.log("  shape             with shape        without");
  for (const shape of shapes) {
    const fmt = (set: typeof judgeable) => {
      if (!set.length) return "     -      ";
      const c = set.filter((r) => r.verdict === "CORRECT").length;
      return `n=${String(set.length).padStart(3)} ${((100 * c) / set.length).toFixed(1).padStart(5)}%`;
    };
    const withShape = judgeable.filter((r) => shape.test(r.record.trace));
    const without = judgeable.filter((r) => !shape.test(r.record.trace));
    console.log(`  ${shape.name.padEnd(18)}${fmt(withShape)}   ${fmt(without)}`);
  }
  console.log(
    "\n  A gap here is a HYPOTHESIS, not a rule. The last signal that looked this\n" +
      "  good (p=0.053 on six pins) went flat on 110. Check n before acting.\n",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
