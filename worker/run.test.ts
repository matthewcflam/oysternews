import { beforeAll, describe, expect, it } from "vitest";
import type { Article, GdeltLocation } from "../lib/types.ts";
import { LOCATION_COUNTRY, LOCATION_WORLD_CITY } from "../lib/types.ts";
import { type RefData, loadRefData } from "./refdata.ts";
import { type RunSummary, formatSummary, stampOfDate, toPlaced } from "./run.ts";

// Against the REAL reference data, for the reason refdata.test.ts gives: the
// thing that breaks is a data file, and a mock cannot break the same way.
let data: RefData;
beforeAll(async () => {
  data = await loadRefData();
});

function location(patch: Partial<GdeltLocation> = {}): GdeltLocation {
  return {
    type: LOCATION_WORLD_CITY,
    name: "Kyiv, Kyyiv, Ukraine",
    countryCode: "UP",
    adm1Code: "UP12",
    lat: 50.4333,
    lon: 30.5167,
    featureId: "-1044367",
    offset: 100,
    ...patch,
  };
}

function article(patch: Partial<Article> = {}): Article {
  return {
    date: "20260812113000",
    domain: "example.com",
    url: "https://example.com/a",
    title: "A headline",
    image: "",
    themes: ["TAX_FNCACT"],
    locations: [location()],
    ...patch,
  };
}

describe("stampOfDate", () => {
  it("formats UTC, zero-padded, to the second", () => {
    expect(stampOfDate(new Date("2026-08-12T04:05:06.000Z"))).toBe("20260812040506");
  });

  it("uses UTC rather than the runner's local time", () => {
    // A runner in any timezone must produce the same stamp for the same instant,
    // because the stamp is compared against GDELT's UTC bundle names.
    expect(stampOfDate(new Date("2026-01-01T00:30:00.000Z"))).toBe("20260101003000");
  });
});

describe("toPlaced", () => {
  it("carries a PIN through with an empty regionId", () => {
    const placed = toPlaced(article(), { kind: "PIN", location: location() }, data);
    expect(placed).toMatchObject({
      kind: "PIN",
      regionId: "",
      countryCode: "UP",
      lat: 50.4333,
      placeName: "Kyiv, Kyyiv, Ukraine",
    });
  });

  it("carries a CONTAINER's regionId", () => {
    const country = location({ type: LOCATION_COUNTRY, name: "Ukraine", adm1Code: "" });
    const placed = toPlaced(article(), { kind: "CONTAINER", location: country, regionId: "UP" }, data);
    expect(placed).toMatchObject({ kind: "CONTAINER", regionId: "UP" });
  });

  it("returns null on a DROP", () => {
    expect(toPlaced(article(), { kind: "DROP", location: null }, data)).toBeNull();
  });

  it("marks a tier-1 domain, and does not mark a lookalike", () => {
    const tier1 = [...data.tier1][0];
    expect(toPlaced(article({ domain: tier1 }), { kind: "PIN", location: location() }, data)?.tier1).toBe(true);
    // §2.5 is a membership test, not a substring test. `notbbc.co.uk` is not the BBC.
    expect(toPlaced(article({ domain: `not${tier1}` }), { kind: "PIN", location: location() }, data)?.tier1).toBe(false);
  });

  it("infers the publisher country for the secondary salience term", () => {
    const placed = toPlaced(article({ domain: "bbc.co.uk" }), { kind: "PIN", location: location() }, data);
    expect(placed?.sourceCountry).toBe("GB");
  });

  it("keeps the article's own date, not the run's", () => {
    // Freshness (§2.3) and the 48-hour tier-1 clock both read this field; using
    // the run time would make every story permanently fresh.
    expect(toPlaced(article({ date: "20260810000000" }), { kind: "PIN", location: location() }, data)?.date).toBe(
      "20260810000000",
    );
  });
});

function summary(patch: Partial<RunSummary> = {}): RunSummary {
  return {
    watermark: "20260812110000",
    bundlesRequested: 4,
    bundlesFetched: 4,
    bundlesMissing: 0,
    rows: 4000,
    shortRows: 0,
    noTitle: 12,
    blocked: 40,
    noLocation: 900,
    dropped: 300,
    placed: 2760,
    unknownFips: new Map(),
    poolSize: 30000,
    shardsRead: 12,
    duplicatesDropped: 500,
    badLines: 0,
    groups: 5000,
    tier1Groups: 60,
    countryTop: 140,
    overflow: 20,
    regions: 300,
    regionRows: 2400,
    cityShards: 40,
    cityRecords: 900,
    published: true,
    bandRelaxed: false,
    violations: [],
    archive: "archives/stories-a1b2c3d4.pmtiles",
    prunedArchives: 1,
    prunedShards: 2,
    pinged: true,
    ...patch,
  };
}

describe("formatSummary", () => {
  it("reports a healthy run without warnings", () => {
    const text = formatSummary(summary());
    expect(text).toContain("archives/stories-a1b2c3d4.pmtiles");
    expect(text).toContain("healthcheck  pinged");
    expect(text).not.toContain("WARN");
  });

  it("warns when the schema canary trips", () => {
    expect(formatSummary(summary({ shortRows: 17 }))).toContain("schema canary");
  });

  it("warns when tier-1 goes to zero — §8's silent degradation", () => {
    // Nothing else fails when this happens, which is the entire reason it is
    // called out rather than left to be inferred from the counts.
    expect(formatSummary(summary({ tier1Groups: 0 }))).toContain("degraded to plain salience");
  });

  it("does not warn about tier-1 on a run with no groups at all", () => {
    // That run has a much louder problem and the invariants already said so.
    expect(formatSummary(summary({ groups: 0, tier1Groups: 0, published: false, violations: ["no groups to publish (0)"] }))).not.toContain(
      "degraded to plain salience",
    );
  });

  it("names every unknown FIPS code with its story count", () => {
    const text = formatSummary(summary({ unknownFips: new Map([["XX", 9]]) }));
    expect(text).toContain("unknown FIPS code XX on 9 stories");
  });

  it("prints the violations and no archive when publication is refused", () => {
    const text = formatSummary(
      summary({ published: false, violations: ["only 3 distinct countries, floor is 15"], archive: "", pinged: false }),
    );
    expect(text).toContain("PUBLISHED    NOTHING");
    expect(text).toContain("only 3 distinct countries");
    expect(text).not.toContain("stories-a1b2c3d4");
  });

  it("never lets a relaxed count band read as an ordinary success", () => {
    // The band standing down is the escape from a fail-forever wedge, but the run
    // still published output its own history calls implausible. §8's whole
    // premise is that the summary is the only interface to these failures.
    const text = formatSummary(summary({ bandRelaxed: true }));
    expect(text).toContain("WARN");
    expect(text).toContain("count band stood down");
  });

  it("flags a publish whose healthcheck ping failed", () => {
    expect(formatSummary(summary({ pinged: false }))).toContain("NOT pinged");
  });
});
