/**
 * The browser's half of "Where to next?": fetching the place index and
 * ranking it against a typed query. Every id here came off the build's own
 * `outline()` calls (`scripts/build-boundaries.ts`), so a suggestion can
 * never resolve to an id the outline archive cannot draw or the region panel
 * cannot answer — see
 * docs/DESIGN.md#the-label-based-gesture-and-no-name-matching-ever. Static
 * and committed, same reasoning as `lib/region-bbox.ts`: fetched lazily on
 * the search box's first focus, since nothing needs it before then.
 */

import { CONTINENT_BBOX, CONTINENT_NAME, type ContinentId } from "./continents";

export type PlaceKind = "country" | "state" | "continent";

export type PlaceEntry = {
  id: string;
  name: string;
  kind: PlaceKind;
  parent?: string;
  alt?: string[];
};

type IndexEntry = {
  id: string;
  name: string;
  kind: "country" | "state";
  parent?: string;
  alt?: string[];
};

export const PLACE_INDEX_URL = "/place-index.json";

let pending: Promise<IndexEntry[]> | null = null;

// Fetch the index once, however many focuses ask for it. Memoized on the
// promise, not the result, so two fast focuses share one request. Not keyed
// by URL, unlike loadRegionIndex — there is only one URL, immutable for the
// deploy's life, same as loadRegionBboxes.
export function loadPlaceIndex(): Promise<IndexEntry[]> {
  if (!pending) {
    pending = fetch(PLACE_INDEX_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`place index: HTTP ${response.status}`);
        return (await response.json()) as IndexEntry[];
      })
      .catch((cause: unknown) => {
        // A failed fetch must not poison the cache: the next focus should
        // retry rather than re-throw a network blip for the rest of the
        // session.
        pending = null;
        throw cause;
      });
  }
  return pending;
}

/** Test seam. */
export function resetPlaceIndexCache(): void {
  pending = null;
}

/**
 * The built index plus the seven continents, merged into one searchable set.
 * Continents are not in `place-index.json` — they're a closed table already
 * in `lib/continents.ts` (`CONTINENT_BBOX`), so building them here is not a
 * second join, just a second source for the same flat list.
 */
export function searchablePlaces(index: IndexEntry[]): PlaceEntry[] {
  const continents: PlaceEntry[] = (Object.keys(CONTINENT_BBOX) as ContinentId[]).map((id) => ({
    id,
    name: CONTINENT_NAME[id],
    kind: "continent",
  }));
  return [...continents, ...index];
}

/**
 * Lowercase, diacritic-stripped, whitespace-collapsed. Load-bearing, not
 * polish — "Cote d'Ivoire", "Curacao" and "Malmo" are what people actually
 * type, and the index carries the accented spellings.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const KIND_RANK: Record<PlaceKind, number> = { continent: 0, country: 1, state: 2 };

/** The best rank tier a name (or the query against it) achieves, or `null` for no match. */
function tierFor(name: string, query: string): number | null {
  const normalizedName = normalize(name);
  if (normalizedName === query) return 0;
  if (normalizedName.startsWith(query)) return 1;
  if (normalizedName.split(" ").some((word) => word.startsWith(query))) return 2;
  if (normalizedName.includes(query)) return 4;
  return null;
}

/**
 * Ranked, deduped suggestions for a typed query. Empty/whitespace returns
 * `[]` rather than the whole index — an empty list is what closes the
 * dropdown.
 *
 * Tiers, best first: exact match, name starts with the query, a later word
 * starts with the query ("york" -> "New York"), the same three tiers against
 * an alias, then substring anywhere. Ties break on kind (continent before
 * country before state — "georgia" should offer the country first) then on
 * shorter name.
 */
export function searchPlaces(places: PlaceEntry[], query: string, limit = 7): PlaceEntry[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const ranked: { place: PlaceEntry; tier: number }[] = [];

  for (const place of places) {
    const nameTier = tierFor(place.name, normalizedQuery);
    const altTier = place.alt
      ? Math.min(
          ...place.alt.map((alt) => tierFor(alt, normalizedQuery) ?? Infinity),
          Infinity,
        )
      : Infinity;

    // An alias hit ranks at tiers 1-3 (never as good as an exact/prefix hit
    // on the canonical name, which is tier 0) — offset by 0.5 so it still
    // loses ties to the same tier on the real name.
    const tier = Math.min(nameTier ?? Infinity, altTier === Infinity ? Infinity : altTier + 0.5);
    if (Number.isFinite(tier)) ranked.push({ place, tier });
  }

  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (KIND_RANK[a.place.kind] !== KIND_RANK[b.place.kind]) {
      return KIND_RANK[a.place.kind] - KIND_RANK[b.place.kind];
    }
    return a.place.name.length - b.place.name.length;
  });

  const seen = new Set<string>();
  const out: PlaceEntry[] = [];
  for (const { place } of ranked) {
    if (seen.has(place.id)) continue;
    seen.add(place.id);
    out.push(place);
    if (out.length >= limit) break;
  }
  return out;
}
