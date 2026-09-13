import { describe, expect, it } from "vitest";
import type { Article, GdeltLocation } from "../src/lib/types.ts";
import { explainPlacement, isDemonym, placeStory, regionIdFor } from "./place.ts";
import type { RefData } from "./refdata.ts";

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
  return {
    date: "20260812050000",
    domain: "example.com",
    url: "u",
    title: "t",
    image: "",
    themes: [],
    locations,
  };
}

function repeat(count: number, type: number, name: string, extra: Partial<GdeltLocation> = {}) {
  return Array.from({ length: count }, () => loc(type, name, extra));
}

describe("the demonym trap", () => {
  it("matches a bare country demonym", () => {
    expect(isDemonym("Americans", refdata)).toBe(true);
  });

  it("matches a US state demonym, which carries a country suffix", () => {
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
    const placement = placeStory(article([...repeat(3, 4, "Perth"), loc(1, "Australia")]), refdata);
    expect(placement.kind).toBe("PIN");
    expect(placement.location?.name).toBe("Perth");
  });

  it("sends Chicago x1 vs Minnesota x4 to the state container", () => {
    const placement = placeStory(
      article([
        loc(3, "Chicago, Illinois, United States"),
        ...repeat(4, 2, "Minnesota, United States"),
      ]),
      refdata
    );
    expect(placement.kind).toBe("CONTAINER");
    expect(placement.location?.name).toBe("Minnesota, United States");
  });

  it("sends London x4 vs United Kingdom x14 to the country container", () => {
    const placement = placeStory(
      article([...repeat(4, 4, "London, United Kingdom"), ...repeat(14, 1, "United Kingdom")]),
      refdata
    );
    expect(placement.kind).toBe("CONTAINER");
    expect(placement.location?.name).toBe("United Kingdom");
  });

  it("keeps the city when the country leads but does not reach 3x", () => {
    const placement = placeStory(
      article([...repeat(3, 4, "Perth"), ...repeat(8, 1, "Australia")]),
      refdata
    );
    expect(placement.kind).toBe("PIN");
    expect(placement.location?.name).toBe("Perth");
  });

  it("applies the margins at exactly the threshold, not past it", () => {
    const atThreshold = placeStory(
      article([...repeat(2, 4, "Perth"), ...repeat(6, 1, "Australia")]),
      refdata
    );
    expect(atThreshold.kind).toBe("CONTAINER");

    const justUnder = placeStory(
      article([...repeat(2, 4, "Perth"), ...repeat(5, 1, "Australia")]),
      refdata
    );
    expect(justUnder.kind).toBe("PIN");
  });

  it("prefers adm1 over country when both dominate", () => {
    const placement = placeStory(
      article([loc(4, "Springfield"), ...repeat(4, 5, "Region"), ...repeat(9, 1, "Country")]),
      refdata
    );
    expect(placement.kind).toBe("CONTAINER");
    expect(placement.location?.name).toBe("Region");
  });

  it("breaks a tie on the earliest mention in the article", () => {
    const placement = placeStory(
      article([
        ...repeat(2, 4, "Later", { offset: 900 }),
        ...repeat(2, 4, "Earlier", { offset: 10 }),
      ]),
      refdata
    );
    expect(placement.location?.name).toBe("Earlier");
  });

  it("falls back to adm1, then country, when there is no city", () => {
    expect(placeStory(article([loc(5, "Region"), loc(1, "Country")]), refdata).location?.name).toBe(
      "Region"
    );
    expect(placeStory(article([loc(1, "Country")]), refdata).kind).toBe("CONTAINER");
    expect(placeStory(article([]), refdata).kind).toBe("DROP");
  });

  it("ignores demonyms when counting mentions", () => {
    const placement = placeStory(
      article([...repeat(2, 4, "London, United Kingdom"), ...repeat(5, 1, "British")]),
      refdata
    );
    expect(placement.kind).toBe("PIN");
    expect(placement.location?.name).toBe("London, United Kingdom");
  });
});

describe("the weak-city DROP", () => {
  it("drops a city mentioned once", () => {
    expect(placeStory(article([loc(4, "Vatva"), loc(4, "Rajkot")]), refdata).kind).toBe("DROP");
  });

  it("pins the same city at two mentions", () => {
    const placement = placeStory(article([...repeat(2, 4, "Vatva"), loc(4, "Rajkot")]), refdata);
    expect(placement.kind).toBe("PIN");
    expect(placement.location?.name).toBe("Vatva");
  });

  it("still containers a weak city that a region dominates", () => {
    const placement = placeStory(
      article([loc(4, "Springfield"), ...repeat(2, 5, "Region")]),
      refdata
    );
    expect(placement.kind).toBe("CONTAINER");
    expect(placement.location?.name).toBe("Region");
  });

  it("still containers a weak city that a country dominates", () => {
    const placement = placeStory(article([loc(4, "Seoul"), ...repeat(3, 1, "India")]), refdata);
    expect(placement.kind).toBe("CONTAINER");
    expect(placement.location?.name).toBe("India");
  });

  it("does not touch containers, which the same shape does not harm", () => {
    expect(placeStory(article([loc(1, "Country")]), refdata).kind).toBe("CONTAINER");
    expect(placeStory(article([loc(5, "Region")]), refdata).kind).toBe("CONTAINER");
  });

  it("does not fall through to a country mentioned twice", () => {
    const trace = explainPlacement(
      article([loc(4, "Dublin, Dublin, Ireland"), ...repeat(2, 1, "United Kingdom")]),
      refdata
    );
    expect(trace.placement.kind).toBe("DROP");
    expect(trace.reason).toBe("weak-city");
    expect(trace.country?.mentions).toBe(2);
  });

  it("separates a weak-city drop from the two upstream drops", () => {
    const reason = (a: Article) => explainPlacement(a, refdata).reason;
    expect(reason(article([]))).toBe("no-locations");
    expect(reason(article([loc(1, "British")]))).toBe("all-demonyms");
    expect(reason(article([loc(4, "Vatva"), loc(4, "Rajkot")]))).toBe("weak-city");
  });
});

describe("the why trace", () => {
  it("agrees with placeStory on every case above, by construction", () => {
    const cases = [
      article([...repeat(3, 4, "Perth"), loc(1, "Australia")]),
      article([
        loc(3, "Chicago, Illinois, United States"),
        ...repeat(4, 2, "Minnesota, United States"),
      ]),
      article([...repeat(4, 4, "London, United Kingdom"), ...repeat(14, 1, "United Kingdom")]),
      article([loc(4, "Springfield"), ...repeat(4, 5, "Region"), ...repeat(9, 1, "Country")]),
      article([loc(5, "Region"), loc(1, "Country")]),
      article([loc(1, "British"), loc(1, "Danish")]),
      article([loc(4, "Vatva"), loc(4, "Rajkot")]),
      article([]),
    ];
    for (const a of cases) {
      expect(explainPlacement(a, refdata).placement).toEqual(placeStory(a, refdata));
    }
  });

  it("names the branch that fired", () => {
    const reason = (a: Article) => explainPlacement(a, refdata).reason;
    expect(reason(article([...repeat(3, 4, "Perth"), loc(1, "Australia")]))).toBe("city-survives");
    expect(reason(article([loc(4, "Springfield"), ...repeat(4, 5, "Region")]))).toBe(
      "adm1-dominates"
    );
    expect(
      reason(
        article([...repeat(4, 4, "London, United Kingdom"), ...repeat(14, 1, "United Kingdom")])
      )
    ).toBe("country-dominates");
    expect(reason(article([loc(5, "Region"), loc(1, "Country")]))).toBe("adm1-only");
    expect(reason(article([loc(1, "Country")]))).toBe("country-only");
  });

  it("distinguishes an empty extraction from a filter that ate everything", () => {
    expect(explainPlacement(article([]), refdata).reason).toBe("no-locations");
    const allDemonyms = explainPlacement(article([loc(1, "British"), loc(1, "Danish")]), refdata);
    expect(allDemonyms.reason).toBe("all-demonyms");
    expect(allDemonyms.demonymsDropped).toBe(2);
  });

  it("drops the Windsor Machines pin instead of placing it at Vatva", () => {
    const trace = explainPlacement(
      article([
        loc(1, "Italy", { offset: 40 }),
        loc(4, "Chhatral, Jammu And Kashmir, India", { offset: 60 }),
        loc(4, "Rajkot, Gujarat, India", { offset: 80 }),
        loc(4, "Vatva, Gujarat, India", { offset: 20 }),
      ]),
      refdata
    );
    expect(trace.placement.kind).toBe("DROP");
    expect(trace.reason).toBe("weak-city");

    expect(trace.winnerMentions).toBe(0);
    expect(trace.city?.name).toBe("Vatva, Gujarat, India");
    expect(trace.city?.mentions).toBe(1);
    expect(trace.city?.tiedAtTop).toBe(3);
    expect(trace.distinctLocations).toBe(4);
  });

  it("does not flag a tie when the winner actually won", () => {
    const trace = explainPlacement(article([...repeat(3, 4, "Perth"), loc(4, "Darwin")]), refdata);
    expect(trace.winnerMentions).toBe(3);
    expect(trace.tieBroken).toBe(false);
    expect(trace.city?.runnerUp).toEqual({ name: "Darwin", mentions: 1 });
  });

  it("reports the runner-up it beat", () => {
    const trace = explainPlacement(
      article([...repeat(4, 4, "Thruxton"), ...repeat(2, 4, "Knockhill")]),
      refdata
    );
    expect(trace.city?.name).toBe("Thruxton");
    expect(trace.city?.runnerUp).toEqual({ name: "Knockhill", mentions: 2 });
  });

  it("reports how far each margin was cleared or missed", () => {
    const fired = explainPlacement(
      article([...repeat(2, 4, "Seoul"), ...repeat(12, 1, "India")]),
      refdata
    );
    expect(fired.reason).toBe("country-dominates");
    expect(fired.countryRatio).toBe(6);

    const missed = explainPlacement(
      article([...repeat(3, 4, "Perth"), ...repeat(8, 1, "Australia")]),
      refdata
    );
    expect(missed.reason).toBe("city-survives");
    expect(missed.countryRatio).toBeCloseTo(2.667, 3);
    expect(missed.adm1Ratio).toBeNull();
  });

  it("counts mentions after the demonym filter, not before", () => {
    const trace = explainPlacement(
      article([...repeat(2, 4, "London, United Kingdom"), ...repeat(5, 1, "British")]),
      refdata
    );
    expect(trace.reason).toBe("city-survives");
    expect(trace.country).toBeNull();
    expect(trace.totalMentions).toBe(2);
    expect(trace.demonymsDropped).toBe(5);
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
