/**
 * The record shapes the worker passes between modules — kept 1:1 with the
 * eventual `articles` table so the shape of the data is written down here
 * rather than implied by whatever each module happens to construct.
 * Everything here is data, not behaviour; the pure modules in worker/
 * transform one of these into another, and none of them own a type.
 */

/** GDELT V2EnhancedLocations type codes. */
export const LOCATION_COUNTRY = 1;
export const LOCATION_US_STATE = 2;
export const LOCATION_US_CITY = 3;
export const LOCATION_WORLD_CITY = 4;
export const LOCATION_ADM1 = 5;

/** City-level: 3 and 4. Measured at ~71% cities, the rest natural features, counties and landmarks. */
export const CITY_TYPES: readonly number[] = [LOCATION_US_CITY, LOCATION_WORLD_CITY];
/** Admin-1: US states (2) and world admin-1 (5). */
export const ADM1_TYPES: readonly number[] = [LOCATION_US_STATE, LOCATION_ADM1];

export type GdeltLocation = {
  type: number;
  /** GDELT's FullName, e.g. "Portland, Oregon, United States" or bare "Americans". */
  name: string;
  /** FIPS 10-4, not ISO 3166 — RS is Russia, CH is China. See docs/DESIGN.md#the-fips-trap. */
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
 * One GDELT record: one article, as parsed. `themes` and `locations` are
 * the only multi-valued fields the project reads — V2GCAM is 69.4% of the
 * bytes and is never materialized.
 */
export type Article = {
  /** GKG DATE, YYYYMMDDHHMMSS, UTC. */
  date: string;
  /** SourceCommonName — a bare domain, lowercased. */
  domain: string;
  /** DocumentIdentifier — the article URL. */
  url: string;
  /** From V2EXTRASXML PAGE_TITLE, HTML-entity-unescaped. Present on ~99.7% of records. */
  title: string;
  /** V2.1SHARINGIMAGE — the publisher's own og:image, validated to http/https or "". A URL, never bytes — link-out only. */
  image: string;
  /** V2EnhancedThemes, offsets stripped. */
  themes: string[];
  locations: GdeltLocation[];
};

/** Where worker/place.ts's placeStory() puts a story. */
export type PlacementKind = "PIN" | "CONTAINER" | "DROP";

export type Placement =
  | { kind: "PIN"; location: GdeltLocation }
  | { kind: "CONTAINER"; location: GdeltLocation; regionId: string }
  | { kind: "DROP"; location: null };

/**
 * An article that survived filtering and placement — the unit written to a
 * state shard, so it must stay small (~40,700 of these in a 24h window,
 * re-read every run).
 */
export type PlacedArticle = {
  date: string;
  domain: string;
  url: string;
  title: string;
  /** The article's own sharing image, or "". See Article.image. */
  image: string;
  themes: string[];
  lat: number;
  lon: number;
  /** PIN or CONTAINER. A DROP never becomes a PlacedArticle. */
  kind: "PIN" | "CONTAINER";
  /** FIPS country code of the placement. */
  countryCode: string;
  /** For containers: the region this pin represents. Empty for pins. */
  regionId: string;
  /**
   * FIPS admin-1 code of wherever the story was placed (`USCA`), "" when
   * none. Distinct from `regionId` and carried for PINs too — `regionId`
   * answers "what does this container represent" (empty on a pin by
   * design), this answers "what region is this story IN" (which a pin has
   * too). The region panel needs the second question, or it would show a
   * state's containers and silently omit its pins (~33.5% of the feed).
   */
  adm1: string;
  /** Display name of the place, for debugging and the container label. */
  placeName: string;
  /** ISO country of the *publisher*, inferred from the domain. "" when unknown. */
  sourceCountry: string;
  /** Whether `domain` is in data/tier1-domains. See docs/DESIGN.md#ranking. */
  tier1: boolean;
};

/**
 * A group of articles worker/group.ts considers the same story. This is
 * what gets ranked, budgeted and tiled — never the individual article.
 */
export type StoryGroup = {
  /** Stable id derived from the group's members, so a group keeps its identity across runs. */
  id: string;
  /** The representative article: highest-ranked member by worker/rank.ts's comparator. */
  title: string;
  url: string;
  domain: string;
  /** The representative article's sharing image, or "" — never borrowed from another member (that would pair the headline with a different article's picture, an undetectable caption error). */
  image: string;
  lat: number;
  lon: number;
  kind: "PIN" | "CONTAINER";
  countryCode: string;
  regionId: string;
  /** Admin-1 the group sits in, pins included. See PlacedArticle.adm1. */
  adm1: string;
  placeName: string;
  /** Distinct publishing domains across the group — the primary salience term. */
  distinctDomains: number;
  /** Distinct publisher countries — the secondary salience term, weighted 0.5. */
  distinctSourceCountries: number;
  /** log1p(domains) + 0.5 * log1p(sourceCountries). See docs/DESIGN.md#ranking. */
  salience: number;
  /** True when any member is a tier-1 article inside the 48-hour window. */
  tier1Fresh: boolean;
  /** GKG date of the newest tier-1 article, "" when none (newest, not oldest, is deliberate). */
  newestTier1: string;
  /** GKG date of the newest article of any kind, for the freshness stamp. */
  newestArticle: string;
  /** Assigned by budget.ts. Monotonic upward: a feature that wins z5 may still lose z6. */
  minzoom: number;
};

/**
 * One row in the region panel — link-out only, and this type IS the
 * constraint: it's the whole of what a panel row can hold, so article
 * prose can't reach the panel without changing a shape both worker and
 * browser compile against. Deliberately not `StoryGroup` — publishing the
 * group wholesale would ship salience, tier-1 flags and coordinates the
 * panel has no business rendering.
 */
export type RegionStory = {
  title: string;
  /** The publishing domain, shown as the source. */
  source: string;
  url: string;
  /** Newest article in the group, GKG stamp — drives the relative freshness line. */
  date: string;
  /** Where the story sits, for the panel's second line. */
  place: string;
};

/**
 * What one region's panel gets: the rows it can draw, and two counts
 * describing the part it can't. The counts exist because rows are capped
 * (`REGION_TOP_N`) and the header must not lie about the pool size — see
 * docs/DESIGN.md#regions. Both computed BEFORE the cap, so
 * `stories.length <= total` always holds.
 */
export type RegionEntry = {
  /** Best first, capped at `REGION_TOP_N`. */
  stories: RegionStory[];
  /** Every group filed under this region in the window, uncapped. */
  total: number;
  /** Distinct publishing domains across those groups. */
  sources: number;
};

/**
 * region id (`PK`, `USCA`) -> its entry. The union with the legacy bare
 * `RegionStory[]` form exists so an index published before that shape
 * changed stays valid — see `lib/regions.ts`'s `regionEntry` normalizer.
 */
export type RegionIndex = Record<string, RegionEntry | RegionStory[]>;

/**
 * One city's entry in a city shard: a `RegionEntry` plus what a country- or
 * admin-1-level entry doesn't need — a coordinate to snap a label click
 * to, and the admin-1 name for the breadcrumb. `RegionEntry`'s fields keep
 * their contract exactly (counted before the `stories` cap).
 */
export type CityRecord = RegionEntry & {
  /** Display name — what the panel heads with, not the clicked label's own text (two nearby cities must not borrow each other's name). */
  name: string;
  /** Median of the cluster's member coordinates — robust to one mis-geocoded member. */
  lat: number;
  lon: number;
  /** Second comma segment of GDELT's FullName ("Portland, OREGON, United States"), for the breadcrumb. "" when there is none. */
  adm1Name: string;
};

/** One country's published city shard: every city clustered under it, unordered — the browser sorts by distance, not by rank. */
export type CityShard = CityRecord[];

/** What publish.ts writes next to the archive; the browser reads this, never GDELT directly. */
export type Manifest = {
  /** Content-hashed archive key, e.g. "stories-a1b2c3d4.pmtiles". */
  archive: string;
  /** Absolute URL of the archive. */
  url: string;
  /** Absolute URL of the per-region story index, content-hashed and immutable. Optional so a manifest published before the index existed stays valid. */
  regionsUrl?: string;
  /** `2` once the index carries `CONT:*` keys. Absent/`1` means the browser must treat a continent click as `unavailable`, not as an empty-but-fetched result. See docs/DESIGN.md#the-manifest-and-regions_version. */
  regionsVersion?: number;
  /** URL prefix of per-country city shards; the browser appends `<FIPS>.json`. Optional for the same reason `regionsUrl` is. */
  citiesBase?: string;
  /** ISO timestamp of the run that produced it — drives the freshness stamp. */
  generatedAt: string;
  /** Newest GKG bundle included, YYYYMMDDHHMMSS. */
  watermark: string;
  /** Counts the run summary and monitoring care about. See docs/DESIGN.md#failure. */
  stats: {
    groups: number;
    countries: number;
    tier1Groups: number;
  };
};
