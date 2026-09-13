import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { LabelLevel } from "./labels";
import { SPIDERFY_ZOOM } from "./spiderfy";

// Must match worker/tiles.ts exactly.
export const STORIES_SOURCE_LAYER = "stories";
export const COUNTRY_SOURCE_LAYER = "country-top";

export const SOURCE_ID = "stories";
export const STORIES_LAYER_ID = "stories-pins";
export const TOP_LAYER_ID = "stories-top-pins";
export const COUNTRY_LAYER_ID = "country-top-pins";
export const LABELS_LAYER_ID = "stories-labels";

// Capped: the country floor overlaps the stories layer, so past this zoom a story would
// draw twice on top of itself.
export const COUNTRY_LAYER_MAXZOOM = 4;

const LABEL_MINZOOM = 4;

export const ACCENT = "#D24F39";
const WHITE = "#ffffff";

export const MARK = "#C05AC4";

const RING_RATIO = 0.32;

export const TOP_STATE_KEY = "top";
export const SELECTED_STATE_KEY = "selected";

// Stops follow the measured salience distribution (half of all stories sit at log1p(1));
// evenly spaced stops would draw 90% of the map at one size.
const radiusBySalience = (
  single: number,
  few: number,
  many: number,
  huge: number
): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["get", "salience"],
  0.6931,
  single,
  1.0986,
  few,
  2.3026,
  many,
  4.3567,
  huge,
];

// ["zoom"] may only feed a TOP-LEVEL interpolate/step. Otherwise MapLibre rejects the
// whole layer silently and the pins are simply absent.
const byZoom = (
  perZoom: (single: number, few: number, many: number, huge: number) => ExpressionSpecification
): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  1,
  perZoom(6, 7, 8.5, 10),
  8,
  perZoom(8, 10, 13, 16),
];

// Every layer that draws a story carries this, topPinLayer included, or the top-5 copy
// redraws a container.
export const NOT_CONTAINER: ExpressionSpecification = ["!=", ["get", "kind"], "CONTAINER"];

// Spider leaves live in their own GeoJSON source and feature state doesn't cross sources,
// so a leaf carries the flag as a property.
const isTop: ExpressionSpecification = [
  "any",
  ["boolean", ["feature-state", TOP_STATE_KEY], false],
  ["==", ["get", TOP_STATE_KEY], 1],
];

const isSelected: ExpressionSpecification = [
  "any",
  ["boolean", ["feature-state", SELECTED_STATE_KEY], false],
  ["==", ["get", SELECTED_STATE_KEY], 1],
];

// MapLibre grows a stroke outward, so a marked pin's core shrinks by the ring it gains.
const discRadius = (
  single: number,
  few: number,
  many: number,
  huge: number
): ExpressionSpecification => {
  const footprint = radiusBySalience(single, few, many, huge);
  return ["case", isTop, ["*", footprint, 1 - RING_RATIO], footprint];
};

const ringWidth = (
  single: number,
  few: number,
  many: number,
  huge: number
): ExpressionSpecification => [
  "case",
  isTop,
  ["*", radiusBySalience(single, few, many, huge), RING_RATIO],
  0,
];

export const LABEL_TEXT_SIZE = 11;

export const LABEL_GAP = 8;

const labelOffset = (
  single: number,
  few: number,
  many: number,
  huge: number
): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["get", "salience"],
  0.6931,
  ["literal", [0, (single + LABEL_GAP) / LABEL_TEXT_SIZE]],
  1.0986,
  ["literal", [0, (few + LABEL_GAP) / LABEL_TEXT_SIZE]],
  2.3026,
  ["literal", [0, (many + LABEL_GAP) / LABEL_TEXT_SIZE]],
  4.3567,
  ["literal", [0, (huge + LABEL_GAP) / LABEL_TEXT_SIZE]],
];

const circlePaint = {
  "circle-radius": byZoom(discRadius),
  "circle-color": ["case", isSelected, MARK, ACCENT] as ExpressionSpecification,
  "circle-stroke-width": byZoom(ringWidth),
  "circle-stroke-color": WHITE,
};

// Noto Sans is the only font both basemaps ship; naming Roboto first 404s glyphs on OpenFreeMap.
export const LABEL_FONT = ["Noto Sans Regular"];

// Order matters: country-top paints under stories, and headlines are inserted below the
// basemap's place labels (see firstPlaceLabelLayerId), not appended.
export function storyLayers(): [
  CircleLayerSpecification,
  CircleLayerSpecification,
  SymbolLayerSpecification,
] {
  return [
    {
      id: COUNTRY_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      "source-layer": COUNTRY_SOURCE_LAYER,
      maxzoom: COUNTRY_LAYER_MAXZOOM,
      filter: NOT_CONTAINER,
      paint: circlePaint,
    },
    {
      id: STORIES_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      "source-layer": STORIES_SOURCE_LAYER,
      filter: NOT_CONTAINER,
      paint: circlePaint,
    },
    {
      id: LABELS_LAYER_ID,
      type: "symbol",
      source: SOURCE_ID,
      "source-layer": STORIES_SOURCE_LAYER,
      minzoom: LABEL_MINZOOM,
      filter: NOT_CONTAINER,
      layout: {
        "text-field": ["get", "title"],
        "text-font": LABEL_FONT,
        "text-size": LABEL_TEXT_SIZE,
        "text-max-width": 9,
        "text-offset": byZoom(labelOffset),
        "text-anchor": "top",
        "text-allow-overlap": false,
        "symbol-sort-key": ["-", 0, ["get", "salience"]],
      },
      paint: {
        "text-color": "#f2f4f7",
        "text-halo-color": "rgba(13, 15, 18, 0.9)",
        "text-halo-width": 1.2,
      },
    },
  ];
}

export const SPIDER_SOURCE_ID = "spider";
const SPIDER_LEGS_ID = "spider-legs";
const SPIDER_LEAVES_ID = "spider-leaves";

export function spiderLayers(): [LineLayerSpecification, CircleLayerSpecification] {
  return [
    {
      id: SPIDER_LEGS_ID,
      type: "line",
      source: SPIDER_SOURCE_ID,
      minzoom: SPIDERFY_ZOOM,
      paint: {
        "line-color": WHITE,
        "line-width": 1,
        "line-opacity": 0.55,
      },
    },
    {
      id: SPIDER_LEAVES_ID,
      type: "circle",
      source: SPIDER_SOURCE_ID,
      minzoom: SPIDERFY_ZOOM,
      paint: circlePaint,
      // Reads the property: circle-sort-key is layout, and feature state resolves in paint only.
      layout: { "circle-sort-key": ["get", TOP_STATE_KEY] },
      filter: ["==", ["geometry-type"], "Point"],
    },
  ];
}

export function topFilter(urls: readonly string[]): FilterSpecification {
  return ["all", NOT_CONTAINER, ["in", ["get", "url"], ["literal", [...urls]]]];
}

export function bubbleLabelFilter(urls: readonly string[]): FilterSpecification {
  return ["all", NOT_CONTAINER, ["!", ["in", ["get", "url"], ["literal", [...urls]]]]];
}

// A layer, not a sort key: circle draw order is tile order, and sort key can't read
// feature state.
export function topPinLayer(): CircleLayerSpecification {
  return {
    id: TOP_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    "source-layer": STORIES_SOURCE_LAYER,
    filter: topFilter([]),
    paint: circlePaint,
  };
}

export const CLICKABLE_LAYER_IDS = [
  SPIDER_LEAVES_ID,
  TOP_LAYER_ID,
  STORIES_LAYER_ID,
  COUNTRY_LAYER_ID,
];

// Appended last, headlines win symbol collisions and delete the basemap's clickable place
// labels (measured up to two-thirds gone).
const PLACE_LABEL_SOURCE_LAYERS = [
  "country_label",
  "country_disputed_label",
  "state_label",
  "city_label",
  "continent_label",
  "place",
];

export function firstPlaceLabelLayerId(
  layers: readonly { id: string; "source-layer"?: string }[]
): string | undefined {
  return layers.find((layer) => PLACE_LABEL_SOURCE_LAYERS.includes(layer["source-layer"] ?? ""))
    ?.id;
}

export const BOUNDARIES_ARCHIVE = "/boundaries.pmtiles";
export const BOUNDARIES_SOURCE_ID = "boundaries";

// Must match scripts/build-boundaries.ts.
export const COUNTRIES_SOURCE_LAYER = "countries";
export const REGIONS_SOURCE_LAYER = "regions";

export const COUNTRY_OUTLINE_ID = "country-outline";
export const REGION_OUTLINE_ID = "region-outline";

// Swapped filter, not add/remove, which churns the style and flickers. Keep the sentinel
// an empty string: a literal NUL byte makes git treat this file as binary.
export const MATCH_NOTHING: ExpressionSpecification = ["==", ["get", "id"], ""];

export const matchId = (id: string): ExpressionSpecification => ["==", ["get", "id"], id];

const OUTLINE_COLOR = "#e5484d";

const outlineLayer = (id: string, sourceLayer: string): LineLayerSpecification => ({
  id,
  type: "line",
  source: BOUNDARIES_SOURCE_ID,
  "source-layer": sourceLayer,
  filter: MATCH_NOTHING,
  paint: {
    "line-color": OUTLINE_COLOR,
    "line-width": ["interpolate", ["linear"], ["zoom"], 0, 1.5, 6, 2.5],
    "line-opacity": 0.9,
  },
});

export function boundaryLayers(): [LineLayerSpecification, LineLayerSpecification] {
  return [
    outlineLayer(COUNTRY_OUTLINE_ID, COUNTRIES_SOURCE_LAYER),
    outlineLayer(REGION_OUTLINE_ID, REGIONS_SOURCE_LAYER),
  ];
}

export const COUNTRY_HIT_ID = "country-hit";
export const REGION_HIT_ID = "region-hit";

export const HIT_LAYER_FOR: Partial<Record<LabelLevel, string>> = {
  country: COUNTRY_HIT_ID,
  state: REGION_HIT_ID,
};

export const OUTLINE_LAYER_FOR: Partial<Record<LabelLevel, string>> = {
  country: COUNTRY_OUTLINE_ID,
  state: REGION_OUTLINE_ID,
};

// fill-opacity 0, not visibility none: hidden layers drop out of queryRenderedFeatures.
const hitLayer = (id: string, sourceLayer: string): FillLayerSpecification => ({
  id,
  type: "fill",
  source: BOUNDARIES_SOURCE_ID,
  "source-layer": sourceLayer,
  paint: { "fill-opacity": 0 },
});

export function hitLayers(): [FillLayerSpecification, FillLayerSpecification] {
  return [
    hitLayer(COUNTRY_HIT_ID, COUNTRIES_SOURCE_LAYER),
    hitLayer(REGION_HIT_ID, REGIONS_SOURCE_LAYER),
  ];
}

export const SELECTED_SOURCE_ID = "selected";
export const SELECTED_LAYER_ID = "selected-pin";
export const PIN_IMAGE_ID = "pin-triangle";

// Overlap and placement forced: collision detection must never drop the reader's selection.
export function selectedPinLayer(): SymbolLayerSpecification {
  return {
    id: SELECTED_LAYER_ID,
    type: "symbol",
    source: SELECTED_SOURCE_ID,
    layout: {
      "icon-image": PIN_IMAGE_ID,
      "icon-anchor": "bottom",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  };
}

export function outlineFor(properties: {
  kind?: unknown;
  region?: unknown;
  country?: unknown;
}): { layerId: string; id: string } | null {
  if (properties.kind !== "CONTAINER") return null;
  const region = typeof properties.region === "string" ? properties.region : "";
  const country = typeof properties.country === "string" ? properties.country : "";
  if (!region) return null;

  return region === country
    ? { layerId: COUNTRY_OUTLINE_ID, id: region }
    : { layerId: REGION_OUTLINE_ID, id: region };
}
