import type { Article, GdeltLocation, Placement } from "../src/lib/types.ts";
import { ADM1_TYPES, CITY_TYPES, LOCATION_COUNTRY } from "../src/lib/types.ts";
import type { RefData } from "./refdata.ts";

const CITY = new Set<number>(CITY_TYPES);
const ADM1 = new Set<number>(ADM1_TYPES);

export const ADM1_DOMINANCE = 2;
export const COUNTRY_DOMINANCE = 3;

export const MIN_CITY_MENTIONS = 2;

// GDELT writes country demonyms bare ("Americans") but state demonyms with a suffix
// ("Texans, United States"): match the first comma segment, or every US state is missed.
export function isDemonym(name: string, data: RefData): boolean {
  return data.demonyms.has(name.split(",")[0].trim().toLowerCase());
}

// Counted by NAME, not featureId: GDELT emits different feature ids for the same place,
// which would split its count. Ties go to the earliest mention.
function mostMentioned(
  candidates: GdeltLocation[],
  mentions: Map<string, number>
): GdeltLocation | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((winner, candidate) => {
    const a = mentions.get(candidate.name) ?? 0;
    const b = mentions.get(winner.name) ?? 0;
    if (a !== b) return a > b ? candidate : winner;
    return candidate.offset < winner.offset ? candidate : winner;
  });
}

export function regionIdFor(location: GdeltLocation): string {
  if (ADM1.has(location.type)) return location.adm1Code || location.countryCode;
  return location.countryCode;
}

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

export type LevelCandidate = {
  name: string;
  type: number;
  mentions: number;
  tiedAtTop: number;
  runnerUp: { name: string; mentions: number } | null;
};

export type PlacementTrace = {
  placement: Placement;
  reason: PlacementReason;
  city: LevelCandidate | null;
  adm1: LevelCandidate | null;
  country: LevelCandidate | null;
  winnerMentions: number;
  tieBroken: boolean;
  adm1Ratio: number | null;
  countryRatio: number | null;
  distinctLocations: number;
  totalMentions: number;
  demonymsDropped: number;
};

function summarize(
  candidates: GdeltLocation[],
  mentions: Map<string, number>
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
    // Last, so a dominated weak city still becomes a container rather than a drop.
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
