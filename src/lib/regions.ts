/**
 * The browser's half of the region panel: fetching the published index and
 * reading a row out of it. The index is `archives/regions-<hash>.json`,
 * built by `worker/regions.ts` over the whole ranked pool — it can't be
 * queried from the tiles, since the tile budget bakes deferred stories
 * into higher-zoom tiles. Fetched lazily on the first label click, since
 * nothing needs it before then and the map appearing has to be fast. See
 * docs/DESIGN.md#regions.
 */

import type { RegionEntry, RegionIndex, RegionStory } from "./types";

let pending: Promise<RegionIndex> | null = null;
let pendingUrl = "";

// Fetch the index once per URL, however many clicks ask for it. Memoized
// on the promise, not the result, so two fast clicks share one request.
// Keyed by URL since regionsUrl is content-hashed — a new run means a new
// URL, and a stale page must not stay pinned to an old index.
export function loadRegionIndex(url: string): Promise<RegionIndex> {
  if (!pending || pendingUrl !== url) {
    pendingUrl = url;
    pending = fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`region index: HTTP ${response.status}`);
        return (await response.json()) as RegionIndex;
      })
      .catch((cause: unknown) => {
        // A failed fetch must not poison the cache: the next click should retry
        // rather than re-throw a network blip for the rest of the session.
        pending = null;
        throw cause;
      });
  }
  return pending;
}

/** Test seam. */
export function resetRegionIndexCache(): void {
  pending = null;
  pendingUrl = "";
}

/** The shape a missing region and a legacy index both collapse to. */
const EMPTY: RegionEntry = { stories: [], total: 0, sources: 0 };

/**
 * A region's entry: its rows, and the two counts the header prints. An
 * empty entry is a normal answer (a country can genuinely have no news in
 * the window), not an error. Reads two shapes on purpose — the legacy bare
 * `RegionStory[]` form (from before the index gained counts) yields
 * `total: 0`, which `RegionPanel` renders as no counts line rather than
 * "0 stories today". Same argument that makes `regionsUrl` optional on the
 * manifest: a new field must never break the map for an unrefreshed reader.
 */
export function entryFor(index: RegionIndex | null, regionId: string): RegionEntry {
  if (!index || !regionId) return EMPTY;
  const value = index[regionId];
  if (Array.isArray(value)) return { stories: value, total: 0, sources: 0 };
  return value ?? EMPTY;
}

/** The rows alone, for callers that do not care about the counts. */
export function storiesFor(index: RegionIndex | null, regionId: string): RegionStory[] {
  return entryFor(index, regionId).stories;
}

// A GKG stamp (YYYYMMDDHHMMSS, UTC) as milliseconds, or NaN. Parsed by
// field, NEVER handed to Date.parse — it reads the string as invalid in
// every engine, and reads the 8-char prefix as a LOCAL date in some.
export function gkgToMillis(stamp: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp ?? "");
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

