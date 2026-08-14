/**
 * placeStory() — the single placement rule. PURE (HANDOFF.md §3.3).
 *
 * §2.1, Rule H: **specificity wins unless it is dominated.**
 *
 *   drop every location whose name is a demonym
 *   city, adm1, country := most-mentioned location of each level
 *   if a city exists:
 *       adm1    >= 2x the city  ->  CONTAINER at the adm1      (regional story)
 *       country >= 3x the city  ->  CONTAINER at the country   (national story)
 *       otherwise               ->  PIN at the city
 *   else adm1 -> CONTAINER, else country -> CONTAINER, else DROP
 *
 * **Do not replace this with plain specificity-first.** That was the original
 * spec, it scored 54.1% on pins [41.7, 66.0] and 37.5% on containers, and it
 * failed §5.1's pre-registered abort criterion outright — a city mentioned ONCE
 * beat a state mentioned FOUR times (Chicago x1 over Minnesota x4). Nor should
 * it become pure dominance, which overcorrects and sends ~75% of stories to
 * country containers because a domestic article names its own country
 * constantly. Rule H scores 69.7% on pins [52.7, 82.6] and 80.8% on containers
 * out-of-sample. The two margins differ for that reason and are not a knob.
 *
 * ---
 *
 * **`explainPlacement()` is the implementation; `placeStory()` reads its answer.**
 * The rule is eight branches over a handful of counts, so every placement it has
 * ever made is fully explainable from its inputs — but only if the explanation
 * and the decision are the same code. A separate "explainer" walking the same
 * logic is a second implementation that drifts, and it would drift *silently*,
 * because nothing downstream compares them. So the trace is computed once and
 * the placement is a field on it.
 *
 * This exists because the audit's failure taxonomy could not be read off the
 * output. 15 wrong rule-H placements were classified by hand, and the classes
 * turned out to be mechanically distinct in ways `{kind, location}` cannot show:
 * a story whose locations are *all mentioned once* (the rule picks a confident
 * winner from noise) looks identical to one with a real, dominant place. See
 * `winnerMentions` and `tieBroken`.
 */

import type { Article, GdeltLocation, Placement } from "../lib/types.ts";
import { ADM1_TYPES, CITY_TYPES, LOCATION_COUNTRY } from "../lib/types.ts";
import type { RefData } from "./refdata.ts";

const CITY = new Set<number>(CITY_TYPES);
const ADM1 = new Set<number>(ADM1_TYPES);

/** §2.1's margins. Countries are structurally over-mentioned; states are not. */
export const ADM1_DOMINANCE = 2;
export const COUNTRY_DOMINANCE = 3;

/**
 * **The demonym trap.** GDELT writes country demonyms bare (`Americans`) but
 * state demonyms with a suffix (`Texans, United States`). Matching the whole
 * FullName against the list — the obvious implementation — silently misses every
 * US state. Match the FIRST COMMA SEGMENT. 11.9% of all location mentions are
 * demonyms (FINDINGS §10).
 */
export function isDemonym(name: string, data: RefData): boolean {
  return data.demonyms.has(name.split(",")[0].trim().toLowerCase());
}

/**
 * Most-mentioned location of a level, ties broken by earliest mention.
 *
 * Counting is by NAME, not featureId: GDELT emits one entry per mention and the
 * same place can carry different feature ids across mentions, which would split
 * a location's own count against itself.
 */
function mostMentioned(
  candidates: GdeltLocation[],
  mentions: Map<string, number>,
): GdeltLocation | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((winner, candidate) => {
    const a = mentions.get(candidate.name) ?? 0;
    const b = mentions.get(winner.name) ?? 0;
    if (a !== b) return a > b ? candidate : winner;
    return candidate.offset < winner.offset ? candidate : winner;
  });
}

/**
 * The id of the region a container represents.
 *
 * ADM1 codes already embed their country (`USOR` = Oregon), so they are unique
 * globally and can be used as-is. Country containers use the FIPS code. The two
 * namespaces cannot collide: FIPS country codes are two characters and ADM1
 * codes are four.
 */
export function regionIdFor(location: GdeltLocation): string {
  if (ADM1.has(location.type)) return location.adm1Code || location.countryCode;
  return location.countryCode;
}

/**
 * Which of the rule's eight branches produced the placement.
 *
 * `no-locations` and `all-demonyms` are both DROPs and both returned `null` from
 * the old code, but they are opposite findings: the first is GDELT extracting
 * nothing, the second is the demonym filter working (11.9% of mentions are
 * demonyms, §2.1). Collapsing them is how "the filter is too aggressive" would
 * hide.
 */
export type PlacementReason =
  | "no-locations"
  | "all-demonyms"
  | "no-usable-level"
  | "city-survives"
  | "adm1-dominates"
  | "country-dominates"
  | "adm1-only"
  | "country-only";

/** The winner at one level, and what it beat. */
export type LevelCandidate = {
  name: string;
  /** GDELT type code. Type 3/4 is only 70.7% cities — the rest are natural features, counties and landmarks (§2.1), which is how an ocean gets pinned. */
  type: number;
  mentions: number;
  /** How many distinct names at this level tied at `mentions`. >1 means the winner was chosen by earliest offset, not by evidence. */
  tiedAtTop: number;
  /** Best name at this level *strictly below* the top count. Null when the level has only one distinct name, or all of them tie. */
  runnerUp: { name: string; mentions: number } | null;
};

/**
 * Why a story landed where it did.
 *
 * Deliberately **not** in `lib/types.ts`. That file is 1:1 with the eventual
 * `articles` table (§3.1) and holds records that flow between modules; this is
 * one function's account of its own decision and is never persisted or passed
 * on. Putting it there would imply it is a column.
 *
 * `sourceCountry` is not here on purpose. Source-country bias — an Indian outlet
 * mentioning India 12 times against Seoul's 2, so `country-dominates` fires on a
 * match played in Seoul — is a real failure class, but the domain->country map
 * is `refdata`'s and `PlacedArticle` already carries `sourceCountry`. Join it
 * downstream rather than widening the placement rule's inputs.
 */
export type PlacementTrace = {
  placement: Placement;
  reason: PlacementReason;
  city: LevelCandidate | null;
  adm1: LevelCandidate | null;
  country: LevelCandidate | null;
  /** Mentions of the location actually chosen. 0 on a DROP. **1 means the winner was mentioned once** — the signature of a story with no real place. */
  winnerMentions: number;
  /** The chosen location tied at the top of its level and won on offset alone. */
  tieBroken: boolean;
  /** adm1 mentions / city mentions. Compare against ADM1_DOMINANCE to see how near a miss it was. Null when either level is absent. */
  adm1Ratio: number | null;
  /** country mentions / city mentions, against COUNTRY_DOMINANCE. */
  countryRatio: number | null;
  /** Distinct surviving location names. */
  distinctLocations: number;
  /** Surviving mentions in total. */
  totalMentions: number;
  /** Locations removed by the demonym filter. */
  demonymsDropped: number;
};

/** Winner at a level plus the shape of the contest it won. */
function summarize(
  candidates: GdeltLocation[],
  mentions: Map<string, number>,
): LevelCandidate | null {
  const winner = mostMentioned(candidates, mentions);
  if (!winner) return null;

  const top = mentions.get(winner.name) ?? 0;
  const seen = new Set<string>();
  let tiedAtTop = 0;
  let runnerUp: { name: string; mentions: number } | null = null;

  for (const candidate of candidates) {
    if (seen.has(candidate.name)) continue;
    seen.add(candidate.name);
    const n = mentions.get(candidate.name) ?? 0;
    if (n === top) tiedAtTop++;
    else if (!runnerUp || n > runnerUp.mentions) runnerUp = { name: candidate.name, mentions: n };
  }

  return { name: winner.name, type: winner.type, mentions: top, tiedAtTop, runnerUp };
}

export function explainPlacement(article: Article, data: RefData): PlacementTrace {
  const locations = article.locations.filter((location) => !isDemonym(location.name, data));
  const demonymsDropped = article.locations.length - locations.length;

  const empty = {
    city: null,
    adm1: null,
    country: null,
    winnerMentions: 0,
    tieBroken: false,
    adm1Ratio: null,
    countryRatio: null,
    distinctLocations: 0,
    totalMentions: 0,
    demonymsDropped,
  } as const;

  if (locations.length === 0) {
    return {
      ...empty,
      placement: { kind: "DROP", location: null },
      reason: article.locations.length === 0 ? "no-locations" : "all-demonyms",
    };
  }

  const mentions = new Map<string, number>();
  for (const location of locations) {
    mentions.set(location.name, (mentions.get(location.name) ?? 0) + 1);
  }

  const cityLocs = locations.filter((l) => CITY.has(l.type));
  const adm1Locs = locations.filter((l) => ADM1.has(l.type));
  const countryLocs = locations.filter((l) => l.type === LOCATION_COUNTRY);

  const city = summarize(cityLocs, mentions);
  const adm1 = summarize(adm1Locs, mentions);
  const country = summarize(countryLocs, mentions);

  const context = {
    city,
    adm1,
    country,
    adm1Ratio: city && adm1 ? adm1.mentions / city.mentions : null,
    countryRatio: city && country ? country.mentions / city.mentions : null,
    distinctLocations: mentions.size,
    totalMentions: locations.length,
    demonymsDropped,
  };

  /** The chosen level's winner, and whether it only won on offset. */
  const won = (level: LevelCandidate) => ({
    winnerMentions: level.mentions,
    tieBroken: level.tiedAtTop > 1,
  });

  if (city) {
    if (adm1 && adm1.mentions >= ADM1_DOMINANCE * city.mentions) {
      const location = mostMentioned(adm1Locs, mentions)!;
      return {
        ...context,
        ...won(adm1),
        placement: { kind: "CONTAINER", location, regionId: regionIdFor(location) },
        reason: "adm1-dominates",
      };
    }
    if (country && country.mentions >= COUNTRY_DOMINANCE * city.mentions) {
      const location = mostMentioned(countryLocs, mentions)!;
      return {
        ...context,
        ...won(country),
        placement: { kind: "CONTAINER", location, regionId: regionIdFor(location) },
        reason: "country-dominates",
      };
    }
    return {
      ...context,
      ...won(city),
      placement: { kind: "PIN", location: mostMentioned(cityLocs, mentions)! },
      reason: "city-survives",
    };
  }

  if (adm1) {
    const location = mostMentioned(adm1Locs, mentions)!;
    return {
      ...context,
      ...won(adm1),
      placement: { kind: "CONTAINER", location, regionId: regionIdFor(location) },
      reason: "adm1-only",
    };
  }
  if (country) {
    const location = mostMentioned(countryLocs, mentions)!;
    return {
      ...context,
      ...won(country),
      placement: { kind: "CONTAINER", location, regionId: regionIdFor(location) },
      reason: "country-only",
    };
  }

  return {
    ...context,
    winnerMentions: 0,
    tieBroken: false,
    placement: { kind: "DROP", location: null },
    reason: "no-usable-level",
  };
}

export function placeStory(article: Article, data: RefData): Placement {
  return explainPlacement(article, data).placement;
}
