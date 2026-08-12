/**
 * Filtering. PURE (HANDOFF.md §3.3).
 *
 * Everything a record has to survive before placement is decided. Two ordering
 * facts matter more than the code:
 *
 * - **The blocklist runs before the tier-1 check** (§5). No domain is on both
 *   lists today — worker/refdata.ts asserts that — so this is a guarantee
 *   against a future edit, not a live fix. A blocklisted domain can never make
 *   a group tier-1-fresh.
 * - **The demonym filter runs before placement**, and it lives in place.ts
 *   because it operates on locations rather than on the record. It is mentioned
 *   here only so that reading this file does not imply it was forgotten.
 *
 * English-only is NOT a filter here. §2.6 achieves it by consuming
 * `lastupdate.txt` and not `lastupdate-translation.txt` — the choice of feed,
 * made in fetch.ts. It is "approximately English, not exactly", and no
 * per-record language test would improve that.
 */

import type { Article } from "../lib/types.ts";
import { CITY_TYPES, ADM1_TYPES, LOCATION_COUNTRY } from "../lib/types.ts";
import type { RefData } from "./refdata.ts";

export type FilterResult = {
  kept: Article[];
  blocked: number;
  noLocation: number;
};

const PLACEABLE_TYPES = new Set<number>([...CITY_TYPES, ...ADM1_TYPES, LOCATION_COUNTRY]);

/**
 * A record is placeable if it carries at least one location of a type §2.1 knows
 * how to use. Types outside 1-5 exist in the wild and are not placeable.
 *
 * This does NOT check for demonyms. A record whose only locations are demonyms
 * passes here and is dropped by placeStory(), which is the module that owns that
 * rule — 11.9% of location mentions are demonyms, so the two-stage drop is
 * measured, not theoretical.
 */
export function hasUsableLocation(article: Article): boolean {
  return article.locations.some((location) => PLACEABLE_TYPES.has(location.type));
}

export function isBlocked(domain: string, data: RefData): boolean {
  return data.blocklist.has(domain.trim().toLowerCase());
}

export function filterArticles(articles: Article[], data: RefData): FilterResult {
  const result: FilterResult = { kept: [], blocked: 0, noLocation: 0 };

  for (const article of articles) {
    if (isBlocked(article.domain, data)) {
      result.blocked++;
      continue;
    }
    if (!hasUsableLocation(article)) {
      result.noLocation++;
      continue;
    }
    result.kept.push(article);
  }

  return result;
}
