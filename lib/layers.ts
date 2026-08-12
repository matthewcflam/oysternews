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
 *    NOT to have (69.7% pins, §5.2). The hollow ring IS the geotag-confidence
 *    treatment for the container case.
 * 3. **Tier-1 is invisible.** §2.3: "no tier-1 toggle and no tier-1 badge; the
 *    preference is invisible except in *which* stories are on screen." Nothing
 *    here may read the `tier1` property, and a test holds that line.
 */

import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";

/** Tippecanoe layer names. Must match `worker/tiles.ts`'s exports exactly. */
export const STORIES_SOURCE_LAYER = "stories";
export const COUNTRY_SOURCE_LAYER = "country-top";

export const SOURCE_ID = "stories";
export const STORIES_LAYER_ID = "stories-pins";
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

const PIN_COLOR = "#e5484d";
const CONTAINER_FILL = "rgba(229, 72, 77, 0.22)";
const CONTAINER_STROKE = "#ff8a8d";

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

/** Zoom scaling wraps the salience scale so both read at once. */
const circleRadius: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  1,
  radiusBySalience(3, 4, 5.5, 7),
  8,
  radiusBySalience(5, 7, 10, 13),
];

/**
 * A container is drawn hollow: the story is somewhere in this region, not at
 * this point. See the header — this is a truth claim, not a palette choice.
 */
const isContainer: ExpressionSpecification = ["==", ["get", "kind"], "CONTAINER"];

const circlePaint = {
  "circle-radius": circleRadius,
  "circle-color": ["case", isContainer, CONTAINER_FILL, PIN_COLOR] as ExpressionSpecification,
  "circle-stroke-width": 1.5,
  "circle-stroke-color": [
    "case",
    isContainer,
    CONTAINER_STROKE,
    "#ffffff",
  ] as ExpressionSpecification,
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
 * styling, and labels paint over both.
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

/** The layers a click should hit-test, top-most first. Labels are not clickable. */
export const CLICKABLE_LAYER_IDS = [STORIES_LAYER_ID, COUNTRY_LAYER_ID];
