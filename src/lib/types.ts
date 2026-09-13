export const LOCATION_COUNTRY = 1;
export const LOCATION_US_STATE = 2;
export const LOCATION_US_CITY = 3;
export const LOCATION_WORLD_CITY = 4;
export const LOCATION_ADM1 = 5;

export const CITY_TYPES: readonly number[] = [LOCATION_US_CITY, LOCATION_WORLD_CITY];
export const ADM1_TYPES: readonly number[] = [LOCATION_US_STATE, LOCATION_ADM1];

export type GdeltLocation = {
  type: number;
  name: string;
  // FIPS 10-4, not ISO 3166: RS is Russia, CH is China.
  countryCode: string;
  adm1Code: string;
  lat: number;
  lon: number;
  featureId: string;
  offset: number;
};

export type Article = {
  date: string;
  domain: string;
  url: string;
  title: string;
  image: string;
  themes: string[];
  locations: GdeltLocation[];
};

export type Placement =
  | { kind: "PIN"; location: GdeltLocation }
  | { kind: "CONTAINER"; location: GdeltLocation; regionId: string }
  | { kind: "DROP"; location: null };

export type PlacedArticle = {
  date: string;
  domain: string;
  url: string;
  title: string;
  image: string;
  themes: string[];
  lat: number;
  lon: number;
  kind: "PIN" | "CONTAINER";
  countryCode: string;
  regionId: string;
  // Set for pins too, unlike regionId: without it the region panel silently omits pins.
  adm1: string;
  placeName: string;
  sourceCountry: string;
  tier1: boolean;
};

export type StoryGroup = {
  id: string;
  title: string;
  url: string;
  domain: string;
  // Never borrowed from another member: that pairs the headline with another article's picture.
  image: string;
  lat: number;
  lon: number;
  kind: "PIN" | "CONTAINER";
  countryCode: string;
  regionId: string;
  adm1: string;
  placeName: string;
  distinctDomains: number;
  distinctSourceCountries: number;
  salience: number;
  tier1Fresh: boolean;
  newestTier1: string;
  newestArticle: string;
  minzoom: number;
};

// This type is the link-out constraint for panel rows. Don't widen it to StoryGroup.
export type RegionStory = {
  title: string;
  source: string;
  url: string;
  date: string;
  place: string;
};

// Both counts are computed BEFORE the REGION_TOP_N cap.
export type RegionEntry = {
  stories: RegionStory[];
  total: number;
  sources: number;
};

export type RegionIndex = Record<string, RegionEntry | RegionStory[]>;

export type CityRecord = RegionEntry & {
  name: string;
  lat: number;
  lon: number;
  adm1Name: string;
};

export type CityShard = CityRecord[];

export type Manifest = {
  archive: string;
  url: string;
  regionsUrl?: string;
  // Absent or 1: the browser must treat a continent click as unavailable, not empty.
  regionsVersion?: number;
  citiesBase?: string;
  generatedAt: string;
  watermark: string;
  stats: {
    groups: number;
    countries: number;
    tier1Groups: number;
  };
};
