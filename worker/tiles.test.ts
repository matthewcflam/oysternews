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
   * **These assertions pin a known-wrong state, deliberately.**
   *
   * The directive belongs at Feature level per `man tippecanoe`, and it is
   * inside `properties` instead — so it is ignored and §2.4's budget does not
   * run. It is written here the wrong way because the right way was tried on
   * 2026-08-14 and published an archive with **one feature per layer per tile at
   * every zoom**, which is a worse map than a too-dense one. `tiles.ts` has the
   * measurements and the standalone repro.
   *
   * So this file's job is not "the directive is correct". It is: **the shape
   * does not change by accident, and whoever changes it on purpose has read
   * why it is like this.**
   */
  it("currently sits inside properties, which is why the budget does not run", () => {
    const [feature] = featuresOf([group({ minzoom: 7 })]);
    expect(feature.properties.tippecanoe).toEqual({ minzoom: 7 });
    expect(feature.tippecanoe).toBeUndefined();
  });

  it("carries the budget's minzoom unchanged, including the do-not-render sentinel", () => {
    // budget.ts assigns MAX_BUDGET_ZOOM + 1 = 13 to groups that never win a
    // slot. The value has to survive this function intact whether or not
    // tippecanoe currently acts on it, or the eventual fix inherits a second
    // bug on top of the first.
    const features = featuresOf([group({ minzoom: 0 }), group({ minzoom: 13 })]);
    expect(features.map((f) => f.properties.tippecanoe.minzoom)).toEqual([0, 13]);
  });

  it("emits a directive for every feature, never a bare one", () => {
    const features = featuresOf([group({ minzoom: 3 }), group({ minzoom: 9 })]);
    for (const feature of features) {
      expect(typeof feature.properties.tippecanoe?.minzoom).toBe("number");
    }
  });

  it("keeps minzoom numeric, because the string form is silently ignored", () => {
    // Measured on tippecanoe 2.49.0: `{"minzoom": "0"}` is discarded outright
    // rather than erroring. If the eventual fix moves this to Feature level, a
    // stringified value would look like it worked and change nothing.
    const [feature] = featuresOf([group({ minzoom: 4 })]);
    expect(typeof feature.properties.tippecanoe.minzoom).toBe("number");
  });
});

describe("the feature payload", () => {
  it("carries exactly the §2.6 properties and no article text", () => {
    // The copyright constraint is enforced here rather than reviewed. A new
    // property added upstream must be added to this list deliberately.
    //
    // `tippecanoe` is in this list under protest: it is the misplaced directive,
    // and it is riding into every tile as a real attribute on every published
    // feature. It costs payload on every tile fetch and means nothing to the
    // browser. **When the directive finally moves to Feature level, delete it
    // from here** — its presence in this list is a marker for that unfinished
    // work, not an approved property.
    const [feature] = featuresOf([group()]);
    expect(Object.keys(feature.properties).sort()).toEqual(
      [
        "country",
        "date",
        "domains",
        "kind",
        "place",
        "region",
        "salience",
        "source",
        "tier1",
        "tippecanoe",
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
    expect(feature.properties.tippecanoe.minzoom).toBe(11);
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
