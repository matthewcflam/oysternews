/**
 * §4's continent labels: a closed seven-name table, not a join.
 *
 * MapTiler's `continent_label` carries only `name`/`name:en` (verified against
 * the live style 2026-08-21) — no id, no code. Natural Earth's `CONTINENT`
 * column (`scripts/build-crosswalk.ts`) is the other vocabulary this project
 * speaks, and **the two disagree on one name**: MapTiler's `name:en` for
 * Oceania is `"Australia"`; Natural Earth calls the same continent
 * `"Oceania"`. Both must resolve to the same id or a click on the label loses
 * the continent the crosswalk files stories under. `continentIdFor` is the one
 * place that bridges them.
 *
 * The `CONT:` prefix cannot collide with `worker/place.ts`'s `regionIdFor` —
 * FIPS country codes are two characters and admin-1 codes are four; nothing
 * three characters and colon-shaped can arrive from that function.
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
 * Curated camera boxes for the "Zoom to" button, in the spirit of
 * `MapView.tsx`'s `BBOX_OVERRIDES`: a computed union of member countries would
 * hand Europe a box reaching the Bering Strait through Russia's own bbox, and
 * a hand-picked constant is honest about being a curated view rather than a
 * derived fact.
 *
 * `[west, south, east, north]`, matching `lib/region-bbox.ts`'s `Bbox` — east
 * may exceed 180 for a continent that crosses the antimeridian, the same
 * convention `region-bbox.json` uses for Russia (`east: 191.005`) and Fiji.
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
