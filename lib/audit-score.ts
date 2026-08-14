/**
 * The scoring arithmetic behind §5.1, in one place so it has one definition.
 *
 * It was inline in `scripts/score-audit.ts`, which runs `main()` on import and
 * therefore cannot be imported by anything. That was fine while the only reader
 * was the script — but `lib/accuracy.test.ts` needs to re-score the committed
 * judge files to prove the About page still matches them, and a second copy of
 * Wilson would let the page agree with a bug instead of with the verdicts.
 *
 * Pure functions, no I/O: callers read the files.
 */

/** A judge's verdict on one drawn record. */
export type Judgement = { id: string; verdict: string; reason: string };

/** The half of a drawn record this module needs. Traces are the caller's business. */
export type ScoredRecord = { id: string; kind: "PIN" | "CONTAINER" };

export type LevelResult = {
  /** CORRECT + WRONG. UNJUDGEABLE is excluded from the denominator (§5.1). */
  judgeable: number;
  correct: number;
  /** Percent, not a fraction. */
  point: number;
  /** 95% Wilson interval as percentages, [lower, upper]. */
  interval: [number, number];
  /** Reported alongside rather than folded in, per §5.1. */
  unjudgeable: number;
};

/**
 * 95% Wilson score interval.
 *
 * Not the textbook normal approximation, which at n=26 and p=0.81 produces an
 * upper bound above 100% and is simply wrong near the edges. Wilson shrinks
 * toward 0.5 and stays inside [0,1], which is why §5.1 specified it.
 */
export function wilson(correct: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = correct / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [100 * (centre - half), 100 * (centre + half)];
}

/**
 * Score one level (PIN or CONTAINER) from verdicts joined to drawn records.
 *
 * Records the judge never returned a verdict for are simply absent; records with
 * a verdict this function does not recognise count as UNJUDGEABLE rather than
 * being silently discarded, because a typo in a sheet must not quietly shrink
 * the denominator in the direction of a better number.
 */
export function scoreLevel(
  kind: "PIN" | "CONTAINER",
  drawn: ScoredRecord[],
  judged: Judgement[],
): LevelResult {
  const byId = new Map(drawn.map((r) => [r.id, r]));
  const rows = judged.filter((j) => byId.get(j.id)?.kind === kind);
  const judgeable = rows.filter((r) => r.verdict === "CORRECT" || r.verdict === "WRONG");
  const correct = judgeable.filter((r) => r.verdict === "CORRECT").length;

  return {
    judgeable: judgeable.length,
    correct,
    point: judgeable.length ? (100 * correct) / judgeable.length : 0,
    interval: wilson(correct, judgeable.length),
    unjudgeable: rows.length - judgeable.length,
  };
}
