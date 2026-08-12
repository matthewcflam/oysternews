import { describe, expect, it } from "vitest";
import type { Article, GdeltLocation } from "../lib/types.ts";
import { isDemonym, placeStory, regionIdFor } from "./place.ts";
import type { RefData } from "./refdata.ts";

/**
 * Placement is the highest-risk pure module in the project: it is the rule that
 * failed a pre-registered abort criterion in its first form (§5.2), and the
 * replacement's two margins are fitted constants. These tests encode the
 * specific real-world cases from the audit, so a future "simplification" back to
 * specificity-first fails here rather than in the map.
 */

const refdata = {
  countries: new Map(),
  nonCountries: new Set<string>(),
  demonyms: new Set(["british", "americans", "texans", "danish"]),
  tier1: new Set<string>(),
  blocklist: new Set<string>(),
  sourceCountries: { domains: new Map(), cctldExceptions: new Map() },
} as unknown as RefData;

let nextOffset = 0;

function loc(type: number, name: string, extra: Partial<GdeltLocation> = {}): GdeltLocation {
  return {
    type,
    name,
    countryCode: extra.countryCode ?? "US",
    adm1Code: extra.adm1Code ?? "",
    lat: extra.lat ?? 1,
    lon: extra.lon ?? 2,
    featureId: extra.featureId ?? name,
    offset: extra.offset ?? nextOffset++,
  };
}

function article(locations: GdeltLocation[]): Article {
  return { date: "20260812050000", domain: "example.com", url: "u", title: "t", themes: [], locations };
}

/** `n` mentions of the same place, as GDELT emits them: one entry per mention. */
function repeat(count: number, type: number, name: string, extra: Partial<GdeltLocation> = {}) {
  return Array.from({ length: count }, () => loc(type, name, extra));
}

describe("the demonym trap", () => {
  it("matches a bare country demonym", () => {
    expect(isDemonym("Americans", refdata)).toBe(true);
  });

  it("matches a US state demonym, which carries a country suffix", () => {
    // The whole-string match that everyone writes first returns false here, and
    // silently loses every US state. FINDINGS §10.
    expect(isDemonym("Texans, United States", refdata)).toBe(true);
  });

  it("does not match a real place that merely starts similarly", () => {
    expect(isDemonym("Texas, United States", refdata)).toBe(false);
  });

  it("drops a record whose only locations are demonyms", () => {
    expect(placeStory(article([loc(1, "British"), loc(1, "Danish")]), refdata).kind).toBe("DROP");
  });
});

describe("Rule H — specificity unless dominated", () => {
  it("pins an undominated city", () => {
    const placement = placeStory(
      article([...repeat(3, 4, "Perth"), loc(1, "Australia")]),
      refdata,
    );
    expect(placement.kind).toBe("PIN");
    expect(placement.location?.name).toBe("Perth");
  });

  it("sends Chicago x1 vs Minnesota x4 to the state container", () => {
    // The audit case that killed the original rule: a Minnesota Twins story
    // pinned to Chicago because Chicago was the more *specific* mention.
    const placement = placeStory(
      article([loc(3, "Chicago, Illinois, United States"), ...repeat(4, 2, "Minnesota, United States")]),
      refdata,
    );
    expect(placement.kind).toBe("CONTAINER");
    expect(placement.location?.name).toBe("Minnesota, United States");
  });

  it("sends London x4 vs United Kingdom x14 to the country container", () => {
    const placement = placeStory(
      article([...repeat(4, 4, "London, United Kingdom"), ...repeat(14, 1, "United Kingdom")]),
      refdata,
    );
    expect(placement.kind).toBe("CONTAINER");
    expect(placement.location?.name).toBe("United Kingdom");
  });

  it("keeps the city when the country leads but does not reach 3x", () => {
    // The overcorrection guard: a domestic article names its own country
    // constantly, and pure dominance would send ~75% of stories to countries.
    const placement = placeStory(
      article([...repeat(3, 4, "Perth"), ...repeat(8, 1, "Australia")]),
      refdata,
    );
    expect(placement.kind).toBe("PIN");
    expect(placement.location?.name).toBe("Perth");
  });

  it("applies the margins at exactly the threshold, not past it", () => {
    const atThreshold = placeStory(
      article([...repeat(2, 4, "Perth"), ...repeat(6, 1, "Australia")]),
      refdata,
    );
    expect(atThreshold.kind).toBe("CONTAINER");

    const justUnder = placeStory(
      article([...repeat(2, 4, "Perth"), ...repeat(5, 1, "Australia")]),
      refdata,
    );
    expect(justUnder.kind).toBe("PIN");
  });

  it("prefers adm1 over country when both dominate", () => {
    const placement = placeStory(
      article([
        loc(4, "Springfield"),
        ...repeat(4, 5, "Region"),
        ...repeat(9, 1, "Country"),
      ]),
      refdata,
    );
    expect(placement.kind).toBe("CONTAINER");
    expect(placement.location?.name).toBe("Region");
  });

  it("breaks a tie on the earliest mention in the article", () => {
    const placement = placeStory(
      article([loc(4, "Later", { offset: 900 }), loc(4, "Earlier", { offset: 10 })]),
      refdata,
    );
    expect(placement.location?.name).toBe("Earlier");
  });

  it("falls back to adm1, then country, when there is no city", () => {
    expect(placeStory(article([loc(5, "Region"), loc(1, "Country")]), refdata).location?.name).toBe(
      "Region",
    );
    expect(placeStory(article([loc(1, "Country")]), refdata).kind).toBe("CONTAINER");
    expect(placeStory(article([]), refdata).kind).toBe("DROP");
  });

  it("ignores demonyms when counting mentions", () => {
    // "British" x5 must not dominate London x2 — it is an adjective, not a place.
    const placement = placeStory(
      article([...repeat(2, 4, "London, United Kingdom"), ...repeat(5, 1, "British")]),
      refdata,
    );
    expect(placement.kind).toBe("PIN");
    expect(placement.location?.name).toBe("London, United Kingdom");
  });
});

describe("region ids", () => {
  it("uses the adm1 code for regions and the FIPS code for countries", () => {
    expect(regionIdFor(loc(5, "Oregon", { adm1Code: "USOR", countryCode: "US" }))).toBe("USOR");
    expect(regionIdFor(loc(1, "Russia", { countryCode: "RS" }))).toBe("RS");
  });

  it("falls back to the country code when an adm1 code is missing", () => {
    expect(regionIdFor(loc(5, "Somewhere", { adm1Code: "", countryCode: "AU" }))).toBe("AU");
  });
});
