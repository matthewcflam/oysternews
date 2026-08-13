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

import type { StoryGroup } from "../lib/types.ts";
import { compareGroups } from "./rank.ts";

/**
 * How many stories a region keeps.
 *
 * Ten is a panel you can scan on a phone without scrolling forever, and it
 * bounds the payload: the index is roughly (countries + regions) × N entries,
 * and N is the only term anyone can turn.
 */
export const REGION_TOP_N = 10;

/**
 * One row in the panel. §2.6 link-out only — this type IS the constraint.
 *
 * Deliberately not `StoryGroup`: publishing the group wholesale would ship
 * salience, tier-1 flags and coordinates the panel has no business rendering,
 * and would put a tier-1 badge one line of JSX away from existing, which §2.3
 * forbids.
 */
export type RegionStory = {
  title: string;
  /** The publishing domain, shown as the source. */
  source: string;
  url: string;
  /** Newest article in the group, GKG stamp — drives the relative freshness line. */
  date: string;
  /** Where the story sits, for the panel's second line. */
  place: string;
};

/** region id (`PK`, `USCA`) -> its top stories, best first. */
export type RegionIndex = Record<string, RegionStory[]>;

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
 * **A story is filed under both its country and its admin-1**, so clicking
 * "California" and clicking "United States" both find it. The two namespaces
 * cannot collide — FIPS country codes are two characters and admin-1 codes are
 * four (see `place.ts`'s `regionIdFor`) — so one flat map serves both levels.
 *
 * Sorted here rather than trusting the caller: `budget.ts` returns groups in
 * whatever order its tile walk produced, and a panel that silently depends on
 * an upstream sort is a bug waiting for someone to reorder a pipeline stage.
 */
export function buildRegionIndex(groups: StoryGroup[], topN = REGION_TOP_N): RegionIndex {
  const index: RegionIndex = {};

  const add = (key: string, group: StoryGroup) => {
    if (!key) return;
    const rows = (index[key] ??= []);
    // Bounded as we go rather than sliced at the end: the pool is ~40,700
    // groups at a full window and most of them belong to one of four countries.
    if (rows.length < topN) rows.push(rowOf(group));
  };

  for (const group of [...groups].sort(compareGroups)) {
    add(group.countryCode, group);
    // Skipped when the admin-1 code IS the country code, which regionIdFor
    // produces for a country container — filing it twice would make a country's
    // own key appear to be an admin-1 region.
    if (group.adm1 && group.adm1 !== group.countryCode) add(group.adm1, group);
  }

  return index;
}

/** Regions covered, and the total rows — what the run summary reports. */
export function indexStats(index: RegionIndex): { regions: number; rows: number } {
  const keys = Object.keys(index);
  return {
    regions: keys.length,
    rows: keys.reduce((total, key) => total + index[key].length, 0),
  };
}
