import { describe, expect, it } from "vitest";
import type { StoryGroup } from "../src/lib/types.ts";
import { buildRegionIndex, indexStats, REGION_TOP_N } from "./regions.ts";

function group(patch: Partial<StoryGroup> = {}): StoryGroup {
  return {
    id: "a",
    title: "A headline",
    image: "",
    url: "https://example.com/a",
    domain: "example.com",
    lat: 0,
    lon: 0,
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

describe("buildRegionIndex", () => {
  it("files a story under both its country and its admin-1", () => {
    const index = buildRegionIndex([group({ id: "1" })]);
    expect(Object.keys(index).sort()).toEqual(["US", "USCA"]);
    expect(index.US.stories[0].title).toBe("A headline");
    expect(index.USCA.stories[0]).toEqual(index.US.stories[0]);
  });

  it("does not file a country container under itself twice", () => {
    const index = buildRegionIndex([group({ kind: "CONTAINER", adm1: "US", regionId: "US" })]);
    expect(Object.keys(index)).toEqual(["US"]);
  });

  it("includes a pin's admin-1, which is the whole reason adm1 exists", () => {
    const index = buildRegionIndex([group({ kind: "PIN", regionId: "", adm1: "USCA" })]);
    expect(index.USCA.stories).toHaveLength(1);
  });

  it("skips a story with no country attribution rather than making an empty key", () => {
    const index = buildRegionIndex([group({ countryCode: "", adm1: "" })]);
    expect(index).toEqual({});
  });

  it("orders by the §2.5 comparator, not by input order", () => {
    const index = buildRegionIndex([
      group({ id: "low", title: "low", salience: 0.5 }),
      group({ id: "top", title: "top", salience: 4 }),
      group({ id: "mid", title: "mid", salience: 2 }),
    ]);
    expect(index.US.stories.map((story) => story.title)).toEqual(["top", "mid", "low"]);
  });

  it("puts a tier-1 story ahead of a more salient ordinary one", () => {
    const index = buildRegionIndex([
      group({ id: "big", title: "big", salience: 4 }),
      group({ id: "t1", title: "t1", salience: 0.7, tier1Fresh: true }),
    ]);
    expect(index.US.stories[0].title).toBe("t1");
  });

  it("caps each region independently", () => {
    const many = Array.from({ length: REGION_TOP_N + 5 }, (_, i) =>
      group({ id: `${i}`, salience: 100 - i })
    );
    const index = buildRegionIndex([...many, group({ id: "fr", countryCode: "FR", adm1: "" })]);
    expect(index.US.stories).toHaveLength(REGION_TOP_N);
    expect(index.FR.stories).toHaveLength(1);
  });

  it("carries only title, source, url, date and place — §2.6 link-out only", () => {
    const [story] = buildRegionIndex([group()]).US.stories;
    expect(Object.keys(story).sort()).toEqual(["date", "place", "source", "title", "url"]);
  });

  it("includes a group the map cannot draw", () => {
    const index = buildRegionIndex([group({ minzoom: 14 })]);
    expect(index.US.stories).toHaveLength(1);
  });
});

describe("buildRegionIndex — continents (§4)", () => {
  it("files under a continent key when a resolver is supplied", () => {
    const index = buildRegionIndex(
      [group({ countryCode: "US", adm1: "USCA" })],
      undefined,
      () => "CONT:NA"
    );
    expect(Object.keys(index).sort()).toEqual(["CONT:NA", "US", "USCA"]);
    expect(index["CONT:NA"].stories[0].title).toBe("A headline");
  });

  it('files nothing when the resolver returns ""', () => {
    const index = buildRegionIndex([group()], undefined, () => "");
    expect(Object.keys(index).sort()).toEqual(["US", "USCA"]);
  });

  it("files nothing without a resolver — every existing caller keeps today's two-level index", () => {
    const index = buildRegionIndex([group()]);
    expect(Object.keys(index).sort()).toEqual(["US", "USCA"]);
  });

  it("cannot collide with a 2- or 4-char FIPS id", () => {
    const index = buildRegionIndex(
      [group({ countryCode: "US", adm1: "USCA" }), group({ countryCode: "FR", adm1: "" })],
      undefined,
      (fips) => (fips === "US" ? "CONT:NA" : "CONT:EU")
    );
    for (const key of Object.keys(index)) {
      expect(key === "CONT:NA" || key === "CONT:EU" || /^[A-Z]{2}([A-Z0-9]{2})?$/.test(key)).toBe(
        true
      );
    }
  });
});

describe("indexStats", () => {
  it("counts regions and total rows", () => {
    const index = buildRegionIndex([
      group({ id: "1" }),
      group({ id: "2", countryCode: "FR", adm1: "" }),
    ]);
    expect(indexStats(index)).toEqual({ regions: 3, rows: 3 });
  });
});
