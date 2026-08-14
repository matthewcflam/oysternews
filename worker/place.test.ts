import { describe, expect, it } from "vitest";
import type { Article, GdeltLocation } from "../lib/types.ts";
import { explainPlacement, isDemonym, placeStory, regionIdFor } from "./place.ts";
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
    // Two mentions each, not one: at x1 the weak-city rule drops this before the
    // tie-break is reachable, and the tie-break still has to work above it.
    const placement = placeStory(
      article([
        ...repeat(2, 4, "Later", { offset: 900 }),
        ...repeat(2, 4, "Earlier", { offset: 10 }),
      ]),
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

/**
 * Added 2026-08-14, from the independent judging draw (§5.2 decision 4). This is
 * the first rule in the project that DROPs a placement it was capable of making,
 * so the tests are mostly about where it must NOT fire — a drop rule that creeps
 * outward loses volume silently, and nothing downstream would report it.
 */
describe("the weak-city DROP", () => {
  it("drops a city mentioned once", () => {
    expect(placeStory(article([loc(4, "Vatva"), loc(4, "Rajkot")]), refdata).kind).toBe("DROP");
  });

  it("pins the same city at two mentions", () => {
    // The threshold is "more than once" and nothing else. If this test and the
    // one above ever disagree about where the line sits, the constant was tuned.
    const placement = placeStory(article([...repeat(2, 4, "Vatva"), loc(4, "Rajkot")]), refdata);
    expect(placement.kind).toBe("PIN");
    expect(placement.location?.name).toBe("Vatva");
  });

  it("still containers a weak city that a region dominates", () => {
    // Fires after both margins, so a story with a real regional signal keeps it.
    // Reversing the order would rewrite placements the audit judged and liked.
    const placement = placeStory(
      article([loc(4, "Springfield"), ...repeat(2, 5, "Region")]),
      refdata,
    );
    expect(placement.kind).toBe("CONTAINER");
    expect(placement.location?.name).toBe("Region");
  });

  it("still containers a weak city that a country dominates", () => {
    const placement = placeStory(
      article([loc(4, "Seoul"), ...repeat(3, 1, "India")]),
      refdata,
    );
    expect(placement.kind).toBe("CONTAINER");
    expect(placement.location?.name).toBe("India");
  });

  it("does not touch containers, which the same shape does not harm", () => {
    // A country mentioned once scored 85.7% on the draw — better than containers
    // overall. `winnerMentions === 1` is a pin pathology, not a general one.
    expect(placeStory(article([loc(1, "Country")]), refdata).kind).toBe("CONTAINER");
    expect(placeStory(article([loc(5, "Region")]), refdata).kind).toBe("CONTAINER");
  });

  it("does not fall through to a country mentioned twice", () => {
    // The rejected alternative, and the reason it was rejected: on the draw this
    // shape produced Dublin -> United Kingdom x2 and Canberra -> Singapore x2.
    // Fall-through would move the error into the container number, not remove it.
    const trace = explainPlacement(
      article([loc(4, "Dublin, Dublin, Ireland"), ...repeat(2, 1, "United Kingdom")]),
      refdata,
    );
    expect(trace.placement.kind).toBe("DROP");
    expect(trace.reason).toBe("weak-city");
    expect(trace.country?.mentions).toBe(2);
  });

  it("separates a weak-city drop from the two upstream drops", () => {
    // The three DROPs cost different things: only weak-city discards a placement
    // the rule could have made, so only its share measures what the rule costs.
    const reason = (a: Article) => explainPlacement(a, refdata).reason;
    expect(reason(article([]))).toBe("no-locations");
    expect(reason(article([loc(1, "British")]))).toBe("all-demonyms");
    expect(reason(article([loc(4, "Vatva"), loc(4, "Rajkot")]))).toBe("weak-city");
  });
});

describe("the why trace", () => {
  /**
   * The trace's whole value is that it cannot disagree with the rule, so the
   * first test is the one that would catch a future "optimisation" that
   * reintroduces a second implementation.
   */
  it("agrees with placeStory on every case above, by construction", () => {
    const cases = [
      article([...repeat(3, 4, "Perth"), loc(1, "Australia")]),
      article([loc(3, "Chicago, Illinois, United States"), ...repeat(4, 2, "Minnesota, United States")]),
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
    expect(reason(article([loc(4, "Springfield"), ...repeat(4, 5, "Region")]))).toBe("adm1-dominates");
    expect(reason(article([...repeat(4, 4, "London, United Kingdom"), ...repeat(14, 1, "United Kingdom")]))).toBe(
      "country-dominates",
    );
    expect(reason(article([loc(5, "Region"), loc(1, "Country")]))).toBe("adm1-only");
    expect(reason(article([loc(1, "Country")]))).toBe("country-only");
  });

  it("distinguishes an empty extraction from a filter that ate everything", () => {
    // Both are DROPs and the old return value could not tell them apart. One is
    // GDELT finding nothing; the other is the demonym filter working, and
    // "the filter is too aggressive" would hide inside the merged bucket.
    expect(explainPlacement(article([]), refdata).reason).toBe("no-locations");
    const allDemonyms = explainPlacement(article([loc(1, "British"), loc(1, "Danish")]), refdata);
    expect(allDemonyms.reason).toBe("all-demonyms");
    expect(allDemonyms.demonymsDropped).toBe(2);
  });

  /**
   * The audit's Windsor Machines pin: a corporate earnings story whose every
   * location was mentioned exactly once, placed confidently at Vatva because it
   * happened to appear first. `winnerMentions === 1` with `tieBroken` is the
   * mechanical signature of a story that has no place at all — the largest
   * addressable failure class, and invisible in `{kind, location}`.
   */
  it("drops the Windsor Machines pin instead of placing it at Vatva", () => {
    // Until 2026-08-14 this was a confident PIN at Vatva, and the trace's job was
    // only to say so. The judged draw made it a DROP: pins whose city was
    // mentioned once scored 36.4% against 77.8% for the rest.
    const trace = explainPlacement(
      article([
        loc(1, "Italy", { offset: 40 }),
        loc(4, "Chhatral, Jammu And Kashmir, India", { offset: 60 }),
        loc(4, "Rajkot, Gujarat, India", { offset: 80 }),
        loc(4, "Vatva, Gujarat, India", { offset: 20 }),
      ]),
      refdata,
    );
    expect(trace.placement.kind).toBe("DROP");
    expect(trace.reason).toBe("weak-city");

    // The evidence that caused the drop survives on the trace: winnerMentions is
    // 0 because nothing was chosen, but the contest it lost is still readable.
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

  /**
   * The BTCC case: the article previews Knockhill while recapping Thruxton, so
   * the subject is mentioned half as often as the background. The rule cannot
   * see aboutness, but the trace shows the contest was close — which is what
   * separates this class from a decisive win.
   */
  it("reports the runner-up it beat", () => {
    const trace = explainPlacement(
      article([...repeat(4, 4, "Thruxton"), ...repeat(2, 4, "Knockhill")]),
      refdata,
    );
    expect(trace.city?.name).toBe("Thruxton");
    expect(trace.city?.runnerUp).toEqual({ name: "Knockhill", mentions: 2 });
  });

  /**
   * The Davis Cup case: an Indian outlet mentions India 12 times against
   * Seoul's 2, so country-dominates fires on a match played in Seoul. The ratio
   * says how far past the margin it went, which is what distinguishes a genuine
   * national story from source-country bias.
   */
  it("reports how far each margin was cleared or missed", () => {
    const fired = explainPlacement(
      article([...repeat(2, 4, "Seoul"), ...repeat(12, 1, "India")]),
      refdata,
    );
    expect(fired.reason).toBe("country-dominates");
    expect(fired.countryRatio).toBe(6);

    // The near miss the margin exists to allow through as a pin.
    const missed = explainPlacement(
      article([...repeat(3, 4, "Perth"), ...repeat(8, 1, "Australia")]),
      refdata,
    );
    expect(missed.reason).toBe("city-survives");
    expect(missed.countryRatio).toBeCloseTo(2.667, 3);
    expect(missed.adm1Ratio).toBeNull();
  });

  it("counts mentions after the demonym filter, not before", () => {
    const trace = explainPlacement(
      article([...repeat(2, 4, "London, United Kingdom"), ...repeat(5, 1, "British")]),
      refdata,
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
