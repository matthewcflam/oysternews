import type { RegionEntry, RegionIndex, RegionStory, StoryGroup } from "../src/lib/types.ts";
import { compareGroups } from "./rank.ts";

export type { RegionEntry, RegionIndex, RegionStory };

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

export function buildRegionIndex(
  groups: StoryGroup[],
  topN = REGION_TOP_N,
  continentOf: (countryCode: string) => string = () => ""
): Record<string, RegionEntry> {
  const index: Record<string, RegionEntry> = {};
  const domains = new Map<string, Set<string>>();

  const add = (key: string, group: StoryGroup) => {
    if (!key) return;
    index[key] ??= { stories: [], total: 0, sources: 0 };
    const entry = index[key];
    entry.total += 1;
    if (group.domain) {
      (domains.get(key) ?? domains.set(key, new Set()).get(key)!).add(group.domain);
    }
    if (entry.stories.length < topN) entry.stories.push(rowOf(group));
  };

  for (const group of [...groups].sort(compareGroups)) {
    add(group.countryCode, group);
    // Skip if adm1 === countryCode (country containers): file once, not twice.
    if (group.adm1 && group.adm1 !== group.countryCode) add(group.adm1, group);
    add(continentOf(group.countryCode), group);
  }

  for (const [key, set] of domains) index[key].sources = set.size;

  return index;
}

export function indexStats(index: RegionIndex): { regions: number; rows: number } {
  const entries = Object.values(index) as RegionEntry[];
  return {
    regions: entries.length,
    rows: entries.reduce((total, entry) => total + entry.stories.length, 0),
  };
}
