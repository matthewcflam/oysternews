/**
 * The browser's half of §2.3's region panel: fetching the published index, and
 * reading a row out of it.
 *
 * The index is `archives/regions-<hash>.json`, built by `worker/regions.ts` over
 * the whole ranked pool and pointed at by the manifest's `regionsUrl`. **It could
 * not have been queried from the tiles** — the §2.4 budget bakes deferred stories
 * into higher-zoom tiles, so a country's tile at world zoom does not contain them
 * and `queryRenderedFeatures` would call one floor pin "Pakistan's top stories".
 *
 * **Fetched lazily, on the first label click.** It measured 151 KB gzipped on the
 * 2026-08-13 run and is expected to grow as `adm1` coverage fills the window; §1
 * puts this audience on a phone, and nothing needs the index until a label is
 * clicked. Paying for it at page load would slow down the one thing that has to
 * be fast — the map appearing.
 */

import type { RegionEntry, RegionIndex, RegionStory } from "./types";

let pending: Promise<RegionIndex> | null = null;
let pendingUrl = "";

/**
 * Fetch the index once per URL, however many clicks ask for it.
 *
 * Memoized on the promise rather than the result, so two fast clicks share one
 * request instead of racing two. Keyed by URL because the manifest's
 * `regionsUrl` is content-hashed: a new run means a new URL, and a page left
 * open across a run must not be pinned to a stale index by this cache.
 *
 * The archives are immutable, so the default browser cache is exactly right
 * here — unlike the manifest, which is fetched `no-store`.
 */
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
 * A region's entry: its rows, and the two counts the header prints.
 *
 * **An empty entry is a normal answer, not an error.** A country can have no
 * news in the window — 124 of ~250 had any at all (§2.4) — and Natural Earth
 * draws plenty of polygons GDELT never mentions. The panel says so rather than
 * treating it as a failure.
 *
 * **It reads two shapes on purpose.** The published value was a bare
 * `RegionStory[]` until 2026-08-16, and an index from before that is still
 * valid and still reachable: archives are kept by `KEEP_ARCHIVES`, runs are four
 * hours apart, and a browser can hold a manifest across a deploy. The legacy
 * form yields `total: 0`, which `RegionPanel` renders as **no counts line** —
 * not as "0 stories today". That distinction is the whole reason 0 is the
 * sentinel: a region that genuinely has nothing has no rows either, and gets the
 * empty-state note instead.
 *
 * This is the same argument that makes `regionsUrl` optional on the manifest. A
 * new field must never be able to break the map for a reader who has not
 * refreshed.
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

/**
 * A GKG stamp (`YYYYMMDDHHMMSS`, UTC) as milliseconds, or `NaN`.
 *
 * Parsed by field rather than handed to `Date.parse`, which reads that string as
 * an invalid date in every engine — and, worse, reads the 8-character prefix as a
 * LOCAL date in some. Both failure modes are silent.
 */
export function gkgToMillis(stamp: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp ?? "");
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/*
 * `storyAge` was here. It rendered "3h ago" for the region panel's old meta
 * line, lost its last caller when that line went, and was deleted on 2026-08-14
 * when the panels went relative — a second, differently-worded age formatter
 * with no callers is a trap for whoever writes the next list. `publishedAt` in
 * `lib/story.ts` is the one both panels use now, over `lib/age.ts`'s ladder.
 */
