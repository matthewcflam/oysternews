import { describe, expect, it } from "vitest";
import {
  ACCENT,
  CLICKABLE_LAYER_IDS,
  COUNTRIES_SOURCE_LAYER,
  COUNTRY_HIT_ID,
  COUNTRY_LAYER_ID,
  COUNTRY_LAYER_MAXZOOM,
  COUNTRY_OUTLINE_ID,
  COUNTRY_SOURCE_LAYER,
  HIT_LAYER_FOR,
  LABELS_LAYER_ID,
  LABEL_FONT,
  MARK,
  MATCH_NOTHING,
  NOT_CONTAINER,
  OUTLINE_LAYER_FOR,
  PIN_IMAGE_ID,
  REGIONS_SOURCE_LAYER,
  REGION_HIT_ID,
  REGION_OUTLINE_ID,
  SELECTED_LAYER_ID,
  SELECTED_SOURCE_ID,
  SELECTED_STATE_KEY,
  STORIES_LAYER_ID,
  STORIES_SOURCE_LAYER,
  TOP_LAYER_ID,
  TOP_STATE_KEY,
  boundaryLayers,
  firstPlaceLabelLayerId,
  hitLayers,
  matchId,
  outlineFor,
  selectedPinLayer,
  spiderLayers,
  storyLayers,
  topFilter,
  topPinLayer,
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
  it("puts country-top under stories, with the headlines last", () => {
    // Order is the whole mechanism for resolving the overlap between the two
    // circle layers. A reordering would silently reintroduce the low-zoom
    // double draw. The headline layer is last here but is NOT appended to the
    // style — MapView inserts it below the basemap's place labels, so §2.3's
    // clickable country and state names win the symbol collision.
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

  it("draws every unselected story in one orange, and the open one in MARK", () => {
    // The 2026-08-14 collapse took a `case` over `kind` out of here — a
    // container used to be painted white — and the fill became a bare literal.
    // The one case that came back (2026-08-15) is the selection: the wedge points
    // down at this disc, and the two have to read as one mark.
    //
    // **The condition is the whole of what may be asserted here.** A branch on
    // `kind`, `salience` or `tier1` would be a second visual identity, which is
    // what the collapse removed.
    for (const layer of [stories, country]) {
      const fill = layer.paint?.["circle-color"] as unknown[];
      expect(fill[0]).toBe("case");
      expect(fill).toHaveLength(4);
      expect(fill[2]).toBe(MARK);
      expect(fill[3]).toBe(ACCENT);
      expect(propertiesRead(fill)).toEqual([SELECTED_STATE_KEY]);
      expect(layer.paint?.["circle-stroke-color"]).toBe("#ffffff");
    }
  });

  it("reads the selection both ways, so a spider leaf can wear it too", () => {
    // Feature state does not cross sources and a leaf lives in the overlay's
    // own GeoJSON source, so the flag travels as a property there — the same
    // split the top-5 ring makes. Losing either arm loses the fill in exactly
    // one place: the vector arm at every ordinary pin, the property arm at every
    // displaced story, which is the case the map is busiest in.
    const json = JSON.stringify(stories.paint?.["circle-color"]);
    expect(json).toContain(`["boolean",["feature-state","${SELECTED_STATE_KEY}"],false]`);
    expect(json).toContain(`["==",["get","${SELECTED_STATE_KEY}"],1]`);
  });

  it("gives the ring to the top 5 and to nothing else", () => {
    // The ring changed sides on 2026-08-14: it used to mean "an exact place"
    // and marked every PIN. It now means "one of the five best on screen", so
    // the stroke width must be gated on the top-5 test and zero by default.
    for (const layer of [stories, country]) {
      const width = layer.paint?.["circle-stroke-width"] as unknown[];
      // ["interpolate", ["linear"], ["zoom"], 1, <case>, 8, <case>]
      for (const branch of [width[4], width[6]] as unknown[][]) {
        expect(branch[0]).toBe("case");
        expect(JSON.stringify(branch[1])).toContain("feature-state");
        // The fallback — an ordinary pin — has no ring at all.
        expect(branch[3]).toBe(0);
      }
      // Nothing about the ring may depend on how the story was placed.
      expect(propertiesRead(width)).not.toContain("kind");
    }
  });

  it("keeps one footprint, so the ring never makes a pin bigger", () => {
    // MapLibre grows a stroke OUTWARD, so a marked disc is inset by exactly the
    // ring it gains and the two outer edges land on each other. If the top-5
    // branch stopped shrinking the core, the five marked pins would swell.
    for (const layer of [stories, country]) {
      const radius = layer.paint?.["circle-radius"] as unknown[];
      for (const branch of [radius[4], radius[6]] as unknown[][]) {
        expect(branch[0]).toBe("case");
        // ["*", <footprint>, 0.68] for the marked case, bare <footprint> after.
        expect((branch[2] as unknown[])[0]).toBe("*");
        expect((branch[2] as unknown[])[2]).toBeCloseTo(0.68);
        expect(JSON.stringify(branch[3])).toBe(JSON.stringify((branch[2] as unknown[])[1]));
      }
    }
  });

  it("keeps ['zoom'] at the top level of every paint property", () => {
    // **Measured 2026-08-14.** MapLibre allows `["zoom"]` only as the input of a
    // top-level `interpolate` or `step`. Nesting it — `["*", <zoom interp>, k]`
    // inside a `case` — makes `addLayer` throw, and the failure looks like a map
    // with no pins on it and no error anywhere near the styling code.
    const topLevelZoom = (paint: Record<string, unknown>) => {
      for (const value of Object.values(paint)) {
        if (!Array.isArray(value)) continue;
        const isZoomInterpolation =
          (value[0] === "interpolate" || value[0] === "step") &&
          JSON.stringify(value[2]) === '["zoom"]';
        // Anything below the top-level input must not mention zoom at all.
        const rest = isZoomInterpolation ? value.slice(3) : value;
        expect(JSON.stringify(rest)).not.toContain('["zoom"]');
      }
    };
    for (const layer of [stories, country]) topLevelZoom(layer.paint as Record<string, unknown>);
  });

  it("puts the top-5 highlight on feature state, never on a property", () => {
    // "On screen" is a fact about the camera, so no tile can carry it. It also
    // must default to false: a tile that has just loaded has no state yet, and
    // an undefined flag rendering as top-5 would flash the whole viewport.
    // `circle-color` is not on this list: since 2026-08-14 the ring carries the
    // whole top-5 highlight, and the fill's one case is about the selection.
    for (const key of ["circle-radius", "circle-stroke-width"] as const) {
      const json = JSON.stringify(stories.paint?.[key]);
      expect(json).toContain(`["feature-state","${TOP_STATE_KEY}"]`);
      expect(json).toContain(`["boolean",["feature-state","${TOP_STATE_KEY}"],false]`);
    }
  });

  it("draws every state solid — no partial-alpha fills", () => {
    // An early identity made a container 22% opaque, which reads as "less
    // important" rather than "less precisely placed", and disappears entirely
    // at the 3px end of the salience scale.
    for (const layer of [stories, country]) {
      expect(JSON.stringify(layer.paint?.["circle-color"])).not.toContain("rgba");
      expect(layer.paint?.["circle-opacity"]).toBeUndefined();
    }
  });

  it("filters containers off every layer that draws a story", () => {
    // §2.1 places a container at a region's centroid, which puts a point on a
    // coastline and asserts a story happened there. Since 2026-08-14 they are
    // not drawn at all — the region panel says "somewhere in" in words instead.
    for (const layer of [stories, country, labels]) {
      expect(layer.filter).toEqual(NOT_CONTAINER);
    }
    expect(NOT_CONTAINER).toEqual(["!=", ["get", "kind"], "CONTAINER"]);
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

describe("the top-5 layer and the leaves' sort key", () => {
  const top = topPinLayer();
  const [, leaves] = spiderLayers();

  it("paints the top-5 copy exactly like the pin underneath it", () => {
    // The copy lands on the original, so any divergence between the two paints
    // shows up as a halo of the wrong colour around every marked story.
    expect(top.paint).toEqual(stories.paint);
    expect(top["source-layer"]).toBe(STORIES_SOURCE_LAYER);
    expect(top.maxzoom).toBeUndefined();
  });

  it("starts matching nothing, so no story is doubled before the first rank", () => {
    expect(top.filter).toEqual(topFilter([]));
    // A doubled draw of an UNMARKED story would be invisible but wrong: it would
    // put an arbitrary pin above every other pin on the map.
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
    // This layer reads the same source as `stories-pins` and is drawn ABOVE it,
    // so without the same container filter a ranked container would appear here
    // and nowhere else — one white-ringed dot on a map that draws no containers.
    expect(JSON.stringify(topFilter(["a"]))).toContain(JSON.stringify(NOT_CONTAINER));
  });

  it("orders the leaves by the top flag, which must be a PROPERTY", () => {
    // `circle-sort-key` is layout, and MapLibre resolves feature state in paint
    // only — a `["feature-state"]` here is silently ignored, or rejects the
    // layer. The leaves carry the flag as data precisely so this can work.
    expect(leaves.layout?.["circle-sort-key"]).toEqual(["get", TOP_STATE_KEY]);
    expect(JSON.stringify(leaves.layout)).not.toContain("feature-state");
  });

  it("keeps the clickable layers in drawn order, top-most first", () => {
    // Whatever is drawn on top is what a reader thinks they are clicking.
    expect(CLICKABLE_LAYER_IDS.indexOf(TOP_LAYER_ID)).toBeLessThan(
      CLICKABLE_LAYER_IDS.indexOf(STORIES_LAYER_ID),
    );
    expect(CLICKABLE_LAYER_IDS).not.toContain(LABELS_LAYER_ID);
  });
});

describe("selectedPinLayer", () => {
  const pin = selectedPinLayer();

  it("anchors the triangle's point on the coordinate", () => {
    // `lib/pin.ts` pads the wedge so its point lands at the middle of the
    // image's bottom edge, so this is the one anchor that puts the point on the
    // story's own circle. Any other value floats the mark near the story rather
    // than on it.
    expect(pin.layout?.["icon-anchor"]).toBe("bottom");
    expect(pin.layout?.["icon-image"]).toBe(PIN_IMAGE_ID);
    expect(pin.source).toBe(SELECTED_SOURCE_ID);
    expect(pin.id).toBe(SELECTED_LAYER_ID);
  });

  it("never yields to a symbol collision, and never causes one", () => {
    // It marks the one thing the reader explicitly asked for: dropping it
    // because a headline claimed the space would make the click look like it
    // failed. `ignore-placement` is the other half — without it the triangle
    // acts as an obstacle and erases the labels around it.
    expect(pin.layout?.["icon-allow-overlap"]).toBe(true);
    expect(pin.layout?.["icon-ignore-placement"]).toBe(true);
  });
});

describe("firstPlaceLabelLayerId", () => {
  // The two live styles, 2026-08-13. MapTiler splits its label layers by
  // source-layer; OpenFreeMap puts everything in `place`.
  const maptiler = [
    { id: "Water", "source-layer": "water" },
    { id: "State labels z2", "source-layer": "state_label" },
    { id: "Country labels", "source-layer": "country_label" },
  ];
  const openfreemap = [
    { id: "water", "source-layer": "water" },
    { id: "label_country_1", "source-layer": "place" },
    { id: "label_state", "source-layer": "place" },
  ];

  it("finds the FIRST place-label layer on either provider", () => {
    // First, not last: inserting before the topmost place-label layer is what
    // puts our headlines under all of them.
    expect(firstPlaceLabelLayerId(maptiler)).toBe("State labels z2");
    expect(firstPlaceLabelLayerId(openfreemap)).toBe("label_country_1");
  });

  it("returns undefined for a style it does not recognise", () => {
    // addLayer(layer, undefined) appends — the headlines still draw, and only
    // the collision priority reverts. A throw here would blank the map.
    expect(firstPlaceLabelLayerId([{ id: "background" }])).toBeUndefined();
    expect(firstPlaceLabelLayerId([])).toBeUndefined();
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
