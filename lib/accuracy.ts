/**
 * The published accuracy figures — one source of truth for a number the project
 * is obliged to state correctly.
 *
 * §5.2 decision 3: the measured pin accuracy landed in §5.1's 50-70% band, and
 * the pre-registered consequence is that the About page states **the measured
 * accuracy and its interval**. So these are not display constants that can be
 * rounded for fit. They are the claim the project ships under.
 *
 * **Why this file exists rather than the numbers living in the JSX.** They were
 * hand-copied from HANDOFF.md, which means a re-judged draw updates the map and
 * the plan while the page keeps quoting a figure nobody measured any more —
 * silent, and exactly the failure shape this project keeps finding. Here they
 * are one constant, and `accuracy.test.ts` **re-scores the committed judge files
 * and fails if these values drift from what the verdicts actually say**. The
 * page cannot lie without a test going red.
 *
 * Browser-safe on purpose: plain data, no imports. `app/about/page.tsx` renders
 * it; the test is what ties it to the evidence.
 *
 * **To update after a fresh draw is judged:** change these numbers and
 * `judgedFile`/`sampleFile` together, in one commit. The test will tell you if
 * you got them wrong. Do not update the prose around them without re-reading
 * `measuredAgainst` — that sentence is the one keeping the figure honest.
 */
export type LevelAccuracy = {
  /** Percentage of judgeable placements the judge called CORRECT. */
  point: number;
  /** 95% Wilson interval, [lower, upper]. §5.1 decides on the lower bound. */
  interval: [number, number];
  /** Judgeable records — UNJUDGEABLE verdicts are excluded from the denominator. */
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
  judgedFile: "spikes/gdelt/judged-c29ce-90.jsonl",
  sampleFile: "spikes/gdelt/audit_sample_judge_c29ce.jsonl",

  /**
   * Which pipeline these describe. This draw is what funded the weak-city DROP,
   * so the rule changed *after* the scoring — the figures cover a map that still
   * published the least accurate group of pins. Dated, not wrong, and the About
   * page says so in those words.
   */
  measuredAgainst: "the placement rule before the weak-city DROP was adopted",
};
