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

import type { RegionIndex, RegionStory } from "./types";

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

/**
 * A region's stories, or an empty list.
 *
 * **An empty list is a normal answer, not an error.** A country can have no news
 * in the window — 124 of ~250 had any at all (§2.4) — and Natural Earth draws
 * plenty of polygons GDELT never mentions. The panel says so rather than
 * treating it as a failure.
 */
export function storiesFor(index: RegionIndex | null, regionId: string): RegionStory[] {
  if (!index || !regionId) return [];
  return index[regionId] ?? [];
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
