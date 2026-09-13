import type { RegionEntry, RegionIndex, RegionStory } from "./types";

let pending: Promise<RegionIndex> | null = null;
let pendingUrl = "";

// Keyed by URL: regionsUrl is content-hashed, so a page must not stay pinned to an old index.
export function loadRegionIndex(url: string): Promise<RegionIndex> {
  if (!pending || pendingUrl !== url) {
    pendingUrl = url;
    pending = fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`region index: HTTP ${response.status}`);
        return (await response.json()) as RegionIndex;
      })
      .catch((cause: unknown) => {
        // A failed fetch must not poison the cache: the next click retries.
        pending = null;
        throw cause;
      });
  }
  return pending;
}

export function resetRegionIndexCache(): void {
  pending = null;
  pendingUrl = "";
}

const EMPTY: RegionEntry = { stories: [], total: 0, sources: 0 };

// Also reads the legacy bare RegionStory[] form (total 0): a new field must never break
// an unrefreshed reader.
export function entryFor(index: RegionIndex | null, regionId: string): RegionEntry {
  if (!index || !regionId) return EMPTY;
  const value = index[regionId];
  if (Array.isArray(value)) return { stories: value, total: 0, sources: 0 };
  return value ?? EMPTY;
}

export function storiesFor(index: RegionIndex | null, regionId: string): RegionStory[] {
  return entryFor(index, regionId).stories;
}

// Parsed by field, never Date.parse: engines reject the format or read the prefix as local time.
export function gkgToMillis(stamp: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp ?? "");
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}
