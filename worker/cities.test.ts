import { describe, expect, it } from "vitest";
import type { StoryGroup } from "../lib/types.ts";
import { CITY_TOP_N, buildCityIndex, cityIndexStats } from "./cities.ts";

function group(patch: Partial<StoryGroup> = {}): StoryGroup {
  return {
    id: "a",
    title: "A headline",
    image: "",
    url: "https://example.com/a",
    domain: "example.com",
    lat: 34.0,
    lon: -118.2,
    kind: "PIN",
    countryCode: "US",
    regionId: "",
    adm1: "USCA",
    placeName: "Los Angeles, California, United States",
    distinctDomains: 1,
    distinctSourceCountries: 1,
    salience: 1,
    tier1Fresh: false,
    newestTier1: "",
    newestArticle: "20260813090000",
    minzoom: 0,
    ...patch,
  };
}

describe("buildCityIndex", () => {
  it("shards by country and clusters same-city pins together", () => {
    const index = buildCityIndex([group({ id: "1" }), group({ id: "2" })]);
    expect(Object.keys(index)).toEqual(["US"]);
    expect(index.US).toHaveLength(1);
    expect(index.US[0].total).toBe(2);
  });

  it("excludes containers — a container already publishes through buildRegionIndex", () => {
    const index = buildCityIndex([group({ kind: "CONTAINER" })]);
    expect(index).toEqual({});
  });

  it("takes the median of member coordinates", () => {
    const index = buildCityIndex([
      group({ id: "1", lat: 34.0, lon: -118.0 }),
      group({ id: "2", lat: 34.2, lon: -118.4 }),
      group({ id: "3", lat: 33.8, lon: -118.6 }),
    ]);
    expect(index.US[0].lat).toBeCloseTo(34.0);
    expect(index.US[0].lon).toBeCloseTo(-118.4);
  });

  it("counts total and sources before the cap, same contract as RegionEntry", () => {
    const many = Array.from({ length: CITY_TOP_N + 5 }, (_, i) =>
      group({ id: `${i}`, domain: `outlet-${i}.com` }),
    );
    const index = buildCityIndex(many);
    expect(index.US[0].stories).toHaveLength(CITY_TOP_N);
    expect(index.US[0].total).toBe(CITY_TOP_N + 5);
    expect(index.US[0].sources).toBe(CITY_TOP_N + 5);
  });

  it("orders rows by the §2.5 comparator, not input order", () => {
    const index = buildCityIndex([
      group({ id: "low", title: "low", salience: 0.5 }),
      group({ id: "top", title: "top", salience: 4 }),
      group({ id: "mid", title: "mid", salience: 2 }),
    ]);
    expect(index.US[0].stories.map((s) => s.title)).toEqual(["top", "mid", "low"]);
  });

  it("carries the admin-1 display name from GDELT's own FullName", () => {
    const index = buildCityIndex([group()]);
    expect(index.US[0].adm1Name).toBe("California");
  });

  it("keeps two same-named cities in different countries in different shards", () => {
    const index = buildCityIndex([
      group({ id: "1", countryCode: "US", adm1: "USCA", placeName: "Springfield, Illinois, United States" }),
      group({ id: "2", countryCode: "AU", adm1: "AS02", placeName: "Springfield, Queensland, Australia" }),
    ]);
    expect(Object.keys(index).sort()).toEqual(["AU", "US"]);
    expect(index.US[0].name).toBe("Springfield");
    expect(index.AU[0].name).toBe("Springfield");
  });

  it("never lets a cluster straddle two shards — an adm1's first two characters are its own country", () => {
    const index = buildCityIndex([
      group({ id: "1", countryCode: "US", adm1: "USCA" }),
      group({ id: "2", countryCode: "US", adm1: "USNY", placeName: "New York, New York, United States" }),
    ]);
    expect(Object.keys(index)).toEqual(["US"]);
    expect(index.US).toHaveLength(2);
  });

  it("skips a group with no country attribution", () => {
    const index = buildCityIndex([group({ countryCode: "" })]);
    expect(index).toEqual({});
  });
});

describe("cityIndexStats", () => {
  it("counts shards and total clustered cities", () => {
    const index = buildCityIndex([
      group({ id: "1", countryCode: "US" }),
      group({ id: "2", countryCode: "FR", adm1: "", placeName: "Paris, France" }),
    ]);
    expect(cityIndexStats(index)).toEqual({ shards: 2, cities: 2 });
  });
});
