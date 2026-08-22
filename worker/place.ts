/**
 * placeStory() — the single placement rule ("Rule H": specificity wins
 * unless it is dominated). PURE.
 *
 *   drop every location whose name is a demonym
 *   city, adm1, country := most-mentioned location of each level
 *   if a city exists:
 *       adm1    >= 2x the city  ->  CONTAINER at the adm1      (regional story)
 *       country >= 3x the city  ->  CONTAINER at the country   (national story)
 *       city mentioned once     ->  DROP                       (no real place)
 *       otherwise               ->  PIN at the city
 *   else adm1 -> CONTAINER, else country -> CONTAINER, else DROP
 *
 * Do not replace this with plain specificity-first or pure dominance — both
 * were tried and measured worse (54.1%/37.5% and ~75% country-collapse
 * respectively) against Rule H's 69.7% pins / 80.8% containers
 * out-of-sample. The weak-city DROP (a city mentioned exactly once) is a
 * separate, later-measured rule: those pins scored 36.4% vs 77.8% for
 * everything else, Fisher p=0.023, and it applies only to cities, only
 * after both dominance margins, and DROPs rather than falling through to a
 * container (verified: fall-through would have laundered the same noise
 * into the container number instead of removing it). Full abort-criterion
 * history, all measured tables, and the accepted volume cost:
 * docs/DESIGN.md#placement.
 *
 * `explainPlacement()` is the implementation; `placeStory()` just reads its
 * `.placement` field — kept as one function rather than a rule plus a
 * separate explainer so the trace can never silently drift from the
 * decision it explains.
 */

import type { Article, GdeltLocation, Placement } from "../lib/types.ts";
import { ADM1_TYPES, CITY_TYPES, LOCATION_COUNTRY } from "../lib/types.ts";
import type { RefData } from "./refdata.ts";

const CITY = new Set<number>(CITY_TYPES);
const ADM1 = new Set<number>(ADM1_TYPES);

/** Countries are structurally over-mentioned; states are not — see docs/DESIGN.md#rule-h-the-shipped-rule. */
export const ADM1_DOMINANCE = 2;
export const COUNTRY_DOMINANCE = 3;

/** 2 = "more than once" — the exact split the judged draw measured (36.4% vs 77.8%), not a tuned threshold. See docs/DESIGN.md#the-weak-city-drop-added-2026-08-14. */
export const MIN_CITY_MENTIONS = 2;

/**
 * The demonym trap: GDELT writes country demonyms bare (`Americans`) but
 * state demonyms with a suffix (`Texans, United States`). Matching the
 * whole FullName silently misses every US state — match the FIRST COMMA
 * SEGMENT instead.
 */
export function isDemonym(name: string, data: RefData): boolean {
  return data.demonyms.has(name.split(",")[0].trim().toLowerCase());
}

// Most-mentioned location of a level, ties broken by earliest mention.
// Counting is by NAME, not featureId: GDELT can emit different feature ids
// for the same place across mentions, which would split its own count.
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

// The id of the region a container represents. ADM1 codes already embed
// their country (USOR = Oregon) so they're globally unique as-is; country
// containers use the FIPS code. The two namespaces can't collide (FIPS = 2
// chars, ADM1 = 4).
export function regionIdFor(location: GdeltLocation): string {
  if (ADM1.has(location.type)) return location.adm1Code || location.countryCode;
  return location.countryCode;
}

/**
 * Which of the rule's branches produced the placement. `no-locations` and
 * `all-demonyms` are both DROPs but opposite findings — the first is GDELT
 * extracting nothing, the second is the demonym filter working — kept
 * separate so "the filter is too aggressive" can't hide inside a merged
 * count. `weak-city` is the only DROP that discards a placement the rule
 * could have made; see docs/DESIGN.md#the-weak-city-drop-added-2026-08-14.
 */
export type PlacementReason =
  | "no-locations"
  | "all-demonyms"
  | "no-usable-level"
  | "weak-city"
  | "city-survives"
  | "adm1-dominates"
  | "country-dominates"
  | "adm1-only"
  | "country-only";

/** The winner at one level, and what it beat. */
export type LevelCandidate = {
  name: string;
  /** GDELT type code. Type 3/4 is only ~71% cities — the rest are natural features, counties and landmarks, which is how an ocean gets pinned. */
  type: number;
  mentions: number;
  /** How many distinct names at this level tied at `mentions`. >1 means the winner was chosen by earliest offset, not by evidence. */
  tiedAtTop: number;
  /** Best name at this level *strictly below* the top count. Null when the level has only one distinct name, or all of them tie. */
  runnerUp: { name: string; mentions: number } | null;
};

/**
 * Why a story landed where it did. Deliberately not in `lib/types.ts` —
 * that file mirrors persisted/passed-on records, and this is one
 * function's account of its own decision, never persisted. `sourceCountry`
 * is deliberately not a field here: it's a real bias source (an outlet
 * mentioning its own country enough to fire `country-dominates`), but the
 * domain->country map belongs to `refdata` and joins downstream instead of
 * widening this rule's inputs.
 */
export type PlacementTrace = {
  placement: Placement;
  reason: PlacementReason;
  city: LevelCandidate | null;
  adm1: LevelCandidate | null;
  country: LevelCandidate | null;
  /** Mentions of the chosen location. 0 on a DROP (weak-city's cause is still readable off `city.mentions`). Cannot be 1 on a PIN — that's exactly what weak-city removed. */
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
    // Last, so that a dominated weak city is still a container rather than a
    // drop: both margins above were judged and cleared, and this rule may only
    // take away pins it has evidence about.
    if (city.mentions < MIN_CITY_MENTIONS) {
      return {
        ...context,
        winnerMentions: 0,
        tieBroken: false,
        placement: { kind: "DROP", location: null },
        reason: "weak-city",
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
