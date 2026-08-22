/**
 * The per-region story index (computed over the whole ranked pool, not the
 * tiles — a region's tile at world zoom does not contain most of its
 * stories). See docs/DESIGN.md#regions.
 */

import type { RegionEntry, RegionIndex, RegionStory, StoryGroup } from "../lib/types.ts";
import { compareGroups } from "./rank.ts";

// Re-exported so this module reads as the owner of the index's shape;
// declarations live in lib/types.ts (docs/DESIGN.md#the-ts-extension-import-rule).
export type { RegionEntry, RegionIndex, RegionStory };

/** Rows kept per region. See docs/DESIGN.md#regions. */
export const REGION_TOP_N = 10;

function rowOf(group: StoryGroup): RegionStory {
  return {
    title: group.title,
    source: group.domain,
    url: group.url,
    date: group.newestArticle,
    place: group.placeName,
  };
}

/**
 * Files a story under its country, its admin-1, and (when a resolver is
 * supplied) its continent — one flat map, since the three id namespaces
 * cannot collide (FIPS country = 2 chars, adm1 = 4, continent = `CONT:XX`).
 * `total`/`sources` count the whole pool, not just the capped `stories`
 * rows. See docs/DESIGN.md#regions.
 */
export function buildRegionIndex(
  groups: StoryGroup[],
  topN = REGION_TOP_N,
  /**
   * A group's country FIPS -> its continent id, or "" for "file nowhere". No
   * default beyond "file no continent key at all" — a caller that does not
   * pass one (every existing test, `worker/run.ts` before §4) gets exactly
   * today's two-level index, not a silently empty third level.
   */
  continentOf: (countryCode: string) => string = () => "",
  /*
   * The return type is the NARROW one, not `RegionIndex`. `RegionIndex` is a
   * union that includes the legacy bare-array form because that is what a
   * browser may *read*; nothing writes it any more, and typing the builder as
   * the union would force every caller and every test to narrow a shape this
   * function can never produce.
   */
): Record<string, RegionEntry> {
  const index: Record<string, RegionEntry> = {};
  const domains = new Map<string, Set<string>>();

  const add = (key: string, group: StoryGroup) => {
    if (!key) return;
    const entry = (index[key] ??= { stories: [], total: 0, sources: 0 });
    entry.total += 1;
    // A group with no domain is counted as a story and not as a source. It has
    // no publisher to be distinct from, and `""` would otherwise read as one.
    if (group.domain) {
      (domains.get(key) ?? domains.set(key, new Set()).get(key)!).add(group.domain);
    }
    // Bounded as we go rather than sliced at the end: the pool is ~40,700
    // groups at a full window and most of them belong to one of four countries.
    if (entry.stories.length < topN) entry.stories.push(rowOf(group));
  };

  for (const group of [...groups].sort(compareGroups)) {
    add(group.countryCode, group);
    // Skipped when the admin-1 code IS the country code, which regionIdFor
    // produces for a country container — filing it twice would make a country's
    // own key appear to be an admin-1 region.
    if (group.adm1 && group.adm1 !== group.countryCode) add(group.adm1, group);
    add(continentOf(group.countryCode), group);
  }

  for (const [key, set] of domains) index[key].sources = set.size;

  return index;
}

// Regions covered and total rows, for the run summary. No legacy bare-array
// shim here — this always sees the current shape; that normalisation lives
// in lib/regions.ts, which is what a browser holding an old manifest reaches.
export function indexStats(index: RegionIndex): { regions: number; rows: number } {
  const entries = Object.values(index) as RegionEntry[];
  return {
    regions: entries.length,
    rows: entries.reduce((total, entry) => total + entry.stories.length, 0),
  };
}
