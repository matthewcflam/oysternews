// accuracy.test.ts re-scores the committed judge files against these values. After a new
// judged draw, update the numbers and judgedFile/sampleFile together, in one commit.
export type LevelAccuracy = {
  point: number;
  interval: [number, number];
  n: number;
};

export const PUBLISHED_ACCURACY: {
  pin: LevelAccuracy;
  container: LevelAccuracy;
  drawId: string;
  judgedOn: string;
  judgedFile: string;
  sampleFile: string;
  measuredAgainst: string;
} = {
  pin: { point: 68.1, interval: [53.8, 79.6], n: 47 },
  container: { point: 83.3, interval: [68.1, 92.1], n: 36 },

  drawId: "c29ce-90",
  judgedOn: "2026-08-14",
  judgedFile: "docs/research/placement-audit/judged-c29ce-90.jsonl",
  sampleFile: "docs/research/placement-audit/audit_sample_judge_c29ce.jsonl",

  measuredAgainst: "the placement rule before the weak-city DROP was adopted",
};
