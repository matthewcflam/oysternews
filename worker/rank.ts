/**
 * Ranking. PURE (HANDOFF.md §3.3).
 *
 *   salience = log1p(distinct_domains) + 0.5 * log1p(distinct_source_countries)
 *
 * Log because both distributions are heavy-tailed; domains weighted 2:1 over
 * countries. Source-country count says a story crossed borders. It is a RANKING
 * signal and never routes a story anywhere — there is one content model (§2.3).
 *
 * **Tier-1 priority is part of this comparator, not a filter, a badge or a
 * fourth UI state.** Selection sorts lexicographically on:
 *
 *   (tier1_fresh DESC, salience DESC, newest_tier1_article DESC)
 *
 * That single ordering produces all three behaviours §2.5 asks for with no
 * timers and no per-area state:
 *
 *   - a tier-1 story keeps its slot, because it stays tier-1-fresh for 48 hours
 *     after its newest tier-1 article and every run re-selects it;
 *   - only another tier-1 story can take it, because the non-tier-1 population
 *     cannot reach the first key at all;
 *   - after 48 quiet hours the class empties by itself and top-K fills from
 *     salience alone — which is the SAME code path as an area that never had
 *     tier-1 coverage. "Fall back" and "never had any" are not special-cased.
 *
 * What it costs, stated plainly (§2.5): in a crowded US or UK tile a Newsweek
 * story now outranks a genuinely bigger story from a lower-tier domain. That is
 * the trade, bought on purpose.
 */

import type { PlacedArticle, StoryGroup } from "../lib/types.ts";

/** §2.5's weight on the border-crossing term, half of the domain term. */
export const SOURCE_COUNTRY_WEIGHT = 0.5;

/** §2.5 / §3.5: tier-1 articles stay eligible for 48 hours, everything else 24. */
export const TIER1_WINDOW_HOURS = 48;
export const GENERAL_WINDOW_HOURS = 24;

/** GKG dates are YYYYMMDDHHMMSS in UTC. */
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

/**
 * Summarise a group's members into the ranked fields.
 *
 * `now` is passed in rather than read from the clock, because the 48-hour
 * freshness test is the one piece of logic in this module that could otherwise
 * only be tested by waiting.
 *
 * **Salience is computed over the group's eligible articles — the full 48 hours
 * for a carried-over tier-1 group** (§2.5). The asymmetry against the 24-hour
 * general window distorts nothing, because the two classes never compete on
 * salience: cross-class order is settled by the first key.
 */
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
    // "" means the domain could not be resolved. Excluded rather than bucketed:
    // bucketing would give every unresolved publisher a shared nationality.
    if (member.sourceCountry) countries.add(member.sourceCountry);

    if (member.date > newestArticle) newestArticle = member.date;
    if (member.tier1 && member.date > newestTier1) newestTier1 = member.date;
  }

  // §6 decision 10: the clock runs from the NEWEST tier-1 article. Against the
  // oldest, a story a tier-1 outlet is still actively covering would expire
  // mid-coverage; newest means a follow-up piece renews the 48 hours, which
  // reads as the same story continuing.
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

/**
 * The §2.5 comparator. Negative when `a` should be selected before `b`, so it
 * can be handed straight to Array.prototype.sort.
 */
export function compareGroups(a: StoryGroup, b: StoryGroup): number {
  if (a.tier1Fresh !== b.tier1Fresh) return a.tier1Fresh ? -1 : 1;
  if (a.salience !== b.salience) return b.salience - a.salience;
  if (a.newestTier1 !== b.newestTier1) return a.newestTier1 < b.newestTier1 ? 1 : -1;
  // Total order, so selection is reproducible run to run. Without this, two
  // groups with identical scores could swap places between runs and make the
  // map flicker for no reason.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function rankGroups(groups: StoryGroup[]): StoryGroup[] {
  return [...groups].sort(compareGroups);
}
