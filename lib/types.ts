/**
 * The record shapes the worker passes between modules.
 *
 * HANDOFF.md §3.1 keeps this file 1:1 with the eventual `articles` table: there
 * is no database today, and the reason that is affordable is that the shape of
 * the data is written down here rather than implied by whatever each module
 * happens to construct. If Postgres arrives (§10), this is the schema.
 *
 * Everything here is data, not behaviour. The pure modules in worker/ transform
 * one of these into another; none of them own a type.
 */

/** GDELT V2EnhancedLocations type codes. */
export const LOCATION_COUNTRY = 1;
export const LOCATION_US_STATE = 2;
export const LOCATION_US_CITY = 3;
export const LOCATION_WORLD_CITY = 4;
export const LOCATION_ADM1 = 5;

/** City-level: 3 and 4. Measured at 70.7% cities, the rest natural features, counties and landmarks (§2.1). */
export const CITY_TYPES: readonly number[] = [LOCATION_US_CITY, LOCATION_WORLD_CITY];
/** Admin-1: US states (2) and world admin-1 (5). */
export const ADM1_TYPES: readonly number[] = [LOCATION_US_STATE, LOCATION_ADM1];

export type GdeltLocation = {
  type: number;
  /** GDELT's FullName, e.g. "Portland, Oregon, United States" or bare "Americans". */
  name: string;
  /** **FIPS 10-4**, not ISO 3166. See §3.4 — RS is Russia, CH is China. */
  countryCode: string;
  /** FIPS admin-1 code, country code included, e.g. "USOR". */
  adm1Code: string;
  lat: number;
  lon: number;
  /** GDELT's feature id. Stable per place, unlike the name. */
  featureId: string;
  /** Character offset of the mention in the article; ties in placement break on the earliest. */
  offset: number;
};

/**
 * One GDELT record: one article, as parsed. `themes` and `locations` are the
 * only multi-valued fields the project reads — V2GCAM is 69.4% of the bytes and
 * is never materialized (§3.2).
 */
export type Article = {
  /** GKG DATE, YYYYMMDDHHMMSS, UTC. */
  date: string;
  /** SourceCommonName — a bare domain, lowercased. */
  domain: string;
  /** DocumentIdentifier — the article URL. */
  url: string;
  /** From V2EXTRASXML PAGE_TITLE, HTML-entity-unescaped. Present on 99.7% of records (§4). */
  title: string;
  /** V2EnhancedThemes, offsets stripped. */
  themes: string[];
  locations: GdeltLocation[];
};

/** Where §2.1's placeStory() puts a story. */
export type PlacementKind = "PIN" | "CONTAINER" | "DROP";

export type Placement =
  | { kind: "PIN"; location: GdeltLocation }
  | { kind: "CONTAINER"; location: GdeltLocation; regionId: string }
  | { kind: "DROP"; location: null };

/**
 * An article that survived filtering and placement. This is the unit that gets
 * written to a state shard, so it must stay small — a 24-hour window is ~40,700
 * of these (§4) and they are re-read every run.
 */
export type PlacedArticle = {
  date: string;
  domain: string;
  url: string;
  title: string;
  themes: string[];
  lat: number;
  lon: number;
  /** PIN or CONTAINER. A DROP never becomes a PlacedArticle. */
  kind: "PIN" | "CONTAINER";
  /** FIPS country code of the placement. */
  countryCode: string;
  /** For containers: the region this pin represents. Empty for pins. */
  regionId: string;
  /** Display name of the place, for debugging and the container label. */
  placeName: string;
  /** ISO country of the *publisher*, inferred from the domain. "" when unknown. */
  sourceCountry: string;
  /** Whether `domain` is in data/tier1-domains (§2.5). */
  tier1: boolean;
};

/**
 * A group of articles the §2.5 grouping rule considers the same story. This is
 * what gets ranked, budgeted and tiled — never the individual article.
 */
export type StoryGroup = {
  /** Stable id derived from the group's members, so a group keeps its identity across runs. */
  id: string;
  /** The representative article: highest-ranked member by the §2.5 comparator. */
  title: string;
  url: string;
  domain: string;
  lat: number;
  lon: number;
  kind: "PIN" | "CONTAINER";
  countryCode: string;
  regionId: string;
  placeName: string;
  /** Distinct publishing domains across the group — the primary salience term. */
  distinctDomains: number;
  /** Distinct publisher countries — the secondary salience term, weighted 0.5. */
  distinctSourceCountries: number;
  /** log1p(domains) + 0.5 * log1p(sourceCountries), §2.5. */
  salience: number;
  /** True when any member is a tier-1 article inside the 48-hour window. */
  tier1Fresh: boolean;
  /** GKG date of the newest tier-1 article, "" when none. §6 decision 10: newest, not oldest. */
  newestTier1: string;
  /** GKG date of the newest article of any kind, for the freshness stamp. */
  newestArticle: string;
  /** Assigned by budget.ts. Monotonic upward: a feature that wins z5 may still lose z6. */
  minzoom: number;
};

/** What publish.ts writes next to the archive; the browser reads this, never GDELT (§2.6). */
export type Manifest = {
  /** Content-hashed archive key, e.g. "stories-a1b2c3d4.pmtiles". */
  archive: string;
  /** Absolute URL of the archive. */
  url: string;
  /** ISO timestamp of the run that produced it — drives the §2.3 freshness stamp. */
  generatedAt: string;
  /** Newest GKG bundle included, YYYYMMDDHHMMSS. */
  watermark: string;
  /** Counts the run summary and §8 monitoring care about. */
  stats: {
    groups: number;
    countries: number;
    tier1Groups: number;
  };
};
