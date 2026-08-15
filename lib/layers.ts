/**
 * How the two story layers are drawn (HANDOFF.md §4, Phase 4).
 *
 * Separated from `MapView.tsx` because these specs carry product rules, not
 * decoration, and rules deserve tests. Three of them in particular:
 *
 * 1. **A label may only ever contain the headline** (§2.6, link-out only). The
 *    text field is the one place article prose could reach a rendered surface, so
 *    it is asserted in `layers.test.ts` rather than left to review.
 * 2. **A container is not a pin.** §2.1 places a container at a region's centre
 *    because the story has no exact location; drawing it identically to a
 *    precisely-placed pin would claim a precision the pipeline measured itself
 *    NOT to have (69.7% pins, §5.2). Since 2026-08-14 the white *ring* is the
 *    pin's mark and a container is a plain white disc — see the identity block
 *    below, including the one case where top-5 is allowed to override this.
 * 3. **Tier-1 is invisible.** §2.3: "no tier-1 toggle and no tier-1 badge; the
 *    preference is invisible except in *which* stories are on screen." Nothing
 *    here may read the `tier1` property, and a test holds that line.
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

/**
 * The country floor overlaps the stories layer — a group can be in both — so it
 * is capped, or the same story draws twice on top of itself at low zoom. 4 is
 * where the budget starts admitting stories generally (measured: 15 features at
 * minzoom 0 against 184 at minzoom 4), so below it the floor is doing real work
 * and above it the stories layer has taken over.
 */
export const COUNTRY_LAYER_MAXZOOM = 4;

/** Headlines start here. Below it they would be unreadable mush at any density. */
export const LABEL_MINZOOM = 4;

/* -------------------------------------------------------------------------- */
/* The pin identity (2026-08-14)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Three states, and every one of them is a **solid disc of a fixed footprint**:
 *
 * | State       | Reads as                                   | Drawn as            |
 * | ----------- | ------------------------------------------ | ------------------- |
 * | Top 5       | one of the five best stories on screen now | solid orange, large |
 * | Pin         | an exact place                             | orange in a white ring |
 * | Approximate | somewhere in this region (a CONTAINER)     | solid white         |
 *
 * The previous identity distinguished a container by making it *fainter* — a 22%
 * fill and a pale stroke. That reads as "less important", which is the wrong
 * claim: a container is a story whose LOCATION is coarse, not a story that
 * matters less. Solid white against solid orange says "different kind", not
 * "lesser", and it says it at 3px where an alpha difference does not survive.
 *
 * **Top 5 overrides the pin/container distinction, and that is a deliberate
 * amendment to §2.1 made 2026-08-14.** A top-5 container therefore draws exactly
 * like a top-5 pin, which does claim an exactness the placement rule did not
 * measure. The trade was accepted knowingly: the top-5 treatment answers "what
 * should I read", the ring answers "where exactly", and when they collide the
 * first question is the one a reader is actually asking. It is capped at five
 * features on screen, so the claim is small and bounded — but `layers.test.ts`
 * no longer holds that line, and this comment is the only place it is recorded.
 */
const ACCENT = "#D24F39";
const WHITE = "#ffffff";

/**
 * The white ring, as a share of the footprint radius — measured off the identity
 * sheet, where the orange core is ~0.68 of the white disc around it.
 *
 * It is a RATIO and not the old fixed 1.5px because the footprint spans 3px to
 * 13px: a constant ring is half the area of a small circle and a hairline on a
 * large one, so "pin" would have meant two different marks at the two ends of
 * the salience scale.
 */
const RING_RATIO = 0.32;

/** A top-5 disc is drawn slightly proud of the others, per the identity sheet. */
const TOP_SCALE = 1.15;

/**
 * The feature-state flag `MapView` sets on the five best stories in the viewport.
 * Feature state, not a property: "on screen" is a camera fact, so it cannot be
 * baked into a tile, and re-filtering a layer on every move would restyle the
 * whole map to change five circles.
 */
export const TOP_STATE_KEY = "top";

/**
 * Radius by salience, at a given zoom.
 *
 * **The stops are where the measured data actually varies, not evenly spaced.**
 * On the 2026-08-12 run, salience is `log1p(domains) + 0.5*log1p(countries)`
 * (§2.5) and lands at p25 0.693, p50 0.693, p75 1.040, p90 1.099, p99 2.303,
 * max 4.357 — half of all stories sit exactly at log1p(1), a single domain.
 * Evenly-spaced stops across [0.69, 4.36] would render 90% of the map at one
 * indistinguishable size and reserve every visible difference for a handful of
 * outliers. These stops spend the range where the mass is.
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

/**
 * Zoom scaling wraps the salience scale so both read at once.
 *
 * **`["zoom"]` may only be the input of a TOP-LEVEL `interpolate` or `step`**,
 * which is why the state logic below is pushed down into this function rather
 * than multiplied over its result. MapLibre rejects the whole layer otherwise —
 * measured 2026-08-14, and it fails at `addLayer` with the pins simply absent
 * from the style, so nothing about it is visible on the map except no pins.
 */
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

/**
 * A container is drawn white: the story is somewhere in this region, not at this
 * point. See the header — this is a truth claim, not a palette choice.
 */
const isContainer: ExpressionSpecification = ["==", ["get", "kind"], "CONTAINER"];

/**
 * Set by `MapView` on every camera move. Absent (on a tile that has just loaded,
 * or before the first move) must mean "not top 5", hence the default.
 *
 * The property arm is for the spider leaves: they live in a GeoJSON source of
 * their own, and feature state does not cross sources, so a leaf carries its
 * flag as data instead. A vector-tile feature has no `top` property at all, so
 * that arm is simply false for the two pin layers.
 */
const isTop: ExpressionSpecification = [
  "any",
  ["boolean", ["feature-state", TOP_STATE_KEY], false],
  ["==", ["get", TOP_STATE_KEY], 1],
];

/**
 * All three states share ONE footprint, so a pin and an approximate of equal
 * salience occupy the same space on the map and only their filling differs.
 * MapLibre grows a stroke outward from the radius, so the pin's orange core is
 * shrunk by exactly the ring it is about to gain — `(1 - RING_RATIO) + RING_RATIO`.
 */
/** The disc: top-5 proud of the footprint, a pin inset by the ring it gains. */
const discRadius = (
  single: number,
  few: number,
  many: number,
  huge: number,
): ExpressionSpecification => {
  const footprint = radiusBySalience(single, few, many, huge);
  return [
    "case",
    isTop,
    ["*", footprint, TOP_SCALE],
    isContainer,
    footprint,
    ["*", footprint, 1 - RING_RATIO],
  ];
};

/**
 * The ring, which only a pin has. A top-5 story is solid by design — including
 * a top-5 container, which is the amendment recorded in the identity block.
 */
const ringWidth = (
  single: number,
  few: number,
  many: number,
  huge: number,
): ExpressionSpecification => [
  "case",
  ["any", isTop, isContainer],
  0,
  ["*", radiusBySalience(single, few, many, huge), RING_RATIO],
];

const circlePaint = {
  "circle-radius": byZoom(discRadius),
  // isTop is tested FIRST: a top-5 container goes orange with the rest of them.
  "circle-color": ["case", isTop, ACCENT, isContainer, WHITE, ACCENT] as ExpressionSpecification,
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
 * The layers, in the order they must be added. Order is load-bearing twice:
 * country-top paints UNDER stories so the overlap resolves to the stories
 * styling, and the headline layer comes last — but it is **not appended to the
 * style**. It is inserted below the basemap's place labels, so that §2.3's
 * clickable country and state names win symbol collisions against our
 * headlines. See `firstPlaceLabelLayerId` for the measurement that forced it.
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
      paint: circlePaint,
    },
    {
      id: STORIES_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      "source-layer": STORIES_SOURCE_LAYER,
      paint: circlePaint,
    },
    {
      id: LABELS_LAYER_ID,
      type: "symbol",
      source: SOURCE_ID,
      "source-layer": STORIES_SOURCE_LAYER,
      minzoom: LABEL_MINZOOM,
      layout: {
        // §2.6: the headline, and nothing else. Never article text.
        "text-field": ["get", "title"],
        "text-font": LABEL_FONT,
        "text-size": 11,
        "text-max-width": 9,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        // §4 names both of these. Overlap off is what keeps the map readable;
        // the sort key is what decides WHICH label survives a collision, and
        // §2.5's comparator is the only defensible answer. Negated because
        // MapLibre places lower sort keys first.
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

/**
 * The leg, drawn in white at low opacity: it is a pointer, not a datum, and the
 * one thing it must never do is compete with the leaf on the end of it or read
 * as a route between two places.
 */
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
        // Enough to follow a leg back to its city on a dark basemap, not enough
        // to read as a border or a route. Checked against the live map at z9.
        "line-opacity": 0.55,
      },
    },
    {
      id: SPIDER_LEAVES_ID,
      type: "circle",
      source: SPIDER_SOURCE_ID,
      minzoom: SPIDERFY_ZOOM,
      // The identity is the identity wherever a story is drawn. A leaf is the
      // same story as the pin it came off, so it gets the same paint — including
      // its ring, which still means "this exact place" even after displacement.
      paint: circlePaint,
      // A spider's leaves are ~34px out and up to 13px across, so two of them can
      // touch; a marked leaf must be the one on top when they do. Higher sort key
      // draws later. It reads the PROPERTY, because `circle-sort-key` is layout
      // and MapLibre allows feature state in paint only — which is the whole
      // reason the vector layers need `topPinLayer` instead of a sort key.
      layout: { "circle-sort-key": ["get", TOP_STATE_KEY] },
      filter: ["==", ["geometry-type"], "Point"],
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* The top-5 layer: the highlight, drawn above everything else                 */
/* -------------------------------------------------------------------------- */

/**
 * A filter matching exactly the given story URLs — the whole interface of the
 * top-5 layer. Empty means empty, which is the correct state before the first
 * `idle` has ranked anything.
 */
export function topFilter(urls: readonly string[]): FilterSpecification {
  return ["in", ["get", "url"], ["literal", [...urls]]];
}

/**
 * The five best stories on screen, drawn a SECOND time above every other pin,
 * leg and leaf.
 *
 * **Why a layer and not a sort key.** Draw order inside a circle layer is tile
 * order, so a marked pin is behind its neighbours as often as in front of them —
 * measured on the live map, and it is visible as an orange disc sliced by a
 * white ring that belongs to a story nobody is being pointed at. The obvious fix
 * is `circle-sort-key`, and it does not work here: sort key is a LAYOUT property
 * and the highlight is feature state, which MapLibre resolves in paint only.
 *
 * So the ordering is expressed the one way the renderer allows — a layer of its
 * own, filtered to the marked URLs by `MapView`. It costs one extra draw of at
 * most five circles, and because the paint is the same `circlePaint` the copy
 * lands exactly on the original, which is what makes the duplicate invisible.
 *
 * It reads the vector source's `stories` layer only. Below `COUNTRY_LAYER_MAXZOOM`
 * a marked story may be coming from the country floor instead, where the pins are
 * sparse by construction (the floor is one story per country) and nothing is
 * overlapping anything.
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

/**
 * The layers a click should hit-test, top-most first. Labels are not clickable.
 *
 * **The leaves come first.** A leaf is drawn over the anchor's own neighbourhood
 * and is the more specific target: if a click lands on both, the reader meant
 * the one they can see is separate.
 *
 * The top-5 layer is second for the same reason it is drawn where it is: it is
 * the disc on top, so it is the disc a reader thinks they are clicking.
 */
export const CLICKABLE_LAYER_IDS = [
  SPIDER_LEAVES_ID,
  TOP_LAYER_ID,
  STORIES_LAYER_ID,
  COUNTRY_LAYER_ID,
];

/**
 * Where the headline layer must be inserted: **below the basemap's own place
 * labels**.
 *
 * **Measured 2026-08-13, and it is why this function exists.** MapLibre resolves
 * symbol collisions from the TOP layer down, so whichever symbol layer is
 * highest claims its space first and everything under it yields. Added last —
 * the obvious order, and what this file did until now — our headlines therefore
 * outranked MapTiler's `state_label` and `country_label`, and deleted them:
 *
 * ```
 *   view       place labels drawn   with the headline layer hidden
 *   US z5              2                        6
 *   US z6              3                        4
 *   India z5           7                        9
 *   US z4, z7        9 / 19                   9 / 18
 * ```
 *
 * That is up to two thirds of §2.3's clickable targets gone, and gone *worst
 * where the news is densest* — the US at z5 — which is precisely where a visitor
 * is most likely to try the gesture. The place label is load-bearing UI now, not
 * basemap decoration, so it outranks our headline.
 *
 * **Only the headline layer moves.** The two circle layers stay on top: a pin is
 * the thing being mapped, and a country name drawn over a pin would hide data
 * behind decoration. Circles do not participate in symbol collision at all, so
 * keeping them above costs nothing.
 */
const PLACE_LABEL_SOURCE_LAYERS = [
  "country_label",
  "country_disputed_label",
  "state_label",
  "place",
];

/**
 * The id of the basemap's first place-label layer, or `undefined` to append.
 *
 * `undefined` is the honest answer for a style this does not recognize —
 * `addLayer(layer, undefined)` appends, which is the pre-2026-08-13 behaviour:
 * the headlines still draw, and only the collision priority reverts.
 */
export function firstPlaceLabelLayerId(
  layers: readonly { id: string; "source-layer"?: string }[],
): string | undefined {
  return layers.find((layer) =>
    PLACE_LABEL_SOURCE_LAYERS.includes(layer["source-layer"] ?? ""),
  )?.id;
}

/* -------------------------------------------------------------------------- */
/* §2.2's red click-outline                                                    */
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
 * A filter that matches nothing. Both outline layers are added at map load and
 * live their whole lives filtered down to one region or to none — swapping a
 * filter is a repaint, while adding and removing layers on every click churns
 * the style and makes the outline flicker.
 *
 * The sentinel is the empty string, which no boundary feature can carry —
 * `scripts/build-boundaries.ts` skips a feature with no code (`if (!id) continue`).
 * It was a literal NUL byte until 2026-08-13, which worked and had one expensive
 * side effect: **git classified this file as binary and showed no diff for it at
 * all**, in a repo whose history is meant to read as the build log (§0).
 */
export const MATCH_NOTHING: ExpressionSpecification = ["==", ["get", "id"], ""];

/** The other half of the swap: show exactly one region. */
export const matchId = (id: string): ExpressionSpecification => ["==", ["get", "id"], id];

const OUTLINE_COLOR = "#e5484d";

/**
 * **Line, never fill.** §2.2 is explicit: "The polygon is never a fill. It is a
 * click-reveal only." A filled country would read as a data layer — as if the
 * whole country were the subject — when all it means is "the story is somewhere
 * in here."
 */
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

/**
 * The outline layers, in the order they must be added — **before** the story
 * layers, so an outline never draws over the pins it belongs to.
 */
export function boundaryLayers(): [LineLayerSpecification, LineLayerSpecification] {
  return [
    outlineLayer(COUNTRY_OUTLINE_ID, COUNTRIES_SOURCE_LAYER),
    outlineLayer(REGION_OUTLINE_ID, REGIONS_SOURCE_LAYER),
  ];
}

/* -------------------------------------------------------------------------- */
/* §2.3's label gesture: invisible hit targets                                 */
/* -------------------------------------------------------------------------- */

export const COUNTRY_HIT_ID = "country-hit";
export const REGION_HIT_ID = "region-hit";

/**
 * Which hit layer answers a label of each level. The level comes from the label
 * (`lib/labels.ts`), the id comes from the polygon under it — **no name matching
 * anywhere** (§2.3, §3.4), so the id is by construction one the outline archive
 * can draw.
 */
export const HIT_LAYER_FOR: Record<LabelLevel, string> = {
  country: COUNTRY_HIT_ID,
  state: REGION_HIT_ID,
};

/** Which outline layer to draw for a level, once the hit gave an id. */
export const OUTLINE_LAYER_FOR: Record<LabelLevel, string> = {
  country: COUNTRY_OUTLINE_ID,
  state: REGION_OUTLINE_ID,
};

/**
 * An **unpainted** fill over the boundary polygons, purely so a clicked label can
 * be turned into a region id by `queryRenderedFeatures`. A `line` layer cannot do
 * this: hit-testing a line means landing within a few pixels of a border, and the
 * label sits at the centroid.
 *
 * **§2.2 says the polygon is never a fill**, and that rule was amended in the
 * plan on 2026-08-13 rather than reasoned around: nothing is painted, so this is
 * not a visual fill. `fill-opacity: 0` is the amendment's entire surface area —
 * **if it ever acquires a visible colour, that is a violation**, and the test in
 * `layers.test.ts` is what says so.
 *
 * Zero opacity does not remove a layer from a query (only `visibility: none`
 * would), which is what makes an invisible hit target work at all.
 */
const hitLayer = (id: string, sourceLayer: string): FillLayerSpecification => ({
  id,
  type: "fill",
  source: BOUNDARIES_SOURCE_ID,
  "source-layer": sourceLayer,
  paint: { "fill-opacity": 0 },
});

/**
 * The hit layers, added **before** the outlines and the stories. They paint
 * nothing, so the order is not visual — it is so that any future paint-order
 * mistake puts them at the bottom rather than over the pins.
 */
export function hitLayers(): [FillLayerSpecification, FillLayerSpecification] {
  return [
    hitLayer(COUNTRY_HIT_ID, COUNTRIES_SOURCE_LAYER),
    hitLayer(REGION_HIT_ID, REGIONS_SOURCE_LAYER),
  ];
}

/**
 * Which outline layer a container belongs to, and what to filter it by.
 *
 * A container is a country when its region code IS its country code (`SP`), and
 * an admin-1 region otherwise (`USCA`, `UKC9`) — §2.2. Anything that is not a
 * container gets no outline at all: a PIN is at an exact place, and drawing a
 * country around it would claim the opposite.
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
