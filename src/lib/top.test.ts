import { describe, expect, it } from "vitest";
import { sameKeys, TOP_COUNT, topKeys } from "./top";

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
    const features = [feature("a", 4.0), feature("a", 4.0), feature("a", 4.0), feature("b", 1.0)];
    expect(topKeys(features)).toEqual(["a", "b"]);
  });

  it("breaks salience ties by date, then by key — never at random", () => {
    const features = [
      feature("b", 0.6931, "2026-08-10"),
      feature("a", 0.6931, "2026-08-14"),
      feature("c", 0.6931, "2026-08-14"),
    ];
    expect(topKeys(features)).toEqual(["a", "c", "b"]);
  });

  it("never reads tier1 — §2.3 keeps the preference invisible", () => {
    const features = [
      feature("plain", 1.0, "2026-08-14", { tier1: 0 }),
      feature("tier1", 1.0, "2026-08-14", { tier1: 1 }),
    ];
    expect(topKeys(features, 1)).toEqual(["plain"]);
  });

  it("drops a feature with no URL rather than giving it a slot", () => {
    expect(topKeys([{ properties: { salience: 9 } }, feature("a", 0.1)])).toEqual(["a"]);
    expect(topKeys([{ properties: null }, {}])).toEqual([]);
  });

  it("survives a feature whose properties are the wrong shape", () => {
    expect(topKeys([feature("a", 1), { properties: { url: "b", salience: "x" } }])).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("sameKeys", () => {
  it("is the guard that stops idle -> setFeatureState -> idle looping", () => {
    expect(sameKeys(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameKeys(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameKeys(["a"], ["a", "b"])).toBe(false);
    expect(sameKeys([], [])).toBe(true);
  });
});
