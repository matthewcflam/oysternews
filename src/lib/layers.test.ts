import { describe, expect, it } from "vitest";
import {
  ACCENT,
  basemapLabelLayerIds,
  boundaryLayers,
  CLICKABLE_LAYER_IDS,
  COUNTRIES_SOURCE_LAYER,
  COUNTRY_HIT_ID,
  COUNTRY_LAYER_ID,
  COUNTRY_LAYER_MAXZOOM,
  COUNTRY_OUTLINE_ID,
  COUNTRY_SOURCE_LAYER,
  firstPlaceLabelLayerId,
  HIT_LAYER_FOR,
  hitLayers,
  LABEL_FONT,
  LABEL_GAP,
  LABEL_TEXT_SIZE,
  LABELS_LAYER_ID,
  MATCH_NOTHING,
  matchId,
  NOT_CONTAINER,
  OUTLINE_LAYER_FOR,
  outlineFor,
  PIN_IMAGE_ID,
  REGION_HIT_ID,
  REGION_OUTLINE_ID,
  REGIONS_SOURCE_LAYER,
  SELECTED_LAYER_ID,
  SELECTED_SOURCE_ID,
  SELECTED_STATE_KEY,
  STORIES_LAYER_ID,
  STORIES_SOURCE_LAYER,
  selectedPinLayer,
  spiderLayers,
  storyLayers,
  TOP_LAYER_ID,
  TOP_STATE_KEY,
  topFilter,
  topPinLayer,
} from "./layers";

const layers = storyLayers();
const [country, stories, labels] = layers;

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
  it("puts country-top under stories, with the headlines last", () => {
    expect(layers.map((layer) => layer.id)).toEqual([
      COUNTRY_LAYER_ID,
      STORIES_LAYER_ID,
      LABELS_LAYER_ID,
    ]);
  });

  it("caps the country floor so it cannot double-draw with stories", () => {
    expect(country.maxzoom).toBe(COUNTRY_LAYER_MAXZOOM);
    expect(country["source-layer"]).toBe(COUNTRY_SOURCE_LAYER);
    expect(stories.maxzoom).toBeUndefined();
    expect(stories["source-layer"]).toBe(STORIES_SOURCE_LAYER);
  });

  it("labels only ever render the headline (link-out only)", () => {
    expect(labels.layout?.["text-field"]).toEqual(["get", "title"]);
    expect(propertiesRead(labels.layout?.["text-field"])).toEqual(["title"]);
  });

  it("names a font both basemaps can serve", () => {
    expect(labels.layout?.["text-font"]).toEqual(LABEL_FONT);
    expect(LABEL_FONT).toEqual(["Noto Sans Regular"]);
  });

  it("resolves label collisions by salience, with overlap off", () => {
    const layout = labels.layout!;
    expect(layout["text-allow-overlap"]).toBe(false);
    expect(layout["symbol-sort-key"]).toEqual(["-", 0, ["get", "salience"]]);
  });

  it("draws every unselected story in one orange, and the open one in white", () => {
    for (const layer of [stories, country]) {
      const fill = layer.paint?.["circle-color"] as unknown[];
      expect(fill[0]).toBe("case");
      expect(fill).toHaveLength(4);
      expect(fill[2]).toBe("#ffffff");
      expect(fill[3]).toBe(ACCENT);
      expect(propertiesRead(fill)).toEqual([SELECTED_STATE_KEY]);
      expect(layer.paint?.["circle-stroke-color"]).toBe("#ffffff");
    }
  });

  it("reads the selection both ways, so a spider leaf can wear it too", () => {
    const json = JSON.stringify(stories.paint?.["circle-color"]);
    expect(json).toContain(`["boolean",["feature-state","${SELECTED_STATE_KEY}"],false]`);
    expect(json).toContain(`["==",["get","${SELECTED_STATE_KEY}"],1]`);
  });

  it("gives the ring to the top 5 and to nothing else", () => {
    for (const layer of [stories, country]) {
      const width = layer.paint?.["circle-stroke-width"] as unknown[];
      for (const branch of [width[4], width[6]] as unknown[][]) {
        expect(branch[0]).toBe("case");
        expect(JSON.stringify(branch[1])).toContain("feature-state");
        expect(branch[3]).toBe(0);
      }
      expect(propertiesRead(width)).not.toContain("kind");
    }
  });

  it("keeps one footprint, so the ring never makes a pin bigger", () => {
    for (const layer of [stories, country]) {
      const radius = layer.paint?.["circle-radius"] as unknown[];
      for (const branch of [radius[4], radius[6]] as unknown[][]) {
        expect(branch[0]).toBe("case");
        expect((branch[2] as unknown[])[0]).toBe("*");
        expect((branch[2] as unknown[])[2]).toBeCloseTo(0.68);
        expect(JSON.stringify(branch[3])).toBe(JSON.stringify((branch[2] as unknown[])[1]));
      }
    }
  });

  it("keeps ['zoom'] at the top level of every paint property", () => {
    const topLevelZoom = (paint: Record<string, unknown>) => {
      for (const value of Object.values(paint)) {
        if (!Array.isArray(value)) continue;
        const isZoomInterpolation =
          (value[0] === "interpolate" || value[0] === "step") &&
          JSON.stringify(value[2]) === '["zoom"]';
        const rest = isZoomInterpolation ? value.slice(3) : value;
        expect(JSON.stringify(rest)).not.toContain('["zoom"]');
      }
    };
    for (const layer of [stories, country]) topLevelZoom(layer.paint as Record<string, unknown>);
  });

  it("puts the top-5 highlight on feature state, never on a property", () => {
    for (const key of ["circle-radius", "circle-stroke-width"] as const) {
      const json = JSON.stringify(stories.paint?.[key]);
      expect(json).toContain(`["feature-state","${TOP_STATE_KEY}"]`);
      expect(json).toContain(`["boolean",["feature-state","${TOP_STATE_KEY}"],false]`);
    }
  });

  it("draws every state solid — no partial-alpha fills", () => {
    for (const layer of [stories, country]) {
      expect(JSON.stringify(layer.paint?.["circle-color"])).not.toContain("rgba");
      expect(layer.paint?.["circle-opacity"]).toBeUndefined();
    }
  });

  it("filters containers off every layer that draws a story", () => {
    for (const layer of [stories, country, labels]) {
      expect(layer.filter).toEqual(NOT_CONTAINER);
    }
    expect(NOT_CONTAINER).toEqual(["!=", ["get", "kind"], "CONTAINER"]);
  });

  it("never reads tier1 — the preference is invisible by design", () => {
    expect(propertiesRead(layers)).not.toContain("tier1");
  });

  it("sizes pins by salience, the ranking comparator's own term", () => {
    expect(propertiesRead(stories.paint?.["circle-radius"])).toContain("salience");
  });

  it("keeps every pin footprint at least 6px, even at the salience floor", () => {
    const radius = stories.paint?.["circle-radius"] as unknown[];
    const zoom1Footprint = (radius[4] as unknown[])[3] as unknown[] as unknown[];
    const stops = [4, 6, 8, 10].map((i) => zoom1Footprint[i] as number);
    for (const stop of stops) expect(stop).toBeGreaterThanOrEqual(6);
  });

  it("keeps the headline clear of its own disc at every salience stop", () => {
    const radius = stories.paint?.["circle-radius"] as unknown[];
    const offset = labels.layout?.["text-offset"] as unknown[];
    for (const zoomIndex of [4, 6] as const) {
      const footprint = (radius[zoomIndex] as unknown[])[3] as unknown[];
      const offsetExpr = offset[zoomIndex] as unknown[];
      for (const stopIndex of [4, 6, 8, 10] as const) {
        const pinRadius = footprint[stopIndex] as number;
        const literal = offsetExpr[stopIndex] as unknown[];
        const offsetEm = (literal[1] as number[])[1];
        expect(offsetEm * LABEL_TEXT_SIZE - pinRadius).toBeGreaterThanOrEqual(LABEL_GAP - 0.001);
      }
    }
  });
});

describe("the top-5 layer and the leaves' sort key", () => {
  const top = topPinLayer();
  const [, leaves] = spiderLayers();

  it("paints the top-5 copy exactly like the pin underneath it", () => {
    expect(top.paint).toEqual(stories.paint);
    expect(top["source-layer"]).toBe(STORIES_SOURCE_LAYER);
    expect(top.maxzoom).toBeUndefined();
  });

  it("starts matching nothing, so no story is doubled before the first rank", () => {
    expect(top.filter).toEqual(topFilter([]));
    expect(JSON.stringify(topFilter([]))).toContain("[]");
  });

  it("selects by url, the one property unique per group", () => {
    expect(topFilter(["a", "b"])).toEqual([
      "all",
      NOT_CONTAINER,
      ["in", ["get", "url"], ["literal", ["a", "b"]]],
    ]);
  });

  it("cannot resurrect a container that ranked into the top 5", () => {
    expect(JSON.stringify(topFilter(["a"]))).toContain(JSON.stringify(NOT_CONTAINER));
  });

  it("orders the leaves by the top flag, which must be a PROPERTY", () => {
    expect(leaves.layout?.["circle-sort-key"]).toEqual(["get", TOP_STATE_KEY]);
    expect(JSON.stringify(leaves.layout)).not.toContain("feature-state");
  });

  it("keeps the clickable layers in drawn order, top-most first", () => {
    expect(CLICKABLE_LAYER_IDS.indexOf(TOP_LAYER_ID)).toBeLessThan(
      CLICKABLE_LAYER_IDS.indexOf(STORIES_LAYER_ID)
    );
    expect(CLICKABLE_LAYER_IDS).not.toContain(LABELS_LAYER_ID);
  });
});

describe("selectedPinLayer", () => {
  const pin = selectedPinLayer();

  it("anchors the triangle's point on the coordinate", () => {
    expect(pin.layout?.["icon-anchor"]).toBe("bottom");
    expect(pin.layout?.["icon-image"]).toBe(PIN_IMAGE_ID);
    expect(pin.source).toBe(SELECTED_SOURCE_ID);
    expect(pin.id).toBe(SELECTED_LAYER_ID);
  });

  it("never yields to a symbol collision, and never causes one", () => {
    expect(pin.layout?.["icon-allow-overlap"]).toBe(true);
    expect(pin.layout?.["icon-ignore-placement"]).toBe(true);
  });
});

describe("firstPlaceLabelLayerId", () => {
  const maptiler = [
    { id: "Water", "source-layer": "water" },
    { id: "City labels", "source-layer": "city_label" },
    { id: "State labels z2", "source-layer": "state_label" },
    { id: "Country labels", "source-layer": "country_label" },
  ];
  const openfreemap = [
    { id: "water", "source-layer": "water" },
    { id: "label_country_1", "source-layer": "place" },
    { id: "label_state", "source-layer": "place" },
  ];

  it("finds the FIRST place-label layer on either provider", () => {
    expect(firstPlaceLabelLayerId(maptiler)).toBe("City labels");
    expect(firstPlaceLabelLayerId(openfreemap)).toBe("label_country_1");
  });

  it("returns undefined for a style it does not recognise", () => {
    expect(firstPlaceLabelLayerId([{ id: "background" }])).toBeUndefined();
    expect(firstPlaceLabelLayerId([])).toBeUndefined();
  });
});

describe("basemapLabelLayerIds", () => {
  it("returns every symbol layer that draws text, and nothing else", () => {
    const layers = [
      { id: "Water", type: "fill" },
      { id: "Road labels", type: "symbol", layout: { "text-field": "{name}" } },
      { id: "Oneway arrows", type: "symbol", layout: { "icon-image": "arrow" } },
      { id: "Country labels", type: "symbol", layout: { "text-field": ["get", "name"] } },
      { id: "Bare symbol", type: "symbol" },
    ];
    expect(basemapLabelLayerIds(layers)).toEqual(["Road labels", "Country labels"]);
  });

  it("leaves out layers the style ships hidden, so re-enabling never reveals them", () => {
    const layers = [
      { id: "Country labels", type: "symbol", layout: { "text-field": "{name}" } },
      {
        id: "Continent labels",
        type: "symbol",
        layout: { "text-field": "{name}", visibility: "none" },
      },
    ];
    expect(basemapLabelLayerIds(layers)).toEqual(["Country labels"]);
  });
});

describe("boundaryLayers", () => {
  const [countryOutline, regionOutline] = boundaryLayers();

  it("draws outlines as lines, never as fills", () => {
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

  it("paints nothing, so it is a hit target and never a visible fill", () => {
    for (const layer of [countryHit, regionHit]) {
      expect(layer.type).toBe("fill");
      expect(layer.paint?.["fill-opacity"]).toBe(0);
      expect(layer.paint?.["fill-color"]).toBeUndefined();
      expect(layer.layout?.visibility).toBeUndefined();
    }
  });

  it("hit-tests the same two archives the outlines draw", () => {
    expect(countryHit["source-layer"]).toBe(COUNTRIES_SOURCE_LAYER);
    expect(regionHit["source-layer"]).toBe(REGIONS_SOURCE_LAYER);
    expect([countryHit.id, regionHit.id]).toEqual([COUNTRY_HIT_ID, REGION_HIT_ID]);
  });

  it("carries no filter, unlike the outlines", () => {
    for (const layer of [countryHit, regionHit]) expect(layer.filter).toBeUndefined();
  });

  it("routes a label's level to a hit layer and an outline of the same level", () => {
    expect(HIT_LAYER_FOR.country).toBe(COUNTRY_HIT_ID);
    expect(HIT_LAYER_FOR.state).toBe(REGION_HIT_ID);
    expect(OUTLINE_LAYER_FOR.country).toBe(COUNTRY_OUTLINE_ID);
    expect(OUTLINE_LAYER_FOR.state).toBe(REGION_OUTLINE_ID);
  });

  it("has no hit or outline layer for city or continent", () => {
    expect(HIT_LAYER_FOR.city).toBeUndefined();
    expect(HIT_LAYER_FOR.continent).toBeUndefined();
    expect(OUTLINE_LAYER_FOR.city).toBeUndefined();
    expect(OUTLINE_LAYER_FOR.continent).toBeUndefined();
  });
});

describe("matchId", () => {
  it("is the inverse of MATCH_NOTHING over the same property", () => {
    expect(matchId("USCA")).toEqual(["==", ["get", "id"], "USCA"]);
    expect(MATCH_NOTHING).toEqual(["==", ["get", "id"], ""]);
  });
});

describe("outlineFor", () => {
  it("sends a country container to the countries layer", () => {
    expect(outlineFor({ kind: "CONTAINER", region: "SP", country: "SP" })).toEqual({
      layerId: COUNTRY_OUTLINE_ID,
      id: "SP",
    });
  });

  it("sends an admin-1 container to the regions layer", () => {
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
    expect(outlineFor({ kind: "PIN", region: "USCA", country: "US" })).toBeNull();
  });

  it("outlines nothing rather than guessing when the region is missing", () => {
    expect(outlineFor({ kind: "CONTAINER", region: "", country: "US" })).toBeNull();
    expect(outlineFor({})).toBeNull();
  });
});
