/**
 * Which rendered basemap feature is a place label, and at what level. The
 * gesture is clicking the word, not the landmass — a shape click can't
 * distinguish "California" from "the United States". Two label schemas are
 * both required: MapTiler's own source-layers (`country_label`,
 * `state_label`, ...) and OpenFreeMap's single `place` layer discriminated
 * by `class` — the app falls back to OpenFreeMap with no API key (see
 * lib/basemap.ts), and MapTiler has already changed its own schema once.
 * A mismatch here fails silently (a click matching nothing is
 * indistinguishable from clicking the ocean), hence tests, not a comment.
 * The label supplies only the level, never a region id — that comes from
 * hit-testing `boundaries.pmtiles` at the label's anchor (city and
 * continent resolve differently; see `lib/cities.ts` /
 * `lib/continents.ts`) — to avoid joining "California" to `USCA` by name.
 * `town_label`/`place_label` stay refused deliberately: they sit inside a
 * city's snap radius, and accepting them would print a parent city's
 * stories under a suburb's name. See
 * docs/DESIGN.md#the-label-based-gesture-and-no-name-matching-ever.
 */

export type LabelLevel = "country" | "state" | "city" | "continent";

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

// MapTiler source-layers, by level. country_disputed_label is accepted as
// a country because that's how MapTiler draws disputed territories
// (Kosovo, Western Sahara, Taiwan) — refusing the click would be an
// unexplainable dead spot, and it costs nothing since the id still comes
// from our own boundary hit-test.
const MAPTILER_LAYERS: Record<string, LabelLevel> = {
  country_label: "country",
  country_disputed_label: "country",
  state_label: "state",
  city_label: "city",
  continent_label: "continent",
};

/** OpenMapTiles: one `place` layer, `class` is the discriminator. */
const OPENMAPTILES_LAYER = "place";
const OPENMAPTILES_CLASSES: Record<string, LabelLevel> = {
  country: "country",
  state: "state",
  city: "city",
  continent: "continent",
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
 * present because the map is English-only.
 */
export function labelName(feature: LabelFeature | null | undefined): string {
  const properties = feature?.properties ?? {};
  for (const key of ["name:en", "name_en", "name"]) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
