/**
 * How the two story layers are drawn. Separated from `MapView.tsx` because
 * these specs carry product rules, not decoration, and rules deserve
 * tests: a label may only ever contain the headline (link-out only, tested
 * in `layers.test.ts`); a CONTAINER is never drawn (it has no exact
 * location — `NOT_CONTAINER` filters it out of every layer, surfaced in
 * the region panel as words instead); tier-1 stays invisible (nothing here
 * may read the `tier1` property). See docs/DESIGN.md#frontend.
 */

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

/** Tippecanoe layer names. Must match `worker/tiles.ts`'s exports exactly. */
export const STORIES_SOURCE_LAYER = "stories";
export const COUNTRY_SOURCE_LAYER = "country-top";

export const SOURCE_ID = "stories";
export const STORIES_LAYER_ID = "stories-pins";
export const TOP_LAYER_ID = "stories-top-pins";
export const COUNTRY_LAYER_ID = "country-top-pins";
export const LABELS_LAYER_ID = "stories-labels";

// The country floor overlaps the stories layer — a group can be in both —
// so it's capped at the zoom where the budget starts admitting stories
// generally, or the same story draws twice on top of itself.
export const COUNTRY_LAYER_MAXZOOM = 4;

/** Headlines start here. Below it they would be unreadable mush at any density. */
export const LABEL_MINZOOM = 4;

/* -------------------------------------------------------------------------- */
/* The pin identity (2026-08-14)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Two visual states, and the ring is the only difference: an ordinary
 * story is a solid orange disc; one of the top 5 on screen is the same
 * disc with a white ring. Both share the same footprint (radius already
 * encodes salience via `radiusBySalience`; a ring is not a second size
 * signal) — collapsed in 2026-08-14 from three marks (pin/top-5/container)
 * to two. See docs/DESIGN.md#the-two-mark-pin-vocabulary.
 */
export const ACCENT = "#D24F39";
const WHITE = "#ffffff";

/**
 * The brand's purple — the far stop of the search sphere gradient, and the
 * selection triangle's color (imported into `lib/pin.ts` so there's one
 * definition). Deliberately NOT the accent color: the triangle is not a
 * story, it's the reader's own pointer at one. `app/globals.css` states it
 * a third time inside a gradient stop, which cannot import a variable.
 */
export const MARK = "#C05AC4";

// The white ring, as a share of footprint radius (not a fixed px width —
// the footprint spans 3-13px, so a constant ring would be half the area of
// a small circle and a hairline on a large one).
const RING_RATIO = 0.32;

// Feature-state flags MapView sets — not tile properties, since "on
// screen" (TOP_STATE_KEY) and "open" (SELECTED_STATE_KEY, at most one
// feature) are camera/gesture facts, and re-filtering a layer on every
// move/click would restyle the whole map to change a handful of circles.
export const TOP_STATE_KEY = "top";
export const SELECTED_STATE_KEY = "selected";

/**
 * Radius by salience. Stops are where the measured salience distribution
 * actually varies (p25 0.693 = p50, p75 1.040, p90 1.099, p99 2.303, max
 * 4.357 — half of all stories sit exactly at log1p(1)), not evenly spaced
 * — evenly-spaced stops would render 90% of the map at one indistinguishable
 * size. See docs/DESIGN.md#ranking.
 */
const radiusBySalience = (
  single: number,
  few: number,
  many: number,
  huge: number,
): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["get", "salience"],
  0.6931, // one domain — the median story
  single,
  1.0986, // ~two domains
  few,
  2.3026, // p99
  many,
  4.3567, // the run's maximum
  huge,
];

// Zoom scaling wraps the salience scale so both read at once. ["zoom"] may
// ONLY be the input of a TOP-LEVEL interpolate/step — MapLibre rejects the
// whole layer otherwise (fails silently at addLayer, pins simply absent),
// which is why the state logic is pushed down into this function rather
// than multiplied over its result.
const byZoom = (
  perZoom: (single: number, few: number, many: number, huge: number) => ExpressionSpecification,
): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  1,
  perZoom(3, 4, 5.5, 7),
  8,
  perZoom(5, 7, 10, 13),
];

// Containers are not drawn on the map — every layer that draws a story
// carries this, including topPinLayer, or the top-5 copy would resurrect
// a container the moment one ranked. Typed as ExpressionSpecification, not
// FilterSpecification: the latter still admits legacy array-filter syntax,
// which TypeScript can't then prove safe nested inside ["all", ...].
export const NOT_CONTAINER: ExpressionSpecification = ["!=", ["get", "kind"], "CONTAINER"];

// Set by MapView on every camera move; absent means "not top 5". The
// property arm is for spider leaves — they live in their own GeoJSON
// source, and feature state does not cross sources, so a leaf carries its
// flag as data instead (vector-tile features have no `top` property).
const isTop: ExpressionSpecification = [
  "any",
  ["boolean", ["feature-state", TOP_STATE_KEY], false],
  ["==", ["get", TOP_STATE_KEY], 1],
];

// The open story, read the same two ways for the same reason.
const isSelected: ExpressionSpecification = [
  "any",
  ["boolean", ["feature-state", SELECTED_STATE_KEY], false],
  ["==", ["get", SELECTED_STATE_KEY], 1],
];

// Both states share ONE footprint: MapLibre grows a stroke OUTWARD from
// the radius, so a marked pin's core is shrunk by exactly the ring it's
// about to gain — (1 - RING_RATIO) + RING_RATIO — landing the outer edges
// on each other.
/** The disc: inset by its ring when marked, the full footprint otherwise. */
const discRadius = (
  single: number,
  few: number,
  many: number,
  huge: number,
): ExpressionSpecification => {
  const footprint = radiusBySalience(single, few, many, huge);
  return ["case", isTop, ["*", footprint, 1 - RING_RATIO], footprint];
};

/** The ring, which only the top 5 on screen have. */
const ringWidth = (
  single: number,
  few: number,
  many: number,
  huge: number,
): ExpressionSpecification => [
  "case",
  isTop,
  ["*", radiusBySalience(single, few, many, huge), RING_RATIO],
  0,
];

const circlePaint = {
  "circle-radius": byZoom(discRadius),
  // Only the open story's disc ever differs (fills MARK instead of ACCENT)
  // — the one property of a pin the reader set by clicking. Lives in this
  // shared circlePaint, not a layer of its own, so it applies everywhere a
  // story is drawn (stories, country floor, top-5 copy, spider leaves).
  "circle-color": ["case", isSelected, MARK, ACCENT] as ExpressionSpecification,
  "circle-stroke-width": byZoom(ringWidth),
  "circle-stroke-color": WHITE,
};

/**
 * Both basemaps must be able to draw the font. MapTiler's streets style ships
 * `["Roboto Regular", "Noto Sans Regular"]` and OpenFreeMap ships only
 * `Noto Sans Regular` — so Noto is the intersection, and naming Roboto first
 * would 404 the glyph range on the keyless fallback.
 */
export const LABEL_FONT = ["Noto Sans Regular"];

/**
 * The layers, in the order they must be added: country-top paints UNDER
 * stories, and the headline layer is NOT appended to the style — it's
 * inserted below the basemap's own place labels so those clickable names
 * win symbol collisions. See `firstPlaceLabelLayerId` and
 * docs/DESIGN.md#layer-stack-and-z-order.
 */
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
      // Thins out visibly below z4 since many country-floor stories are
      // containers — the accepted cost of not drawing a story where it
      // didn't happen.
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
      // A headline with no pin under it would point at nothing.
      filter: NOT_CONTAINER,
      layout: {
        // The headline, and nothing else — never article text.
        "text-field": ["get", "title"],
        "text-font": LABEL_FONT,
        "text-size": 11,
        "text-max-width": 9,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        // Overlap off keeps the map readable; the sort key decides which
        // label survives a collision (negated: MapLibre places lower sort
        // keys first, and higher salience should win).
        "text-allow-overlap": false,
        "symbol-sort-key": ["-", 0, ["get", "salience"]],
      },
      paint: {
        "text-color": "#f2f4f7",
        // The basemap is dark but not uniformly so; a halo is what stops a
        // headline from dissolving over a coastline or a park.
        "text-halo-color": "rgba(13, 15, 18, 0.9)",
        "text-halo-width": 1.2,
      },
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Spiderfy: the overlay that unstacks co-located stories                      */
/* -------------------------------------------------------------------------- */

export const SPIDER_SOURCE_ID = "spider";
export const SPIDER_LEGS_ID = "spider-legs";
export const SPIDER_LEAVES_ID = "spider-leaves";

// The leg, drawn in white at low opacity: it's a pointer, not a datum, and
// must never compete with the leaf on the end of it or read as a route.
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
        // Enough to follow a leg back to its city, not enough to read as a
        // border or route.
        "line-opacity": 0.55,
      },
    },
    {
      id: SPIDER_LEAVES_ID,
      type: "circle",
      source: SPIDER_SOURCE_ID,
      minzoom: SPIDERFY_ZOOM,
      // A leaf is the same story as the pin it came off, so it gets the
      // same paint, ring included.
      paint: circlePaint,
      // Leaves can touch (~34px out, up to 13px across); a marked leaf must
      // draw on top. Reads the PROPERTY, since circle-sort-key is layout
      // and MapLibre resolves feature state in paint only — the same
      // constraint that forces topPinLayer to exist as a separate layer.
      layout: { "circle-sort-key": ["get", TOP_STATE_KEY] },
      filter: ["==", ["geometry-type"], "Point"],
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* The top-5 layer: the highlight, drawn above everything else                 */
/* -------------------------------------------------------------------------- */

// A filter matching exactly the given story URLs — the whole interface of
// the top-5 layer. ANDed with NOT_CONTAINER, since this layer reads the
// same source and would otherwise redraw a filtered-out container.
export function topFilter(urls: readonly string[]): FilterSpecification {
  return ["all", NOT_CONTAINER, ["in", ["get", "url"], ["literal", [...urls]]]];
}

/**
 * The headline layer, minus stories wearing a speech bubble — without
 * this a bubbled story would say its own sentence twice (once in the
 * bubble, once in the 11px label underneath). Keyed on the captured
 * bubble list, not on which bubbles were actually placed by
 * `lib/bubble.ts` — a bubble dropped for want of room still suppresses
 * its label, accepted rather than plumbing the placement result back
 * into the style (which would trigger another render/repaint cycle).
 * `MapView` calls this with `[]` on the reader's first camera move.
 */
export function bubbleLabelFilter(urls: readonly string[]): FilterSpecification {
  return ["all", NOT_CONTAINER, ["!", ["in", ["get", "url"], ["literal", [...urls]]]]];
}

/**
 * The five best stories on screen, drawn a SECOND time above every other
 * pin, leg and leaf. A layer, not a sort key: draw order inside a circle
 * layer is tile order, so a marked pin is behind its neighbours as often
 * as in front — and `circle-sort-key` can't fix it, since sort key is
 * layout and the highlight is feature state, resolved in paint only. Costs
 * one extra draw of at most five circles; the duplicate lands exactly on
 * the original since it shares `circlePaint`. Reads the vector source's
 * `stories` layer only — below `COUNTRY_LAYER_MAXZOOM` a marked story may
 * come from the sparse country floor instead, where nothing overlaps.
 */
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

// The layers a click should hit-test, top-most first. Labels are not
// clickable. Leaves come first (the more specific target when overlapping
// an anchor); the top-5 layer is second, since it's the disc drawn on top.
export const CLICKABLE_LAYER_IDS = [
  SPIDER_LEAVES_ID,
  TOP_LAYER_ID,
  STORIES_LAYER_ID,
  COUNTRY_LAYER_ID,
];

/**
 * Where the headline layer must be inserted: below the basemap's own place
 * labels. MapLibre resolves symbol collisions top-down, so a headline
 * layer simply appended last outranks and deletes the basemap's own
 * country/state labels — measured as up to two-thirds of clickable
 * targets gone, worst where news is densest. Only the headline layer
 * moves; the two circle layers stay on top since circles don't
 * participate in symbol collision. See docs/DESIGN.md#regions.
 */
const PLACE_LABEL_SOURCE_LAYERS = [
  "country_label",
  "country_disputed_label",
  "state_label",
  "city_label",
  "continent_label",
  "place",
];

// The id of the basemap's first place-label layer, or undefined to append
// (the honest answer for an unrecognized style — addLayer(layer,
// undefined) appends, so headlines still draw, just without the priority).
export function firstPlaceLabelLayerId(
  layers: readonly { id: string; "source-layer"?: string }[],
): string | undefined {
  return layers.find((layer) =>
    PLACE_LABEL_SOURCE_LAYERS.includes(layer["source-layer"] ?? ""),
  )?.id;
}

/* -------------------------------------------------------------------------- */
/* Red click-outline                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Static, committed, served from the deploy — not from Blob. Built once by
 * `npm run boundaries`; see that script's header for the FIPS join, which is the
 * only hard part of this feature.
 */
export const BOUNDARIES_ARCHIVE = "/boundaries.pmtiles";
export const BOUNDARIES_SOURCE_ID = "boundaries";

/** Layer names inside the archive. Must match `scripts/build-boundaries.ts`. */
export const COUNTRIES_SOURCE_LAYER = "countries";
export const REGIONS_SOURCE_LAYER = "regions";

export const COUNTRY_OUTLINE_ID = "country-outline";
export const REGION_OUTLINE_ID = "region-outline";

/**
 * A filter matching nothing — both outline layers stay added at map load
 * and are filtered down by swapping this, since adding/removing layers on
 * every click would churn the style and flicker. Sentinel is the empty
 * string (no boundary feature can carry one); NEVER use a literal NUL
 * byte here — it worked but made git classify this file as binary with no
 * diff shown, once.
 */
export const MATCH_NOTHING: ExpressionSpecification = ["==", ["get", "id"], ""];

/** The other half of the swap: show exactly one region. */
export const matchId = (id: string): ExpressionSpecification => ["==", ["get", "id"], id];

const OUTLINE_COLOR = "#e5484d";

// Line, never fill — a filled country would read as a data layer, as if
// the whole country were the subject, when it only means "somewhere in here."

const outlineLayer = (id: string, sourceLayer: string): LineLayerSpecification => ({
  id,
  type: "line",
  source: BOUNDARIES_SOURCE_ID,
  "source-layer": sourceLayer,
  filter: MATCH_NOTHING,
  paint: {
    "line-color": OUTLINE_COLOR,
    // Thin enough at world zoom that a small country is not swallowed by its own
    // border, heavy enough to read when zoomed in.
    "line-width": ["interpolate", ["linear"], ["zoom"], 0, 1.5, 6, 2.5],
    "line-opacity": 0.9,
  },
});

// The outline layers, added BEFORE the story layers, so an outline never draws over the pins it belongs to.
export function boundaryLayers(): [LineLayerSpecification, LineLayerSpecification] {
  return [
    outlineLayer(COUNTRY_OUTLINE_ID, COUNTRIES_SOURCE_LAYER),
    outlineLayer(REGION_OUTLINE_ID, REGIONS_SOURCE_LAYER),
  ];
}

/* -------------------------------------------------------------------------- */
/* The label gesture: invisible hit targets                                    */
/* -------------------------------------------------------------------------- */

export const COUNTRY_HIT_ID = "country-hit";
export const REGION_HIT_ID = "region-hit";

/**
 * Which hit layer answers a label of each level. Level comes from the
 * label, id comes from the polygon under it — no name matching anywhere.
 * Partial, not total: `city` and `continent` have no entry, since a city
 * resolves through a published shard (lib/cities.ts) and a continent
 * through a closed name table (lib/continents.ts), neither a polygon hit.
 */
export const HIT_LAYER_FOR: Partial<Record<LabelLevel, string>> = {
  country: COUNTRY_HIT_ID,
  state: REGION_HIT_ID,
};

// Which outline layer to draw for a level, once the hit gave an id. No
// `city` entry (a city is a point; a region outline around it would claim
// the opposite). No `continent` entry either (its outline would be ~50
// country outlines filled red — see MapView.tsx's selectRegionAt).
export const OUTLINE_LAYER_FOR: Partial<Record<LabelLevel, string>> = {
  country: COUNTRY_OUTLINE_ID,
  state: REGION_OUTLINE_ID,
};

/**
 * An unpainted fill over the boundary polygons, purely so a clicked label
 * can be turned into a region id by `queryRenderedFeatures` — a `line`
 * layer can't do this, since hit-testing a line needs landing within a
 * few pixels of a border while the label sits at the centroid.
 * `fill-opacity: 0` (not `visibility: none`, which would remove it from
 * queries) is the whole amendment to "the polygon is never a fill"; if it
 * ever acquires a visible color, `layers.test.ts` catches it.
 */
const hitLayer = (id: string, sourceLayer: string): FillLayerSpecification => ({
  id,
  type: "fill",
  source: BOUNDARIES_SOURCE_ID,
  "source-layer": sourceLayer,
  paint: { "fill-opacity": 0 },
});

// The hit layers, added BEFORE the outlines and stories. They paint
// nothing, so this order just keeps a future paint-order mistake at the
// bottom rather than over the pins.
export function hitLayers(): [FillLayerSpecification, FillLayerSpecification] {
  return [
    hitLayer(COUNTRY_HIT_ID, COUNTRIES_SOURCE_LAYER),
    hitLayer(REGION_HIT_ID, REGIONS_SOURCE_LAYER),
  ];
}

/* -------------------------------------------------------------------------- */
/* The selection pin: the triangle dropped on whatever was clicked             */
/* -------------------------------------------------------------------------- */

export const SELECTED_SOURCE_ID = "selected";
export const SELECTED_LAYER_ID = "selected-pin";
export const PIN_IMAGE_ID = "pin-triangle";

/**
 * The triangle that marks the current selection, drawn above every disc.
 * `icon-anchor: "bottom"` puts the image's bottom-center — where
 * `trianglePin` rasterises the point, see `PIN_LEFT_PAD` — on the
 * feature's coordinate, so the tip lands on the story's own circle rather
 * than floating "near" it. Overlap and placement are both forced: this is
 * the one thing the reader explicitly asked for, and letting collision
 * detection drop it would make the click look like it failed;
 * `icon-ignore-placement` also stops the triangle from erasing labels
 * around it as a collision obstacle.
 */
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

/**
 * Which outline layer a container belongs to, and what to filter it by. A
 * container is a country when its region code IS its country code (`SP`),
 * an admin-1 region otherwise (`USCA`). Anything not a container gets no
 * outline — a PIN is exact, and drawing a country around it would claim
 * otherwise. Nothing on the map reaches this today (containers are
 * filtered out of every pin layer), but the region panel's "somewhere in"
 * stories will need this exact join to draw their outline.
 */
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
