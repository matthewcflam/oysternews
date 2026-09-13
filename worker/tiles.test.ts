import { describe, expect, it } from "vitest";

import type { StoryGroup } from "../src/lib/types.ts";
import { toGeoJson } from "./tiles.ts";

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
  it("sits at Feature level, beside geometry, which is the only place it works", () => {
    const [feature] = featuresOf([group({ minzoom: 7 })]);
    expect(feature.tippecanoe).toEqual({ minzoom: 7 });
  });

  it("is not inside properties, where it is silently ignored", () => {
    const [feature] = featuresOf([group({ minzoom: 7 })]);
    expect(feature.properties.tippecanoe).toBeUndefined();
  });

  it("carries the budget's minzoom unchanged, including the do-not-render sentinel", () => {
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
    const [feature] = featuresOf([group({ minzoom: 4 })]);
    expect(typeof feature.tippecanoe.minzoom).toBe("number");
  });
});

describe("the feature payload", () => {
  it("carries exactly the §2.6 properties and no article text", () => {
    const [feature] = featuresOf([group()]);
    expect(Object.keys(feature.properties).sort()).toEqual(
      [
        "country",
        "date",
        "domains",
        "image",
        "kind",
        "place",
        "region",
        "salience",
        "source",
        "tier1",
        "title",
        "url",
      ].sort()
    );
  });

  it("writes GeoJSON coordinates as [lon, lat], not [lat, lon]", () => {
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
