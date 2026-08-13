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
  FillLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { LabelLevel } from "./labels";

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

/** The layers a click should hit-test, top-most first. Labels are not clickable. */
export const CLICKABLE_LAYER_IDS = [STORIES_LAYER_ID, COUNTRY_LAYER_ID];

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
