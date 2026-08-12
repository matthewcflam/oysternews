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
 */

import type { Article, GdeltLocation, Placement } from "@/lib/types";
import { ADM1_TYPES, CITY_TYPES, LOCATION_COUNTRY } from "@/lib/types";
import type { RefData } from "./refdata";

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

export function placeStory(article: Article, data: RefData): Placement {
  const locations = article.locations.filter((location) => !isDemonym(location.name, data));
  if (locations.length === 0) return { kind: "DROP", location: null };

  const mentions = new Map<string, number>();
  for (const location of locations) {
    mentions.set(location.name, (mentions.get(location.name) ?? 0) + 1);
  }

  const city = mostMentioned(
    locations.filter((l) => CITY.has(l.type)),
    mentions,
  );
  const adm1 = mostMentioned(
    locations.filter((l) => ADM1.has(l.type)),
    mentions,
  );
  const country = mostMentioned(
    locations.filter((l) => l.type === LOCATION_COUNTRY),
    mentions,
  );

  if (city) {
    const cityCount = mentions.get(city.name) ?? 0;
    if (adm1 && (mentions.get(adm1.name) ?? 0) >= ADM1_DOMINANCE * cityCount) {
      return { kind: "CONTAINER", location: adm1, regionId: regionIdFor(adm1) };
    }
    if (country && (mentions.get(country.name) ?? 0) >= COUNTRY_DOMINANCE * cityCount) {
      return { kind: "CONTAINER", location: country, regionId: regionIdFor(country) };
    }
    return { kind: "PIN", location: city };
  }

  if (adm1) return { kind: "CONTAINER", location: adm1, regionId: regionIdFor(adm1) };
  if (country) return { kind: "CONTAINER", location: country, regionId: regionIdFor(country) };
  return { kind: "DROP", location: null };
}
