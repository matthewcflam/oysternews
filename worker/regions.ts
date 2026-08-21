/**
 * The per-region story index. PURE (HANDOFF.md §3.3).
 *
 * §2.3's region panel lists a country's or a state's top stories when its label
 * is clicked. **That question cannot be answered from the tiles**, which is why
 * this file exists rather than the browser querying what it already has: the
 * §2.4 budget bakes deferred stories into HIGHER-zoom tiles, so a country's tile
 * at world zoom physically does not contain them. Ask the map for Pakistan's
 * stories at z1.5 and it can honestly return one — the country-top floor pin —
 * and a panel built on that would call it Pakistan's top story list.
 *
 * So the index is computed here, over the whole ranked pool, and published
 * alongside the archive. It is correct at every zoom because it never consults a
 * zoom at all.
 *
 * **Two consequences worth stating rather than discovering.**
 *
 * 1. **The panel can show stories the map cannot.** A group whose `minzoom`
 *    landed above the z12 ceiling is in the pipeline and not on the map (§2.4
 *    overflow — 204 of 1467 on the first real run). It is still one of its
 *    region's top stories by §2.5, so it appears here. The panel is the only
 *    surface that can reach it.
 * 2. **It is still one content model** (§2.3). The ordering is `compareGroups`,
 *    unchanged — the same comparator the tile budget and the country floor use.
 *    Nothing here re-ranks, filters by tier-1, or classifies by topic.
 *
 * §2.6 applies as hard here as in the popup: **title, source, link. Never
 * article text.** `RegionStory` is the whole of what a panel can render, which
 * is what makes that enforceable rather than aspirational.
 */

import type { RegionEntry, RegionIndex, RegionStory, StoryGroup } from "../lib/types.ts";
import { compareGroups } from "./rank.ts";

/**
 * Re-exported so this module still reads as the owner of the index's shape while
 * the declarations live where the browser can reach them without a `.ts`-suffixed
 * import (§0). `lib/types.ts` carries the rules those two types encode.
 */
export type { RegionEntry, RegionIndex, RegionStory };

/**
 * How many stories a region keeps.
 *
 * Ten is a panel you can scan on a phone without scrolling forever, and it
 * bounds the payload: the index is roughly (countries + regions) × N entries,
 * and N is the only term anyone can turn.
 */
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
 * Build the index.
 *
 * **A story is filed under its country, its admin-1, and (when a resolver is
 * supplied) its continent**, so clicking "California", "United States" and
 * "North America" all find it. The three namespaces cannot collide — FIPS
 * country codes are two characters, admin-1 codes are four (see `place.ts`'s
 * `regionIdFor`), and continent ids are `CONT:XX` (`lib/continents.ts`) — so
 * one flat map serves all three levels.
 *
 * Sorted here rather than trusting the caller: `budget.ts` returns groups in
 * whatever order its tile walk produced, and a panel that silently depends on
 * an upstream sort is a bug waiting for someone to reorder a pipeline stage.
 *
 * **`total` and `sources` count the pool, not the rows (2026-08-16).** The panel
 * header says "248 stories today · 39 sources", and the rows are capped at ten,
 * so those two numbers cannot be derived from what is published — 68 of 163
 * regions in a measured run exceed the cap, and the largest holds 977. They are
 * therefore counted here, over every group filed under the key, and the cap is
 * applied only to `stories`. That is the whole reason the value stopped being a
 * bare array.
 *
 * The domain set is dropped before the entry is returned: it is the counting
 * apparatus, not a field. Publishing 39 domain strings per region to render the
 * number 39 would multiply the index's size for no reader.
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

/**
 * Regions covered, and the total rows — what the run summary reports.
 *
 * **No compatibility shim here, deliberately.** It is handed the index this
 * module just built, which is always the current shape; the legacy bare-array
 * form can only reach a *browser*, holding a manifest from before this change.
 * That normalisation lives in `lib/regions.ts` alone, where it can be reached,
 * rather than in two copies of which one gets fixed.
 */
export function indexStats(index: RegionIndex): { regions: number; rows: number } {
  const entries = Object.values(index) as RegionEntry[];
  return {
    regions: entries.length,
    rows: entries.reduce((total, entry) => total + entry.stories.length, 0),
  };
}
