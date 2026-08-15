import { describe, expect, it } from "vitest";
import type { StoryGroup } from "../lib/types.ts";
import { REGION_TOP_N, buildRegionIndex, indexStats } from "./regions.ts";

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
    expect(index.US[0].title).toBe("A headline");
    expect(index.USCA[0]).toEqual(index.US[0]);
  });

  it("does not file a country container under itself twice", () => {
    // regionIdFor gives a country container adm1 === country. Filing it under
    // both would make "US" look like an admin-1 region of itself.
    const index = buildRegionIndex([group({ kind: "CONTAINER", adm1: "US", regionId: "US" })]);
    expect(Object.keys(index)).toEqual(["US"]);
  });

  it("includes a pin's admin-1, which is the whole reason adm1 exists", () => {
    // Pins are 33.5% of the feed and carry regionId "". A panel keyed on
    // regionId would show California's containers and omit a third of its news.
    const index = buildRegionIndex([group({ kind: "PIN", regionId: "", adm1: "USCA" })]);
    expect(index.USCA).toHaveLength(1);
  });

  it("skips a story with no country attribution rather than making an empty key", () => {
    const index = buildRegionIndex([group({ countryCode: "", adm1: "" })]);
    expect(index).toEqual({});
  });

  it("orders by the §2.5 comparator, not by input order", () => {
    // budget.ts returns groups in its tile walk's order. A panel that depended
    // on an upstream sort would break the day someone reordered a stage.
    const index = buildRegionIndex([
      group({ id: "low", title: "low", salience: 0.5 }),
      group({ id: "top", title: "top", salience: 4 }),
      group({ id: "mid", title: "mid", salience: 2 }),
    ]);
    expect(index.US.map((story) => story.title)).toEqual(["top", "mid", "low"]);
  });

  it("puts a tier-1 story ahead of a more salient ordinary one", () => {
    // §2.5's first key. The panel must not quietly re-rank on salience alone.
    const index = buildRegionIndex([
      group({ id: "big", title: "big", salience: 4 }),
      group({ id: "t1", title: "t1", salience: 0.7, tier1Fresh: true }),
    ]);
    expect(index.US[0].title).toBe("t1");
  });

  it("caps each region independently", () => {
    const many = Array.from({ length: REGION_TOP_N + 5 }, (_, i) =>
      group({ id: `${i}`, salience: 100 - i }),
    );
    const index = buildRegionIndex([...many, group({ id: "fr", countryCode: "FR", adm1: "" })]);
    expect(index.US).toHaveLength(REGION_TOP_N);
    expect(index.FR).toHaveLength(1);
  });

  it("carries only title, source, url, date and place — §2.6 link-out only", () => {
    // The type is the constraint; this is the test that keeps it one. Salience
    // and tier1 must not reach the browser: §2.3 forbids a tier-1 badge, and the
    // surest way to prevent one is for the data not to be there.
    const [story] = buildRegionIndex([group()]).US;
    expect(Object.keys(story).sort()).toEqual(["date", "place", "source", "title", "url"]);
  });

  it("includes a group the map cannot draw", () => {
    // §2.4 overflow: minzoom above the z12 ceiling means it is in the pipeline
    // and not on the map. The panel is the only surface that can reach it.
    const index = buildRegionIndex([group({ minzoom: 14 })]);
    expect(index.US).toHaveLength(1);
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
