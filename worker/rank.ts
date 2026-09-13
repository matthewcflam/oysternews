import type { PlacedArticle, StoryGroup } from "../src/lib/types.ts";

export const SOURCE_COUNTRY_WEIGHT = 0.5;

export const TIER1_WINDOW_HOURS = 48;
export const GENERAL_WINDOW_HOURS = 24;

export function parseGkgDate(date: string): number {
  if (!/^\d{14}$/.test(date)) return Number.NaN;
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(date.slice(8, 10)),
    Number(date.slice(10, 12)),
    Number(date.slice(12, 14)),
  );
}

export function salienceOf(distinctDomains: number, distinctSourceCountries: number): number {
  return Math.log1p(distinctDomains) + SOURCE_COUNTRY_WEIGHT * Math.log1p(distinctSourceCountries);
}

export function summarise(members: PlacedArticle[], now: number): {
  distinctDomains: number;
  distinctSourceCountries: number;
  salience: number;
  tier1Fresh: boolean;
  newestTier1: string;
  newestArticle: string;
} {
  const domains = new Set<string>();
  const countries = new Set<string>();
  let newestTier1 = "";
  let newestArticle = "";

  for (const member of members) {
    domains.add(member.domain);
    if (member.sourceCountry) countries.add(member.sourceCountry);

    if (member.date > newestArticle) newestArticle = member.date;
    if (member.tier1 && member.date > newestTier1) newestTier1 = member.date;
  }

  // Clock from NEWEST tier-1 article: follow-ups renew the 48-hour window.
  const tier1Fresh =
    newestTier1 !== "" &&
    now - parseGkgDate(newestTier1) <= TIER1_WINDOW_HOURS * 3600 * 1000;

  return {
    distinctDomains: domains.size,
    distinctSourceCountries: countries.size,
    salience: salienceOf(domains.size, countries.size),
    tier1Fresh,
    newestTier1,
    newestArticle,
  };
}

export function compareGroups(a: StoryGroup, b: StoryGroup): number {
  if (a.tier1Fresh !== b.tier1Fresh) return a.tier1Fresh ? -1 : 1;
  if (a.salience !== b.salience) return b.salience - a.salience;
  if (a.newestTier1 !== b.newestTier1) return a.newestTier1 < b.newestTier1 ? 1 : -1;
  // Total order by id: reproducible across runs, prevents flicker.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function rankGroups(groups: StoryGroup[]): StoryGroup[] {
  return [...groups].sort(compareGroups);
}
