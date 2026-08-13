import { describe, expect, it } from "vitest";
import type { StoryGroup } from "../lib/types.ts";
import { assignMinzoom, countryTopGroups, tileOf } from "./budget.ts";
import { salienceOf } from "./rank.ts";

function group(patch: Partial<StoryGroup> = {}): StoryGroup {
  return {
    id: "id",
    title: "t",
    url: "u",
    domain: "d",
    lat: 0,
    lon: 0,
    kind: "PIN",
    countryCode: "US",
    regionId: "",
    adm1: "",
    placeName: "p",
    distinctDomains: 1,
    distinctSourceCountries: 0,
    salience: salienceOf(1, 0),
    tier1Fresh: false,
    newestTier1: "",
    newestArticle: "20260812050000",
    minzoom: 0,
    ...patch,
  };
}

/** `count` groups at the same coordinate, descending in salience. */
function crowd(count: number, lat = 40, lon = -74): StoryGroup[] {
  return Array.from({ length: count }, (_, i) =>
    group({ id: `g${String(i).padStart(3, "0")}`, lat, lon, salience: count - i }),
  );
}

describe("tileOf", () => {
  it("puts the whole planet in one tile at z0", () => {
    expect(tileOf(51.5, -0.12, 0)).toEqual({ x: 0, y: 0 });
  });

  it("splits the hemispheres at z1", () => {
    expect(tileOf(40, -74, 1)).toEqual({ x: 0, y: 0 });
    expect(tileOf(40, 74, 1)).toEqual({ x: 1, y: 0 });
    expect(tileOf(-40, 74, 1)).toEqual({ x: 1, y: 1 });
  });

  it("clamps the poles and the antimeridian instead of running off the grid", () => {
    // y grows southward in Web Mercator, so the north pole is y=0.
    expect(tileOf(90, 180, 2)).toEqual({ x: 3, y: 0 });
    expect(tileOf(-90, -180, 2)).toEqual({ x: 0, y: 3 });
  });
});

describe("the per-tile budget", () => {
  it("keeps everything in a sparse tile — the budget is a floor too", () => {
    const { groups } = assignMinzoom(crowd(3), { k: 15 });
    expect(groups.every((g) => g.minzoom === 0)).toBe(true);
  });

  it("defers the weakest in a crowded tile", () => {
    const { groups } = assignMinzoom(crowd(20), { k: 5 });
    const byId = new Map(groups.map((g) => [g.id, g.minzoom]));
    expect(byId.get("g000")).toBe(0); // strongest
    expect(byId.get("g019")).toBeGreaterThan(0); // weakest
  });

  it("selects strictly by the comparator, so tier-1 wins a scarce slot", () => {
    const { groups } = assignMinzoom(
      [
        group({ id: "ordinary", salience: 99, lat: 40, lon: -74 }),
        group({ id: "tier1", salience: 0.1, tier1Fresh: true, lat: 40, lon: -74 }),
      ],
      { k: 1 },
    );
    expect(groups.find((g) => g.id === "tier1")?.minzoom).toBe(0);
    expect(groups.find((g) => g.id === "ordinary")?.minzoom).toBeGreaterThan(0);
  });

  it("keeps minzoom monotonic — a group selected at z is never missing at z+1", () => {
    // §5's trap: "a feature can win its z5 tile and lose its z6 tile". Assigned
    // groups keep occupying their tile at deeper zooms, so nothing can evict
    // them. Asserted by replaying the selection at every zoom.
    const { groups } = assignMinzoom(crowd(40), { k: 3, maxZoom: 6 });
    for (let zoom = 0; zoom <= 6; zoom++) {
      const visible = groups.filter((g) => g.minzoom <= zoom).map((g) => g.id);
      const deeper = new Set(groups.filter((g) => g.minzoom <= zoom + 1).map((g) => g.id));
      for (const id of visible) expect(deeper.has(id)).toBe(true);
    }
  });

  it("never exceeds K in any tile at any zoom", () => {
    const k = 4;
    const { groups } = assignMinzoom(
      [...crowd(30, 40, -74), ...crowd(30, -33, 151).map((g) => ({ ...g, id: `s${g.id}` }))],
      { k, maxZoom: 5 },
    );
    for (let zoom = 0; zoom <= 5; zoom++) {
      const perTile = new Map<string, number>();
      for (const g of groups.filter((g) => g.minzoom <= zoom)) {
        const { x, y } = tileOf(g.lat, g.lon, zoom);
        const key = `${x}/${y}`;
        perTile.set(key, (perTile.get(key) ?? 0) + 1);
      }
      for (const count of perTile.values()) expect(count).toBeLessThanOrEqual(k);
    }
  });

  it("lets local competition stay local — a US crowd cannot bury a lone story elsewhere", () => {
    // §2.4: "the Strait of Hormuz is never buried by an American election."
    // Asserted from z1, because at z0 the planet is ONE tile and competition
    // really is global there — which is exactly the hole the §2.4 country-top
    // floor layer exists to fill, not something the budget is meant to fix.
    const { groups } = assignMinzoom(
      [...crowd(50, 40, -74), group({ id: "hormuz", lat: 26.6, lon: 56.3, salience: 0.01 })],
      { k: 5 },
    );
    expect(groups.find((g) => g.id === "hormuz")?.minzoom).toBe(1);
  });

  it("reports the overflow rather than dumping it at the deepest zoom", () => {
    // Co-located stories (GDELT city centroids, §6 decision 1) collide at every
    // zoom, so the remainder cannot be deferred into visibility. Showing it
    // anyway would break §9's density target; it is counted instead.
    const { groups, overflow } = assignMinzoom(crowd(100), { k: 1, maxZoom: 3 });
    // ONE gets in, not one per zoom: 100 stories on the identical coordinate
    // share a tile at every zoom level, so the deeper zooms free no slots at
    // all. This is the sharpest statement of the co-location cost in the suite.
    expect(overflow).toBe(99);
    expect(groups.filter((g) => g.minzoom > 3).length).toBe(99);
  });
});

describe("the country-top floor layer", () => {
  it("gives every country with news exactly one pin at minzoom 0", () => {
    const groups = countryTopGroups([
      group({ id: "us1", countryCode: "US", salience: 5 }),
      group({ id: "us2", countryCode: "US", salience: 9 }),
      group({ id: "ke1", countryCode: "KE", salience: 0.2 }),
    ]);
    expect(groups.length).toBe(2);
    expect(groups.every((g) => g.minzoom === 0)).toBe(true);
    expect(groups.find((g) => g.countryCode === "US")?.id).toBe("us2");
  });

  it("represents a country by its tier-1 story even when that story is small", () => {
    // §2.4: intended effect, not a side effect.
    const groups = countryTopGroups([
      group({ id: "big", countryCode: "GB", salience: 40 }),
      group({ id: "small-tier1", countryCode: "GB", salience: 0.5, tier1Fresh: true }),
    ]);
    expect(groups[0].id).toBe("small-tier1");
  });

  it("skips groups with no country, rather than inventing one", () => {
    expect(countryTopGroups([group({ id: "ocean", countryCode: "" })])).toEqual([]);
  });
});
