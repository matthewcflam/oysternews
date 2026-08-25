/**
 * Continent labels: a closed seven-name table, not a join. MapTiler's
 * `continent_label` carries only a name, no id — and MapTiler's `"Australia"`
 * and Natural Earth's `"Oceania"` name the same continent, so
 * `continentIdFor` bridges both vocabularies to one id. The `CONT:` prefix
 * can't collide with `worker/place.ts`'s `regionIdFor` (FIPS = 2 chars,
 * admin-1 = 4). See docs/DESIGN.md#cities-continents.
 */

export type ContinentId =
  | "CONT:AF"
  | "CONT:AN"
  | "CONT:AS"
  | "CONT:EU"
  | "CONT:NA"
  | "CONT:OC"
  | "CONT:SA";

/**
 * Every spelling this app can see for each continent, lowercased: MapTiler's
 * `name:en` (measured live) and Natural Earth's `CONTINENT` values
 * (`data/crosswalk.json`). Both vocabularies are closed and small enough to
 * enumerate rather than normalize algorithmically.
 */
const NAME_TO_ID: Record<string, ContinentId> = {
  africa: "CONT:AF",
  antarctica: "CONT:AN",
  asia: "CONT:AS",
  europe: "CONT:EU",
  "north america": "CONT:NA",
  "south america": "CONT:SA",
  oceania: "CONT:OC",
  australia: "CONT:OC",
};

/**
 * A continent id from a label's or a crosswalk row's own name, or `null` for
 * anything outside the closed table — the ninth Natural Earth bucket,
 * "Seven seas (open ocean)", included.
 */
export function continentIdFor(name: string | null | undefined): ContinentId | null {
  const key = (name ?? "").trim().toLowerCase();
  return NAME_TO_ID[key] ?? null;
}

/**
 * One canonical display name per id, for the search suggestion list.
 * Deliberately not an invert of `NAME_TO_ID` — that map is many-to-one
 * (`"oceania"` and `"australia"` both resolve to `CONT:OC`), so a naive
 * invert would need an arbitrary tiebreak. "Oceania" is picked over
 * "Australia" here because the continent includes New Zealand and the
 * Pacific islands, not just the country.
 */
export const CONTINENT_NAME: Record<ContinentId, string> = {
  "CONT:AF": "Africa",
  "CONT:AN": "Antarctica",
  "CONT:AS": "Asia",
  "CONT:EU": "Europe",
  "CONT:NA": "North America",
  "CONT:OC": "Oceania",
  "CONT:SA": "South America",
};

/**
 * Curated camera boxes for the "Zoom to" button, in the spirit of
 * `MapView.tsx`'s `BBOX_OVERRIDES`: a computed union of member countries
 * would hand Europe a box reaching the Bering Strait through Russia's own
 * bbox. `[west, south, east, north]` — east may exceed 180 for a continent
 * crossing the antimeridian, same convention as `region-bbox.json`.
 */
export const CONTINENT_BBOX: Record<ContinentId, [number, number, number, number]> = {
  "CONT:AF": [-25.36, -46.97, 63.5, 37.5],
  "CONT:AN": [-180, -90, 180, -60],
  "CONT:AS": [26.0, -11.0, 191.0, 81.0],
  "CONT:EU": [-24.5, 34.5, 45.0, 71.5],
  "CONT:NA": [-168.0, 5.5, -52.0, 83.5],
  "CONT:OC": [110.0, -47.5, 210.5, 5.0],
  "CONT:SA": [-81.5, -56.0, -34.5, 12.5],
};
