import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PUBLISHED_ACCURACY } from "./accuracy.ts";
import { type Judgement, type ScoredRecord, scoreLevel, wilson } from "./audit-score.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

function readJsonl<T>(relative: string): T[] {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

describe("wilson", () => {
  it("stays inside [0, 100] where the normal approximation does not", () => {
    const [lo, hi] = wilson(21, 26);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThanOrEqual(100);
  });

  it("is degenerate rather than NaN on an empty sample", () => {
    expect(wilson(0, 0)).toEqual([0, 0]);
  });

  it("does not reach certainty from a clean sweep", () => {
    const [lo, hi] = wilson(10, 10);
    expect(hi).toBeLessThanOrEqual(100);
    expect(lo).toBeLessThan(100);
  });
});

describe("scoreLevel", () => {
  const drawn: ScoredRecord[] = [
    { id: "a", kind: "PIN" },
    { id: "b", kind: "PIN" },
    { id: "c", kind: "PIN" },
    { id: "d", kind: "CONTAINER" },
  ];

  it("excludes UNJUDGEABLE from the denominator and reports it", () => {
    const judged: Judgement[] = [
      { id: "a", verdict: "CORRECT", reason: "" },
      { id: "b", verdict: "WRONG", reason: "near-miss" },
      { id: "c", verdict: "UNJUDGEABLE", reason: "" },
    ];
    const result = scoreLevel("PIN", drawn, judged);
    expect(result.judgeable).toBe(2);
    expect(result.unjudgeable).toBe(1);
    expect(result.point).toBe(50);
  });

  it("scores the levels separately, because they fail differently (§5.1)", () => {
    const judged: Judgement[] = [
      { id: "a", verdict: "WRONG", reason: "no-place" },
      { id: "d", verdict: "CORRECT", reason: "" },
    ];
    expect(scoreLevel("PIN", drawn, judged).point).toBe(0);
    expect(scoreLevel("CONTAINER", drawn, judged).point).toBe(100);
  });

  it("treats an unrecognised verdict as unjudgeable rather than dropping it", () => {
    const judged: Judgement[] = [{ id: "a", verdict: "corrct", reason: "" }];
    const result = scoreLevel("PIN", drawn, judged);
    expect(result.judgeable).toBe(0);
    expect(result.unjudgeable).toBe(1);
  });
});

describe("the published accuracy still matches the judge's verdicts", () => {
  const drawn = readJsonl<ScoredRecord>(PUBLISHED_ACCURACY.sampleFile);
  const judged = readJsonl<Judgement>(PUBLISHED_ACCURACY.judgedFile).filter((j) => j.verdict);

  it("scores the same pin accuracy the About page publishes", () => {
    const result = scoreLevel("PIN", drawn, judged);
    expect(result.judgeable).toBe(PUBLISHED_ACCURACY.pin.n);
    expect(result.point).toBeCloseTo(PUBLISHED_ACCURACY.pin.point, 1);
    expect(result.interval[0]).toBeCloseTo(PUBLISHED_ACCURACY.pin.interval[0], 1);
    expect(result.interval[1]).toBeCloseTo(PUBLISHED_ACCURACY.pin.interval[1], 1);
  });

  it("scores the same container accuracy the About page publishes", () => {
    const result = scoreLevel("CONTAINER", drawn, judged);
    expect(result.judgeable).toBe(PUBLISHED_ACCURACY.container.n);
    expect(result.point).toBeCloseTo(PUBLISHED_ACCURACY.container.point, 1);
    expect(result.interval[0]).toBeCloseTo(PUBLISHED_ACCURACY.container.interval[0], 1);
    expect(result.interval[1]).toBeCloseTo(PUBLISHED_ACCURACY.container.interval[1], 1);
  });

  it("keeps the pin lower bound above §5.1's 50% kill line", () => {
    expect(PUBLISHED_ACCURACY.pin.interval[0]).toBeGreaterThan(50);
  });

  it("keeps the container lower bound above §5.1's 60% kill-containers line", () => {
    expect(PUBLISHED_ACCURACY.container.interval[0]).toBeGreaterThan(60);
  });

  it("still lands in the band that obliges the About page to disclose", () => {
    expect(PUBLISHED_ACCURACY.pin.point).toBeGreaterThanOrEqual(50);
    expect(PUBLISHED_ACCURACY.pin.point).toBeLessThan(70);
  });
});
