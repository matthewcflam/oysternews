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

const PLACE_INDEX_URL = "/place-index.json";

let pending: Promise<IndexEntry[]> | null = null;

export function loadPlaceIndex(): Promise<IndexEntry[]> {
  if (!pending) {
    pending = fetch(PLACE_INDEX_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`place index: HTTP ${response.status}`);
        return (await response.json()) as IndexEntry[];
      })
      .catch((cause: unknown) => {
        // A failed fetch must not poison the cache: the next focus retries.
        pending = null;
        throw cause;
      });
  }
  return pending;
}

export function resetPlaceIndexCache(): void {
  pending = null;
}

export function searchablePlaces(index: IndexEntry[]): PlaceEntry[] {
  const continents: PlaceEntry[] = (Object.keys(CONTINENT_BBOX) as ContinentId[]).map((id) => ({
    id,
    name: CONTINENT_NAME[id],
    kind: "continent",
  }));
  return [...continents, ...index];
}

// Load-bearing: people type "Cote d'Ivoire" and the index carries the accented spelling.
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

const KIND_RANK: Record<PlaceKind, number> = { continent: 0, country: 1, state: 2 };

function tierFor(name: string, query: string): number | null {
  const normalizedName = normalize(name);
  if (normalizedName === query) return 0;
  if (normalizedName.startsWith(query)) return 1;
  if (normalizedName.split(" ").some((word) => word.startsWith(query))) return 2;
  if (normalizedName.includes(query)) return 4;
  return null;
}

export function searchPlaces(places: PlaceEntry[], query: string, limit = 7): PlaceEntry[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const ranked: { place: PlaceEntry; tier: number }[] = [];

  for (const place of places) {
    const nameTier = tierFor(place.name, normalizedQuery);
    const altTier = place.alt
      ? Math.min(...place.alt.map((alt) => tierFor(alt, normalizedQuery) ?? Infinity), Infinity)
      : Infinity;

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
