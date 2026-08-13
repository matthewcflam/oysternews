import { describe, expect, it } from "vitest";
import { firstLabel, labelAnchor, labelLevelOf, labelName } from "./labels";

/**
 * The two providers' real shapes, taken from their live styles on 2026-08-13 —
 * see `labels.ts`'s header for the probe output. These fixtures are the whole
 * point of the file: the gesture fails silently when a schema moves, so the
 * schemas are pinned here rather than trusted.
 */
const maptilerCountry = {
  sourceLayer: "country_label",
  properties: { name: "Pakistan", "name:en": "Pakistan", iso_a2: "PK" },
  geometry: { type: "Point", coordinates: [69.3, 30.4] },
};

const maptilerState = {
  sourceLayer: "state_label",
  properties: { name: "California", iso_a2: "US", admin_level: 40 },
  geometry: { type: "Point", coordinates: [-119.4, 36.7] },
};

const openfreemapCountry = {
  sourceLayer: "place",
  properties: { name: "Pakistan", class: "country", rank: 3 },
  geometry: { type: "Point", coordinates: [69.3, 30.4] },
};

const openfreemapState = {
  sourceLayer: "place",
  properties: { name: "California", class: "state" },
  geometry: { type: "Point", coordinates: [-119.4, 36.7] },
};

describe("labelLevelOf", () => {
  it("reads MapTiler's separate label source-layers", () => {
    expect(labelLevelOf(maptilerCountry)).toBe("country");
    expect(labelLevelOf(maptilerState)).toBe("state");
  });

  it("reads OpenFreeMap's single place layer by class", () => {
    // OpenMapTiles puts countries, states, cities and villages in one layer.
    // Accepting `place` wholesale would make every village a region click.
    expect(labelLevelOf(openfreemapCountry)).toBe("country");
    expect(labelLevelOf(openfreemapState)).toBe("state");
  });

  it("accepts MapTiler's disputed-country labels as countries", () => {
    // They are drawn like any other country label, so refusing them would leave
    // an unexplainable dead spot on the map.
    expect(
      labelLevelOf({ sourceLayer: "country_disputed_label", properties: { name: "Kosovo" } }),
    ).toBe("country");
  });

  it("refuses city, village and continent labels on both providers", () => {
    expect(labelLevelOf({ sourceLayer: "place", properties: { class: "city" } })).toBeNull();
    expect(labelLevelOf({ sourceLayer: "place", properties: { class: "village" } })).toBeNull();
    expect(labelLevelOf({ sourceLayer: "place", properties: { class: "continent" } })).toBeNull();
    expect(labelLevelOf({ sourceLayer: "place_label", properties: { class: "city" } })).toBeNull();
  });

  it("refuses our own layers, so a pin is never mistaken for a label", () => {
    expect(labelLevelOf({ sourceLayer: "stories", properties: { kind: "PIN" } })).toBeNull();
    expect(labelLevelOf({ sourceLayer: "country-top", properties: { kind: "CONTAINER" } })).toBeNull();
    expect(labelLevelOf({ sourceLayer: "countries", properties: { id: "PK" } })).toBeNull();
  });

  it("refuses a feature with no source-layer at all", () => {
    expect(labelLevelOf(null)).toBeNull();
    expect(labelLevelOf(undefined)).toBeNull();
    expect(labelLevelOf({})).toBeNull();
    expect(labelLevelOf({ sourceLayer: "place" })).toBeNull();
  });
});

describe("firstLabel", () => {
  it("takes the top-most label, so a state beats the country under it", () => {
    // MapLibre returns render order, top-most first. Clicking "Texas" must
    // select Texas even though the country label is under the same pixel.
    const hit = firstLabel([maptilerState, maptilerCountry]);
    expect(hit?.level).toBe("state");
    expect(hit?.feature).toBe(maptilerState);
  });

  it("skips basemap features that are not labels", () => {
    const roads = { sourceLayer: "transportation_name", properties: { class: "motorway" } };
    const hit = firstLabel([roads, openfreemapCountry]);
    expect(hit?.level).toBe("country");
    expect(hit?.feature).toBe(openfreemapCountry);
  });

  it("returns null for a click that hit no label", () => {
    expect(firstLabel([])).toBeNull();
    expect(firstLabel([{ sourceLayer: "water", properties: {} }])).toBeNull();
  });
});

describe("labelAnchor", () => {
  it("returns the label's own point, not the click's", () => {
    expect(labelAnchor(maptilerCountry)).toEqual([69.3, 30.4]);
  });

  it("returns null for anything that is not a usable point", () => {
    // A polygon label, or a feature whose geometry did not survive the tile.
    expect(labelAnchor({ geometry: { type: "Polygon", coordinates: [] } })).toBeNull();
    expect(labelAnchor({ geometry: { type: "Point", coordinates: [1] } })).toBeNull();
    expect(labelAnchor({ geometry: { type: "Point", coordinates: [NaN, 5] } })).toBeNull();
    expect(labelAnchor({})).toBeNull();
  });
});

describe("labelName", () => {
  it("prefers the English name where the provider has one (§2.6)", () => {
    expect(labelName({ properties: { name: "Deutschland", "name:en": "Germany" } })).toBe("Germany");
  });

  it("falls back to the bare name OpenFreeMap ships", () => {
    expect(labelName(openfreemapState)).toBe("California");
  });

  it("returns an empty string rather than inventing one", () => {
    expect(labelName({ properties: { name: "  " } })).toBe("");
    expect(labelName({})).toBe("");
    expect(labelName(null)).toBe("");
  });
});
