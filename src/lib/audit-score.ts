export type Judgement = { id: string; verdict: string; reason: string };

export type ScoredRecord = { id: string; kind: "PIN" | "CONTAINER" };

export type LevelResult = {
  judgeable: number;
  correct: number;
  point: number;
  interval: [number, number];
  unjudgeable: number;
};

// Wilson, not the normal approximation: at small n the latter gives bounds above 100%.
export function wilson(correct: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = correct / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [100 * (centre - half), 100 * (centre + half)];
}

// An unrecognized verdict counts as UNJUDGEABLE, never discarded: a typo in a sheet must
// not shrink the denominator toward a better number.
export function scoreLevel(
  kind: "PIN" | "CONTAINER",
  drawn: ScoredRecord[],
  judged: Judgement[]
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
