// A mismatch here fails silently: a click matching nothing looks like a click on the ocean.
// The label gives only the level; the id comes from the boundary hit-test, never a name join.

export type LabelLevel = "country" | "state" | "city" | "continent";

export type LabelFeature = {
  sourceLayer?: string | null;
  properties?: Record<string, unknown> | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
};

// MapTiler draws disputed territories in country_disputed_label; refusing it leaves dead spots.
const MAPTILER_LAYERS: Record<string, LabelLevel> = {
  country_label: "country",
  country_disputed_label: "country",
  state_label: "state",
  city_label: "city",
  continent_label: "continent",
};

const OPENMAPTILES_LAYER = "place";
const OPENMAPTILES_CLASSES: Record<string, LabelLevel> = {
  country: "country",
  state: "state",
  city: "city",
  continent: "continent",
};

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

export function firstLabel<T extends LabelFeature>(
  features: readonly T[]
): { feature: T; level: LabelLevel } | null {
  for (const feature of features) {
    const level = labelLevelOf(feature);
    if (level) return { feature, level };
  }
  return null;
}

// The LABEL's anchor, not the click point: a click can land outside the country's coastline.
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

// Display only. Nothing joins on this string.
export function labelName(feature: LabelFeature | null | undefined): string {
  const properties = feature?.properties ?? {};
  for (const key of ["name:en", "name_en", "name"]) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
