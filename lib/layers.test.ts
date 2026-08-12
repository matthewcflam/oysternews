import { describe, expect, it } from "vitest";
import {
  COUNTRY_LAYER_ID,
  COUNTRY_LAYER_MAXZOOM,
  COUNTRY_SOURCE_LAYER,
  LABELS_LAYER_ID,
  LABEL_FONT,
  STORIES_LAYER_ID,
  STORIES_SOURCE_LAYER,
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
