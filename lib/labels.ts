/**
 * Which rendered basemap feature is a place label, and at what level
 * (HANDOFF.md §2.3, step 1).
 *
 * §2.3's gesture is **clicking the word**, not the landmass: clicking a shape
 * cannot tell "California" from "the United States", and clicking the label can.
 * So a click hit-tests the whole map — `queryRenderedFeatures` with no layer
 * filter returns basemap features alongside ours — and this module answers the
 * only question that matters about the result: is this a country label, a state
 * label, or neither.
 *
 * **Two schemas, both required.** MapTiler's `planet_v4` puts labels in their own
 * source-layers (`country_label`, `state_label`); OpenFreeMap ships OpenMapTiles,
 * where every settlement, state and country is one `place` layer discriminated by
 * `class`. The app runs on MapTiler in production and falls back to OpenFreeMap
 * with no key (`lib/basemap.ts`), so both spellings are live, and **MapTiler has
 * already changed its schema once**. When this breaks it breaks the §11 way —
 * silently, with no error and no console warning, because a click that matches
 * nothing is indistinguishable from a click on the ocean. Hence tests, not a
 * comment.
 *
 * **The label supplies the level and nothing else.** State labels carry no region
 * code on either provider (MapTiler has `iso_a2` + `admin_level`, OpenFreeMap has
 * only a name), and joining "California" to `USCA` by name is §3.4's join trap
 * wearing a new hat. The region id comes from hit-testing our own
 * `boundaries.pmtiles` at the label's anchor — see `MapView.tsx`. The `name` here
 * is for the panel heading only; nothing joins on it.
 *
 * Verified against both live styles on 2026-08-13:
 *
 * ```
 *   maptiler     country_label  z2-12   country_disputed_label z4-12
 *                state_label    z2-11
 *   openfreemap  place/country  z0-9    place/state            z5-8
 * ```
 */

export type LabelLevel = "country" | "state";

/**
 * The shape this module needs out of a MapLibre feature. Deliberately structural
 * rather than `MapGeoJSONFeature`: it keeps the tests free of a rendered map, and
 * the real type satisfies it.
 */
export type LabelFeature = {
  sourceLayer?: string | null;
  properties?: Record<string, unknown> | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
};

/**
 * MapTiler source-layers, by level.
 *
 * `country_disputed_label` is accepted as a country because it is how MapTiler
 * draws the ones a worldview disagrees about (Kosovo, Western Sahara, Taiwan) —
 * they are labelled like any other country on screen, so refusing the click would
 * be an unexplainable dead spot. It costs nothing to accept: the id still comes
 * from our own boundary hit-test, which either has that polygon or draws no
 * outline at all.
 */
const MAPTILER_LAYERS: Record<string, LabelLevel> = {
  country_label: "country",
  country_disputed_label: "country",
  state_label: "state",
};

/** OpenMapTiles: one `place` layer, `class` is the discriminator. */
const OPENMAPTILES_LAYER = "place";
const OPENMAPTILES_CLASSES: Record<string, LabelLevel> = {
  country: "country",
  state: "state",
};

/**
 * The level of a place label, or `null` for anything else — a city label, a road
 * shield, one of our own pins.
 *
 * Our own layers are excluded structurally rather than by name: they are in the
 * `stories`, `country-top` and boundary source-layers, none of which appear
 * above.
 */
export function labelLevelOf(feature: LabelFeature | null | undefined): LabelLevel | null {
  const sourceLayer = feature?.sourceLayer ?? "";
  if (!sourceLayer) return null;

  const maptiler = MAPTILER_LAYERS[sourceLayer];
  if (maptiler) return maptiler;

  if (sourceLayer === OPENMAPTILES_LAYER) {
    const className = feature?.properties?.class;
    if (typeof className === "string") return OPENMAPTILES_CLASSES[className] ?? null;
  }

  return null;
}

/**
 * The top-most place label in a `queryRenderedFeatures` result, or `null`.
 *
 * MapLibre returns features in render order, top-most first, so the first match
 * is the label the user believes they clicked. A state label sits above its
 * country label where both render, which is the resolution the gesture wants:
 * clicking "Texas" selects Texas, not the United States.
 */
export function firstLabel<T extends LabelFeature>(
  features: readonly T[],
): { feature: T; level: LabelLevel } | null {
  for (const feature of features) {
    const level = labelLevelOf(feature);
    if (level) return { feature, level };
  }
  return null;
}

/**
 * The label's own anchor, `[lng, lat]`.
 *
 * This is the point that gets projected and hit-tested against the boundary
 * polygons, so it must be the LABEL's position and not the click position: a
 * country's name is drawn near its centroid, while the click that selected it can
 * land several pixels outside the country's coastline — over water, or over a
 * neighbour — and the whole join would then be off by one country.
 */
export function labelAnchor(feature: LabelFeature | null | undefined): [number, number] | null {
  const geometry = feature?.geometry;
  if (geometry?.type !== "Point") return null;
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lng, lat] = coordinates;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

/**
 * The label's display text, for the panel heading.
 *
 * **Display only.** Nothing joins on this string — see the header. Both providers
 * write `name`; MapTiler also writes localized `name:en`, which is preferred when
 * present because the map is English-only (§2.6).
 */
export function labelName(feature: LabelFeature | null | undefined): string {
  const properties = feature?.properties ?? {};
  for (const key of ["name:en", "name_en", "name"]) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
