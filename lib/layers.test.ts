import { describe, expect, it } from "vitest";
import {
  COUNTRIES_SOURCE_LAYER,
  COUNTRY_HIT_ID,
  COUNTRY_LAYER_ID,
  COUNTRY_LAYER_MAXZOOM,
  COUNTRY_OUTLINE_ID,
  COUNTRY_SOURCE_LAYER,
  HIT_LAYER_FOR,
  LABELS_LAYER_ID,
  LABEL_FONT,
  MATCH_NOTHING,
  OUTLINE_LAYER_FOR,
  REGIONS_SOURCE_LAYER,
  REGION_HIT_ID,
  REGION_OUTLINE_ID,
  STORIES_LAYER_ID,
  STORIES_SOURCE_LAYER,
  boundaryLayers,
  hitLayers,
  matchId,
  outlineFor,
  storyLayers,
} from "./layers";

const layers = storyLayers();
const [country, stories, labels] = layers;

/** Every property name that appears anywhere in a layer's expressions. */
const propertiesRead = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) {
    if (value[0] === "get" && typeof value[1] === "string") found.push(value[1]);
    for (const item of value) propertiesRead(item, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) propertiesRead(item, found);
  }
  return found;
};

describe("storyLayers", () => {
  it("puts country-top under stories, and labels over both", () => {
    // Order is the whole mechanism for resolving the overlap between the two
    // layers. A reordering would silently reintroduce the low-zoom double draw.
    expect(layers.map((layer) => layer.id)).toEqual([
      COUNTRY_LAYER_ID,
      STORIES_LAYER_ID,
      LABELS_LAYER_ID,
    ]);
  });

  it("caps the country floor so it cannot double-draw with stories", () => {
    expect(country.maxzoom).toBe(COUNTRY_LAYER_MAXZOOM);
    expect(country["source-layer"]).toBe(COUNTRY_SOURCE_LAYER);
    // The stories layer must NOT be capped — it is the one that runs to z12.
    expect(stories.maxzoom).toBeUndefined();
    expect(stories["source-layer"]).toBe(STORIES_SOURCE_LAYER);
  });

  it("labels only ever render the headline (§2.6, link-out only)", () => {
    // The one surface where article prose could reach the screen. If a future
    // change points text-field at anything else, this is the tripwire.
    expect(labels.layout?.["text-field"]).toEqual(["get", "title"]);
    expect(propertiesRead(labels.layout?.["text-field"])).toEqual(["title"]);
  });

  it("names a font both basemaps can serve", () => {
    // MapTiler has Roboto; OpenFreeMap does not. Naming Roboto first 404s the
    // glyph range on the keyless fallback and the labels vanish.
    expect(labels.layout?.["text-font"]).toEqual(LABEL_FONT);
    expect(LABEL_FONT).toEqual(["Noto Sans Regular"]);
  });

  it("resolves label collisions by salience, with overlap off", () => {
    const layout = labels.layout!;
    expect(layout["text-allow-overlap"]).toBe(false);
    // Negated: MapLibre places LOWER sort keys first, and §2.5 wants the most
    // salient headline to be the one that survives a collision.
    expect(layout["symbol-sort-key"]).toEqual(["-", 0, ["get", "salience"]]);
  });

  it("distinguishes containers from pins in both fill and stroke", () => {
    // §2.1 measured containers and pins at different accuracies. Drawing them
    // identically would claim a precision the placement rule does not have.
    for (const layer of [stories, country]) {
      expect(propertiesRead(layer.paint?.["circle-color"])).toContain("kind");
      expect(propertiesRead(layer.paint?.["circle-stroke-color"])).toContain("kind");
    }
  });

  it("never reads tier1 — the preference is invisible by design", () => {
    // §2.3: no tier-1 badge and no tier-1 toggle. Tier-1 priority is expressed
    // only in WHICH stories the budget admitted, never in how one is drawn.
    expect(propertiesRead(layers)).not.toContain("tier1");
  });

  it("sizes pins by salience, the §2.5 comparator's own term", () => {
    expect(propertiesRead(stories.paint?.["circle-radius"])).toContain("salience");
  });
});

describe("boundaryLayers", () => {
  const [countryOutline, regionOutline] = boundaryLayers();

  it("draws outlines as lines, never as fills (§2.2)", () => {
    // "The polygon is never a fill. It is a click-reveal only." A filled country
    // would read as a claim about the whole country.
    for (const layer of [countryOutline, regionOutline]) {
      expect(layer.type).toBe("line");
    }
  });

  it("starts matching nothing, so no outline shows by default", () => {
    for (const layer of [countryOutline, regionOutline]) {
      expect(layer.filter).toEqual(MATCH_NOTHING);
    }
  });

  it("reads the two layers built by scripts/build-boundaries.ts", () => {
    expect(countryOutline["source-layer"]).toBe(COUNTRIES_SOURCE_LAYER);
    expect(regionOutline["source-layer"]).toBe(REGIONS_SOURCE_LAYER);
  });
});

describe("hitLayers", () => {
  const [countryHit, regionHit] = hitLayers();

  it("paints nothing — §2.2's amendment is the whole of what makes it legal", () => {
    // §2.2: "The polygon is never a fill." The 2026-08-13 amendment allows an
    // UNPAINTED fill purely as a hit target. A visible colour here is a
    // violation of the product rule, not a styling change, so it fails a test.
    for (const layer of [countryHit, regionHit]) {
      expect(layer.type).toBe("fill");
      expect(layer.paint?.["fill-opacity"]).toBe(0);
      expect(layer.paint?.["fill-color"]).toBeUndefined();
      // `visibility: none` would remove the layer from queryRenderedFeatures
      // entirely — the layer would stop answering, silently.
      expect(layer.layout?.visibility).toBeUndefined();
    }
  });

  it("hit-tests the same two archives the outlines draw", () => {
    expect(countryHit["source-layer"]).toBe(COUNTRIES_SOURCE_LAYER);
    expect(regionHit["source-layer"]).toBe(REGIONS_SOURCE_LAYER);
    expect([countryHit.id, regionHit.id]).toEqual([COUNTRY_HIT_ID, REGION_HIT_ID]);
  });

  it("carries no filter, unlike the outlines", () => {
    // The outlines are filtered down to one region; the hit targets must answer
    // for every polygon or a label click would find nothing under it.
    for (const layer of [countryHit, regionHit]) expect(layer.filter).toBeUndefined();
  });

  it("routes a label's level to a hit layer and an outline of the same level", () => {
    expect(HIT_LAYER_FOR.country).toBe(COUNTRY_HIT_ID);
    expect(HIT_LAYER_FOR.state).toBe(REGION_HIT_ID);
    expect(OUTLINE_LAYER_FOR.country).toBe(COUNTRY_OUTLINE_ID);
    expect(OUTLINE_LAYER_FOR.state).toBe(REGION_OUTLINE_ID);
  });
});

describe("matchId", () => {
  it("is the inverse of MATCH_NOTHING over the same property", () => {
    expect(matchId("USCA")).toEqual(["==", ["get", "id"], "USCA"]);
    // The sentinel must be a value no boundary feature can hold —
    // build-boundaries.ts skips a feature with no code.
    expect(MATCH_NOTHING).toEqual(["==", ["get", "id"], ""]);
  });
});

describe("outlineFor", () => {
  it("sends a country container to the countries layer", () => {
    // A country container's region code IS its country code, e.g. Spain: SP/SP.
    expect(outlineFor({ kind: "CONTAINER", region: "SP", country: "SP" })).toEqual({
      layerId: COUNTRY_OUTLINE_ID,
      id: "SP",
    });
  });

  it("sends an admin-1 container to the regions layer", () => {
    // GDELT's own spellings, both measured in the first real run.
    expect(outlineFor({ kind: "CONTAINER", region: "USCA", country: "US" })).toEqual({
      layerId: REGION_OUTLINE_ID,
      id: "USCA",
    });
    expect(outlineFor({ kind: "CONTAINER", region: "UKC9", country: "UK" })).toEqual({
      layerId: REGION_OUTLINE_ID,
      id: "UKC9",
    });
  });

  it("outlines nothing for a pin", () => {
    // §2.1: a PIN is at an exact location. Drawing a region around it would
    // claim the opposite of what the placement rule decided.
    expect(outlineFor({ kind: "PIN", region: "USCA", country: "US" })).toBeNull();
  });

  it("outlines nothing rather than guessing when the region is missing", () => {
    expect(outlineFor({ kind: "CONTAINER", region: "", country: "US" })).toBeNull();
    expect(outlineFor({})).toBeNull();
  });
});
