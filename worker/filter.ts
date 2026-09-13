import type { Article } from "../src/lib/types.ts";
import { CITY_TYPES, ADM1_TYPES, LOCATION_COUNTRY } from "../src/lib/types.ts";
import type { RefData } from "./refdata.ts";

export type FilterResult = {
  kept: Article[];
  blocked: number;
  noLocation: number;
};

const PLACEABLE_TYPES = new Set<number>([...CITY_TYPES, ...ADM1_TYPES, LOCATION_COUNTRY]);

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
