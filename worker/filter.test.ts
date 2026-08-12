import { describe, expect, it } from "vitest";
import type { Article } from "@/lib/types";
import { filterArticles, hasUsableLocation, isBlocked } from "./filter";
import type { RefData } from "./refdata";

const refdata = {
  countries: new Map(),
  nonCountries: new Set<string>(),
  demonyms: new Set(["british"]),
  tier1: new Set(["bbc.co.uk"]),
  blocklist: new Set(["iheart.com", "themarketsdaily.com"]),
  sourceCountries: { domains: new Map(), cctldExceptions: new Map() },
} as unknown as RefData;

function article(domain: string, types: number[]): Article {
  return {
    date: "20260812050000",
    domain,
    url: "u",
    title: "t",
    themes: [],
    locations: types.map((type, index) => ({
      type,
      name: `place${index}`,
      countryCode: "US",
      adm1Code: "",
      lat: 1,
      lon: 2,
      featureId: `f${index}`,
      offset: index,
    })),
  };
}

describe("the blocklist", () => {
  it("drops the listed domains", () => {
    expect(isBlocked("iheart.com", refdata)).toBe(true);
    expect(isBlocked("IHEART.COM", refdata)).toBe(true);
  });

  it("leaves high-volume legitimate outlets alone", () => {
    // FINDINGS §13: indiatimes/thehindu/hindustantimes top the same histogram as
    // the spam domains. Blocking by volume would delete India from the map.
    expect(isBlocked("indiatimes.com", refdata)).toBe(false);
    expect(isBlocked("thehindu.com", refdata)).toBe(false);
  });

  it("runs before anything tier-1 can see — a blocked tier-1 domain never survives", () => {
    // §5's ordering guarantee. No domain is on both lists today (refdata asserts
    // that), so this defends the ordering against a future edit.
    const blockedTier1 = { ...refdata, blocklist: new Set(["bbc.co.uk"]) } as unknown as RefData;
    const result = filterArticles([article("bbc.co.uk", [4])], blockedTier1);
    expect(result.kept).toEqual([]);
    expect(result.blocked).toBe(1);
  });
});

describe("usable locations", () => {
  it("accepts city, adm1 and country types", () => {
    for (const type of [1, 2, 3, 4, 5]) {
      expect(hasUsableLocation(article("example.com", [type]))).toBe(true);
    }
  });

  it("rejects a record with no locations at all", () => {
    expect(hasUsableLocation(article("example.com", []))).toBe(false);
  });

  it("rejects location types outside 1-5", () => {
    expect(hasUsableLocation(article("example.com", [0, 9]))).toBe(false);
  });

  it("does NOT drop demonym-only records — that is placement's call", () => {
    // A demonym parses as a type-1 country location, so it passes here and is
    // dropped by placeStory(). Two stages, on purpose: 11.9% of all location
    // mentions are demonyms and the counting rule needs them gone before the
    // margins are applied, not before the record is considered.
    const demonymOnly = article("example.com", [1]);
    demonymOnly.locations[0].name = "British";
    expect(hasUsableLocation(demonymOnly)).toBe(true);
  });
});

describe("filterArticles", () => {
  it("separates the two drop reasons", () => {
    const result = filterArticles(
      [article("iheart.com", [4]), article("example.com", []), article("example.com", [4])],
      refdata,
    );
    expect(result.blocked).toBe(1);
    expect(result.noLocation).toBe(1);
    expect(result.kept.length).toBe(1);
  });
});
