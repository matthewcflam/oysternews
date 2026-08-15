import { describe, expect, it } from "vitest";
import type { PlacedArticle, StoryGroup } from "../lib/types.ts";
import { compareGroups, parseGkgDate, rankGroups, salienceOf, summarise } from "./rank.ts";

/**
 * HANDOFF.md §7 names five tier-1 paths as required coverage. They are numbered
 * in the test titles below so the mapping stays checkable.
 */

const HOUR = 3600 * 1000;
const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);

/** GKG date `hoursAgo` before NOW. */
function gkg(hoursAgo: number): string {
  const d = new Date(NOW - hoursAgo * HOUR);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

function article(patch: Partial<PlacedArticle> = {}): PlacedArticle {
  return {
    date: gkg(1),
    domain: "example.com",
    url: `https://example.com/${Math.random()}`,
    title: "t",
    image: "",
    themes: [],
    lat: 0,
    lon: 0,
    kind: "PIN",
    countryCode: "US",
    regionId: "",
    adm1: "",
    placeName: "p",
    sourceCountry: "US",
    tier1: false,
    ...patch,
  };
}

function group(patch: Partial<StoryGroup> = {}): StoryGroup {
  return {
    id: "id",
    title: "t",
    image: "",
    url: "u",
    domain: "d",
    lat: 0,
    lon: 0,
    kind: "PIN",
    countryCode: "US",
    regionId: "",
    adm1: "",
    placeName: "p",
    distinctDomains: 1,
    distinctSourceCountries: 1,
    salience: salienceOf(1, 1),
    tier1Fresh: false,
    newestTier1: "",
    newestArticle: gkg(1),
    minzoom: 0,
    ...patch,
  };
}

describe("salience", () => {
  it("weights domains 2:1 over source countries", () => {
    expect(salienceOf(10, 0)).toBeCloseTo(Math.log1p(10));
    expect(salienceOf(0, 10)).toBeCloseTo(0.5 * Math.log1p(10));
  });

  it("is heavy-tail flattening, so 100 domains is not 10x 10 domains", () => {
    expect(salienceOf(100, 0) / salienceOf(10, 0)).toBeLessThan(2);
  });

  it("excludes unresolved publisher countries rather than bucketing them", () => {
    // Bucketing "" as a country would give every unresolved publisher a shared
    // nationality and inflate the border-crossing term for purely local stories.
    const stats = summarise(
      [
        article({ domain: "a.com", sourceCountry: "" }),
        article({ domain: "b.com", sourceCountry: "" }),
        article({ domain: "c.co.uk", sourceCountry: "GB" }),
      ],
      NOW,
    );
    expect(stats.distinctSourceCountries).toBe(1);
    expect(stats.distinctDomains).toBe(3);
  });
});

describe("tier-1 freshness (§6 decision 10 — newest, not oldest)", () => {
  it("is fresh inside 48 hours", () => {
    const stats = summarise([article({ tier1: true, date: gkg(47) })], NOW);
    expect(stats.tier1Fresh).toBe(true);
  });

  it("path 3: at 49 hours with no newer tier-1 article it drops out", () => {
    const stats = summarise([article({ tier1: true, date: gkg(49) })], NOW);
    expect(stats.tier1Fresh).toBe(false);
  });

  it("renews from the NEWEST tier-1 article — a follow-up piece extends the window", () => {
    // Against the OLDEST, a story a tier-1 outlet is still actively covering
    // would expire mid-coverage.
    const stats = summarise(
      [
        article({ tier1: true, date: gkg(70), domain: "old.com" }),
        article({ tier1: true, date: gkg(2), domain: "new.com" }),
      ],
      NOW,
    );
    expect(stats.tier1Fresh).toBe(true);
    expect(stats.newestTier1).toBe(gkg(2));
  });

  it("is never fresh without a tier-1 member", () => {
    expect(summarise([article({ date: gkg(1) })], NOW).tier1Fresh).toBe(false);
  });
});

describe("the §2.5 comparator", () => {
  it("path 1: a LOW-salience tier-1 story beats a HIGH-salience ordinary one", () => {
    const tier1 = group({ id: "t", tier1Fresh: true, salience: salienceOf(2, 0) });
    const ordinary = group({ id: "o", tier1Fresh: false, salience: salienceOf(50, 12) });
    expect(rankGroups([ordinary, tier1])[0].id).toBe("t");
  });

  it("orders by salience inside each class, untouched", () => {
    const big = group({ id: "big", tier1Fresh: true, salience: 9 });
    const small = group({ id: "small", tier1Fresh: true, salience: 1 });
    expect(rankGroups([small, big]).map((g) => g.id)).toEqual(["big", "small"]);
  });

  it("breaks a tier-1 tie on the newest tier-1 article", () => {
    const older = group({ id: "older", tier1Fresh: true, salience: 5, newestTier1: gkg(30) });
    const newer = group({ id: "newer", tier1Fresh: true, salience: 5, newestTier1: gkg(2) });
    expect(rankGroups([older, newer])[0].id).toBe("newer");
  });

  it("path 4: with no tier-1 anywhere, ranking is exactly salience order", () => {
    // The fallback path IS the original path — not a special case.
    const groups = [
      group({ id: "a", salience: 3 }),
      group({ id: "b", salience: 7 }),
      group({ id: "c", salience: 5 }),
    ];
    expect(rankGroups(groups).map((g) => g.id)).toEqual(["b", "c", "a"]);
  });

  it("is a total order, so selection does not flicker between runs", () => {
    const a = group({ id: "aaa" });
    const b = group({ id: "bbb" });
    expect(compareGroups(a, b)).toBeLessThan(0);
    expect(compareGroups(b, a)).toBeGreaterThan(0);
    expect(compareGroups(a, a)).toBe(0);
  });
});

describe("parseGkgDate", () => {
  it("reads GKG's YYYYMMDDHHMMSS as UTC", () => {
    expect(parseGkgDate("20260812050000")).toBe(Date.UTC(2026, 7, 12, 5, 0, 0));
  });

  it("returns NaN for a malformed date rather than a plausible wrong one", () => {
    expect(Number.isNaN(parseGkgDate("2026"))).toBe(true);
  });
});
