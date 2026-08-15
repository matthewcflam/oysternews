import { describe, expect, it } from "vitest";
import { TOP_COUNT, sameKeys, topKeys } from "./top";

/** A rendered feature, with only the properties the ranking may look at. */
const feature = (url: string, salience: number, date = "2026-08-14", extra = {}) => ({
  properties: { url, salience, date, ...extra },
});

describe("topKeys", () => {
  it("takes the five most salient, best first", () => {
    const features = [
      feature("a", 0.7),
      feature("b", 4.3),
      feature("c", 2.3),
      feature("d", 1.1),
      feature("e", 0.7),
      feature("f", 3.0),
    ];
    expect(topKeys(features)).toEqual(["b", "f", "c", "d", "a"]);
    expect(topKeys(features)).toHaveLength(TOP_COUNT);
  });

  it("deduplicates by URL, so world copies cannot fill the list", () => {
    // renderWorldCopies is on (§3.1), so at z1 the same story is rendered once
    // per visible copy of the planet — and below z4 it can also be in both the
    // stories layer and the country floor. Ranking the raw query result would
    // spend all five slots on one story.
    const features = [
      feature("a", 4.0),
      feature("a", 4.0),
      feature("a", 4.0),
      feature("b", 1.0),
    ];
    expect(topKeys(features)).toEqual(["a", "b"]);
  });

  it("breaks salience ties by date, then by key — never at random", () => {
    // Half of all stories sit at exactly log1p(1) salience (§2.5), so ties are
    // the common case. An unstable order would make the highlight flicker as
    // the map is panned by a pixel.
    const features = [
      feature("b", 0.6931, "2026-08-10"),
      feature("a", 0.6931, "2026-08-14"),
      feature("c", 0.6931, "2026-08-14"),
    ];
    expect(topKeys(features)).toEqual(["a", "c", "b"]);
  });

  it("never reads tier1 — §2.3 keeps the preference invisible", () => {
    // The one rule this ranking could most easily break: a top-5 highlight IS a
    // badge, and tier-1 is not allowed to earn one. Same salience, same date;
    // the tier-1 story must not be promoted above the other.
    const features = [
      feature("plain", 1.0, "2026-08-14", { tier1: 0 }),
      feature("tier1", 1.0, "2026-08-14", { tier1: 1 }),
    ];
    expect(topKeys(features, 1)).toEqual(["plain"]);
  });

  it("drops a feature with no URL rather than giving it a slot", () => {
    // No URL means no feature-state key, so it could never be marked. Ranking
    // it would silently shrink the highlight to four.
    expect(topKeys([{ properties: { salience: 9 } }, feature("a", 0.1)])).toEqual(["a"]);
    expect(topKeys([{ properties: null }, { }])).toEqual([]);
  });

  it("survives a feature whose properties are the wrong shape", () => {
    // Tiles are published by a worker that has changed its property list before.
    // A malformed salience must sort last, not throw and blank the highlight.
    expect(topKeys([feature("a", 1), { properties: { url: "b", salience: "x" } }])).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("sameKeys", () => {
  it("is the guard that stops idle -> setFeatureState -> idle looping", () => {
    expect(sameKeys(["a", "b"], ["a", "b"])).toBe(true);
    // Order matters: the list is ranked, and a reorder is a real change.
    expect(sameKeys(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameKeys(["a"], ["a", "b"])).toBe(false);
    expect(sameKeys([], [])).toBe(true);
  });
});
