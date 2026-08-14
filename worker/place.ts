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
 *       city mentioned once     ->  DROP                       (no real place)
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
 * **The weak-city DROP, added 2026-08-14 — the one shape that survived a judged
 * sample.** A city that is mentioned *once* is not evidence that the story is
 * about that city; it is evidence that GDELT scattered single mentions and the
 * rule picked whichever came first. The trace has said so since it existed
 * (`winnerMentions === 1`), and `place:audit` sized the shape at **29.5% of all
 * pins** — but frequency is not accuracy, and §5.2 decision 3 is the standing
 * reminder of what happens when the two are conflated. So the shape was left
 * alone and the independent judging sheet was built to test it.
 *
 * It tested. On the 90-record independent draw (`judged-c29ce-90`, §5.2
 * decision 4), pins whose city was mentioned once scored **36.4% correct (n=11)
 * against 77.8% for every other pin (n=36)**, Fisher exact p=0.023. The hand
 * audit's ten-record guess had been "~40% against ~82%", which is as close to a
 * confirmed out-of-sample prediction as this project has managed.
 *
 * **Three things about the shape of this rule are deliberate and each one is a
 * measurement, not a preference:**
 *
 * 1. **It fires only on `city-survives`, after both dominance margins.** A city
 *    x1 beside a country x3 is already `country-dominates` and already ships as
 *    a container at 83.3%. Testing weakness first would rewrite placements the
 *    audit judged and liked, on no evidence at all.
 * 2. **It applies to cities only, never to containers.** The same shape at
 *    container level scored **85.7% (n=7)** — better than containers overall.
 *    `winnerMentions === 1` is a *pin* pathology; a country mentioned once in a
 *    story with no other geography is usually just where the story is.
 * 3. **It DROPs rather than falling through to the adm1/country container.**
 *    Fall-through preserves volume and was the obvious alternative, so it was
 *    checked against the draw: of the weak-city pins, the ones with somewhere to
 *    fall to would have become `Praia, Cape Verde -> Germany x2`,
 *    `Dublin -> United Kingdom x2`, `Canberra -> Singapore x2`. A country
 *    mentioned twice under a one-mention city is the same noise one level up, and
 *    laundering it into a container would move the error out of the pin number
 *    and into the container number rather than removing it.
 *
 * **The cost is volume and it was accepted deliberately.** Measured on 1,397
 * filtered articles after the change: `weak-city` is **14.7% of all records and
 * 30.2% of what used to be pins** (205 against 473 surviving), which is the
 * 29.5% `place:audit` predicted before the rule existed. Steady state ~40,700
 * groups/day falls to roughly 34,700 — far inside the count band's
 * [2,000, 60,000] (`publish.ts`), so no invariant fires and nothing here is
 * self-concealing. What it buys is pins at **77.8% [61.9, 88.3]** against the
 * measured 68.1%: the band §5.1 calls "proceed as planned" rather than "proceed
 * with a disclosure". **That is a projection, not a result** — it is the old
 * draw with a subset removed, and only a fresh judged draw can confirm it.
 *
 * **This does not retire the disclosure.** §5.1's band is read off a measured
 * number, and until a new draw is judged the measured number is still 68.1%.
 *
 * **This does not license the next shape.** `tie-broken` looks similar in the
 * same draw (44.4% on n=9) and is NOT implemented, because n=9 is what
 * §5.2 decision 3 looked like right before it evaporated. It needs its own draw
 * — and it mostly went away on its own: tie-broken pins fell from 15.5% to 3.6%
 * when this rule landed, because a tie at one mention was the same population
 * seen twice. Whatever is left is 17 pins in 1,397 records and can wait.
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
 * How many times a city must be mentioned before it may hold a PIN.
 *
 * **2 is "more than once", not a tuned threshold**, and it is the only value the
 * evidence supports: the judged draw split pins at exactly x1 vs x2+ (36.4% vs
 * 77.8%), because that is the split the trace exposed and the judging sheet was
 * built to test. Raising it to 3 would be fitting a number to a result on data
 * that never measured 3 — the header explains why that is the one thing this
 * module must not do.
 */
export const MIN_CITY_MENTIONS = 2;

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
 *
 * `weak-city` is the third DROP and the only one that discards a placement the
 * rule could have made. Its share of the feed is the direct measure of what the
 * 2026-08-14 change costs — measured at 14.7% of records, 30.2% of former pins —
 * so it must stay separable from the two upstream DROPs, which cost nothing
 * because there was never anything to publish.
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
  /**
   * Mentions of the location actually chosen. 0 on a DROP — including
   * `weak-city`, where the count that caused the drop is still readable off
   * `city.mentions`. It cannot be 1 on a PIN any more; that combination is what
   * the weak-city DROP removed, and a `lone-mention` pin appearing in a future
   * `place:audit` run means this rule has been bypassed.
   */
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
