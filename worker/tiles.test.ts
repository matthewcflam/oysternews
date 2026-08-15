import { describe, expect, it } from "vitest";

import type { StoryGroup } from "../lib/types.ts";
import { toGeoJson } from "./tiles.ts";

/**
 * `tiles.ts` is I/O and had no test at all, which is how a one-level nesting
 * typo survived every run for the life of the project: the `tippecanoe`
 * directive was written **inside `properties`**, where tippecanoe does not look
 * for it, so every per-feature `minzoom` from budget.ts was ignored and §2.4's
 * density budget never ran on a published archive.
 *
 * Nothing failed when that was wrong. tippecanoe exited 0, the archive
 * published, the §8 invariants passed, and the map looked busy rather than
 * broken. So these tests assert the **shape** rather than the behaviour, because
 * shape is the only thing observable this side of the subprocess — and the shape
 * is the entire mechanism.
 *
 * `toGeoJson` is the seam deliberately: it is the last point where the payload
 * is still inspectable, and the copyright rule (§2.6) lives here too.
 */
function group(overrides: Partial<StoryGroup> = {}): StoryGroup {
  return {
    id: "g1",
    title: "A headline",
    image: "",
    url: "https://example.com/a",
    domain: "example.com",
    lat: 51.5,
    lon: -0.12,
    kind: "PIN",
    countryCode: "UK",
    regionId: "UKH9",
    adm1: "UKH9",
    placeName: "London, United Kingdom",
    distinctDomains: 3,
    distinctSourceCountries: 2,
    salience: 1.7329,
    tier1Fresh: false,
    newestTier1: "",
    newestArticle: "20260814053000",
    minzoom: 7,
    ...overrides,
  };
}

function featuresOf(groups: StoryGroup[]): any[] {
  return JSON.parse(toGeoJson(groups)).features;
}

describe("the tippecanoe directive", () => {
  /**
   * **Both known failures of this directive are invisible from here**, so these
   * assert the shape in both directions rather than the behaviour.
   *
   * Nested inside `properties` it is ignored and the budget never runs (1,714
   * pins at world zoom). At Feature level on tippecanoe < 2.52.0 it is honoured
   * by a version that then drops every feature declaring one, leaving exactly
   * one per tile. tippecanoe exits 0 either way. The version half of that is
   * enforced in `scripts/run-tippecanoe.sh`; this file holds the placement half.
   */
  it("sits at Feature level, beside geometry, which is the only place it works", () => {
    const [feature] = featuresOf([group({ minzoom: 7 })]);
    expect(feature.tippecanoe).toEqual({ minzoom: 7 });
  });

  it("is not inside properties, where it is silently ignored", () => {
    // This is the exact regression that ran for the life of the project. It is
    // stated separately from the assertion above because the two can both be
    // true — writing it in both places would ship a real directive and a stray
    // attribute on every feature in every tile.
    const [feature] = featuresOf([group({ minzoom: 7 })]);
    expect(feature.properties.tippecanoe).toBeUndefined();
  });

  it("carries the budget's minzoom unchanged, including the do-not-render sentinel", () => {
    // budget.ts assigns MAX_BUDGET_ZOOM + 1 = 13 to groups that never win a
    // slot. Above tippecanoe's -z12 ceiling, so those never render — which is
    // how overflow leaves the map without leaving the pipeline.
    const features = featuresOf([group({ minzoom: 0 }), group({ minzoom: 13 })]);
    expect(features.map((f) => f.tippecanoe.minzoom)).toEqual([0, 13]);
  });

  it("emits a directive for every feature, never a bare one", () => {
    const features = featuresOf([group({ minzoom: 3 }), group({ minzoom: 9 })]);
    for (const feature of features) {
      expect(typeof feature.tippecanoe?.minzoom).toBe("number");
    }
  });

  it("keeps minzoom numeric, because the string form is silently ignored", () => {
    // Measured across 2.49.0, 2.52.0 and 2.79.0: `{"minzoom": "0"}` is discarded
    // outright rather than erroring, on every version. A stringified value looks
    // exactly like a working one and changes nothing.
    const [feature] = featuresOf([group({ minzoom: 4 })]);
    expect(typeof feature.tippecanoe.minzoom).toBe("number");
  });
});

describe("the feature payload", () => {
  it("carries exactly the §2.6 properties and no article text", () => {
    // The copyright constraint is enforced here rather than reviewed. A new
    // property added upstream must be added to this list deliberately.
    //
    // `tippecanoe` is deliberately absent: it is a directive at Feature level,
    // consumed and stripped by the tile build, so it never reaches the browser.
    // If it reappears in this list the directive has been nested back inside
    // `properties`, where it does nothing but cost payload on every tile fetch.
    const [feature] = featuresOf([group()]);
    expect(Object.keys(feature.properties).sort()).toEqual(
      [
        "country",
        "date",
        "domains",
        // Added 2026-08-14 with V2.1SHARINGIMAGE. The most expensive property
        // here — mean 115 bytes against a 7.2 MB archive — and it bought the
        // deletion of a server-side article fetch. A URL, never bytes.
        "image",
        "kind",
        "place",
        "region",
        "salience",
        "source",
        "tier1",
        "title",
        "url",
      ].sort(),
    );
  });

  it("writes GeoJSON coordinates as [lon, lat], not [lat, lon]", () => {
    // Swapping these puts London in the Indian Ocean and throws no error.
    const [feature] = featuresOf([group({ lat: 51.5, lon: -0.12 })]);
    expect(feature.geometry.coordinates).toEqual([-0.12, 51.5]);
  });

  it("rounds salience but does not round the minzoom it is ranked into", () => {
    const [feature] = featuresOf([group({ salience: 1.732912345, minzoom: 11 })]);
    expect(feature.properties.salience).toBe(1.7329);
    expect(feature.tippecanoe.minzoom).toBe(11);
  });

  it("flattens tier1 to 0/1, because vector tiles have no boolean", () => {
    const [yes] = featuresOf([group({ tier1Fresh: true })]);
    const [no] = featuresOf([group({ tier1Fresh: false })]);
    expect(yes.properties.tier1).toBe(1);
    expect(no.properties.tier1).toBe(0);
  });

  it("emits newline-terminated JSON, one FeatureCollection", () => {
    const text = toGeoJson([group()]);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text).type).toBe("FeatureCollection");
  });
});
