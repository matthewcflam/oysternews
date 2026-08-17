/**
 * How the two story layers are drawn (HANDOFF.md §4, Phase 4).
 *
 * Separated from `MapView.tsx` because these specs carry product rules, not
 * decoration, and rules deserve tests. Three of them in particular:
 *
 * 1. **A label may only ever contain the headline** (§2.6, link-out only). The
 *    text field is the one place article prose could reach a rendered surface, so
 *    it is asserted in `layers.test.ts` rather than left to review.
 * 2. **A container is not drawn at all.** §2.1 places a container at a region's
 *    centre because the story has no exact location; drawing it as a point
 *    claims a precision the pipeline measured itself NOT to have (69.7% pins,
 *    §5.2). Since 2026-08-14 every pin layer filters containers out with
 *    `NOT_CONTAINER` and they are surfaced in the region panel instead — see the
 *    identity block below.
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
 * **Two states (2026-08-14), and the ring is the only difference between them:**
 *
 * | State  | Reads as                                   | Drawn as                  |
 * | ------ | ------------------------------------------ | ------------------------- |
 * | Pin    | a story                                    | solid orange              |
 * | Top 5  | one of the five best stories on screen now | solid orange in a white ring |
 *
 * Both occupy the **same footprint**, so the five marked pins are not larger
 * than their neighbours — they are the same circle wearing a border. That is the
 * whole point of the collapse: size already encodes salience through
 * `radiusBySalience`, and a second size signal on top of it made "big" mean two
 * things at once.
 *
 * **The ring changed sides.** Until now the ring meant "an exact place" and
 * marked every PIN, with the top 5 distinguished by a `TOP_SCALE` multiplier and
 * containers drawn as solid white discs. Three marks for three ideas, on a map
 * where the smallest is 3px across. The ring now answers the one question a
 * reader is actually asking — *what should I read* — and the exactness question
 * is answered by the panel's placement line instead (`lib/story.ts`), where it
 * can use words.
 *
 * **A container is no longer drawn.** It has no third mark because it is not on
 * the map: `NOT_CONTAINER` filters it out of every layer, and "somewhere in this
 * region" is surfaced in the region panel, which can say so in a sentence rather
 * than by asking a reader to decode a colour.
 */
export const ACCENT = "#D24F39";
const WHITE = "#ffffff";

/**
 * The brand's purple — the far stop of the sphere beside the search field, and
 * the colour of the selection triangle (`lib/pin.ts`, which imports it from here
 * so there is one definition of it in TypeScript).
 *
 * **The selection mark is deliberately NOT the accent.** Everything orange on
 * this map is a story; the triangle is not a story, it is the reader's own
 * pointer at one. In orange it read as a sixth, oddly-shaped pin.
 *
 * `app/globals.css` states it a third time, inside a gradient, where a variable
 * would not help — a gradient stop cannot be imported.
 */
export const MARK = "#C05AC4";

/**
 * The white ring, as a share of the footprint radius — measured off the identity
 * sheet, where the orange core is ~0.68 of the white disc around it.
 *
 * It is a RATIO and not a fixed 1.5px because the footprint spans 3px to 13px: a
 * constant ring is half the area of a small circle and a hairline on a large
 * one, so "top 5" would have meant two different marks at the two ends of the
 * salience scale.
 */
const RING_RATIO = 0.32;

/**
 * The feature-state flag `MapView` sets on the five best stories in the viewport.
 * Feature state, not a property: "on screen" is a camera fact, so it cannot be
 * baked into a tile, and re-filtering a layer on every move would restyle the
 * whole map to change five circles.
 */
export const TOP_STATE_KEY = "top";

/**
 * The feature-state flag `MapView` sets on the one open story, and clears when
 * the panel closes. At most one feature carries it.
 *
 * Feature state for the same reason `TOP_STATE_KEY` is: which story is open is a
 * fact about this reader's gesture, not about the tile, and re-filtering a layer
 * on every click would restyle the whole map to change one circle.
 */
export const SELECTED_STATE_KEY = "selected";

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
 * **Containers are not drawn on the map (2026-08-14).** Placing one at a
 * region's centroid puts a point on a coastline or in a desert and asserts a
 * story happened there, which is exactly what §2.1 says it does not know. The
 * region panel says "somewhere in" in words instead.
 *
 * Every layer that draws a story carries this, including `topPinLayer` — the
 * top-5 copy reads the same source and would resurrect a container the moment
 * one ranked. Nothing has to change in `lib/top.ts` or `lib/spiderfy.ts`: both
 * are fed from `queryRenderedFeatures`, and an undrawn feature is not returned.
 */
/*
 * Typed as an `ExpressionSpecification`, not a `FilterSpecification`: the latter
 * is a union that still admits the legacy array-filter syntax, and TypeScript
 * cannot then prove this is safe to nest inside `["all", ...]` in `topFilter`.
 * A layer's `filter` accepts an expression, so nothing is lost by narrowing.
 */
export const NOT_CONTAINER: ExpressionSpecification = ["!=", ["get", "kind"], "CONTAINER"];

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
 * The open story, read the same two ways and for the same reason: a spider leaf
 * lives in its own source, and feature state does not cross sources.
 */
const isSelected: ExpressionSpecification = [
  "any",
  ["boolean", ["feature-state", SELECTED_STATE_KEY], false],
  ["==", ["get", SELECTED_STATE_KEY], 1],
];

/**
 * Both states share ONE footprint, so a marked story and an ordinary one of
 * equal salience occupy exactly the same space on the map and only their filling
 * differs. MapLibre grows a stroke OUTWARD from the radius, so a marked pin's
 * orange core is shrunk by exactly the ring it is about to gain —
 * `(1 - RING_RATIO) + RING_RATIO` — and the two outer edges land on each other.
 */
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
  /**
   * Two colours, and the second one is only ever worn by one story at a time.
   *
   * Every story on the map is the same orange — salience is in the radius and
   * the ring means "top five here", so nothing about a disc's fill is a claim
   * about the story. The exception is the open one: the selection wedge points
   * at it from above, and filling the disc it points at in the same `MARK`
   * makes the pair read as one mark rather than as a triangle that happens to
   * be near a pin. It is a statement about what the reader picked, which is why
   * it can be a colour: it is the only property of a pin the reader set.
   *
   * The change is in `circlePaint` rather than in a layer of its own, so it
   * lands wherever a story is drawn — the stories layer, the country floor, the
   * top-5 copy on top, and (through the property arm of `isSelected`) a spider
   * leaf. A recolour that missed one of those would leave the wedge pointing at
   * an orange disc in exactly the cases the map is busiest.
   */
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
      // The country floor is one story per country and many of them are
      // containers, so this layer thins out visibly below z4. That is the
      // accepted cost of not drawing a story at a centroid it did not happen at.
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
  // ANDed with `NOT_CONTAINER` for the same reason the pin layers carry it: this
  // layer reads the same source, so without it a container that ranked would be
  // drawn here even though it is filtered out of the layer underneath.
  return ["all", NOT_CONTAINER, ["in", ["get", "url"], ["literal", [...urls]]]];
}

/**
 * The headline layer, minus the stories that are wearing a speech bubble.
 *
 * Mode 1 draws the top five headlines in `#D24F39` Newsreader at 16px next to
 * their pins. `stories-labels` is still drawing the same `title` in 11px Noto
 * underneath them from z4 up, so without this a bubbled story says its own
 * sentence twice, in two typefaces, a few pixels apart.
 *
 * **Keyed on the captured bubble list, not on which bubbles were actually
 * placed.** A bubble that `lib/bubble.ts` drops for want of room takes its small
 * label with it, and that is the accepted cost of not plumbing the placement
 * result back into the style: the alternative is a filter that depends on a React
 * render, which then repaints the map, which produces another `idle`. The story
 * keeps its ring.
 *
 * The bubbles are captured once and retired on the reader's first camera move, so
 * `MapView` calls this with `[]` from `dismissBubbles` — that call is what gives
 * the five their 11px labels back, and it does not go through `applyTop`, whose
 * `sameKeys` guard returns early when the ranking has not changed.
 */
export function bubbleLabelFilter(urls: readonly string[]): FilterSpecification {
  return ["all", NOT_CONTAINER, ["!", ["in", ["get", "url"], ["literal", [...urls]]]]];
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

/* -------------------------------------------------------------------------- */
/* The selection pin: the triangle dropped on whatever was clicked             */
/* -------------------------------------------------------------------------- */

export const SELECTED_SOURCE_ID = "selected";
export const SELECTED_LAYER_ID = "selected-pin";
export const PIN_IMAGE_ID = "pin-triangle";

/**
 * The triangle that marks the current selection, drawn **above every disc**.
 *
 * **Its apex is the anchor.** `icon-anchor: "bottom"` puts the middle of the
 * image's bottom edge — which is where `trianglePin` rasterises the point, by
 * construction; see `PIN_LEFT_PAD` — on the feature's coordinate, so the tip
 * lands on the story's own orange circle and the wedge hangs above it. Any other
 * anchor would float the mark near the story rather than on it, and "near" is not
 * a claim this map is allowed to make about a location.
 *
 * **Overlap and placement are both forced.** This is the one thing on screen the
 * reader explicitly asked for; letting MapLibre's collision detection drop it
 * because a headline got there first would make the click look like it failed.
 * `icon-ignore-placement` is the other half — without it the triangle still
 * takes part in collisions as an obstacle and erases the labels around it.
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
 * Which outline layer a container belongs to, and what to filter it by.
 *
 * A container is a country when its region code IS its country code (`SP`), and
 * an admin-1 region otherwise (`USCA`, `UKC9`) — §2.2. Anything that is not a
 * container gets no outline at all: a PIN is at an exact place, and drawing a
 * country around it would claim the opposite.
 *
 * **Nothing on the map can reach this today.** Containers are filtered out of
 * every pin layer (`NOT_CONTAINER`), so no click can produce a feature it
 * accepts. It is kept whole, with its tests, because the "somewhere in" stories
 * are being moved into the region panel and will need exactly this join to draw
 * their outline from there.
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
