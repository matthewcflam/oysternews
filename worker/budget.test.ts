import { describe, expect, it } from "vitest";
import { SPIDERFY_ZOOM } from "../src/lib/spiderfy.ts";
import type { StoryGroup } from "../src/lib/types.ts";
import { assignMinzoom, countryTopGroups, tileOf } from "./budget.ts";
import { salienceOf } from "./rank.ts";

function group(patch: Partial<StoryGroup> = {}): StoryGroup {
  return {
    id: "id",
    title: "t",
    image: "",
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

function crowd(count: number, lat = 40, lon = -74): StoryGroup[] {
  return Array.from({ length: count }, (_, i) =>
    group({ id: `g${String(i).padStart(3, "0")}`, lat, lon, salience: count - i })
  );
}

function spread(count: number, lat = 40, lon = -74): StoryGroup[] {
  return Array.from({ length: count }, (_, i) =>
    group({
      id: `g${String(i).padStart(3, "0")}`,
      lat,
      lon: lon + i * 0.001,
      salience: count - i,
    })
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
    expect(tileOf(90, 180, 2)).toEqual({ x: 3, y: 0 });
    expect(tileOf(-90, -180, 2)).toEqual({ x: 0, y: 3 });
  });
});

describe("the per-tile budget", () => {
  it("keeps everything in a sparse tile — the budget is a floor too", () => {
    const { groups } = assignMinzoom(spread(3), { k: 15 });
    expect(groups.every((g) => g.minzoom === 0)).toBe(true);
  });

  it("defers the weakest in a crowded tile", () => {
    const { groups } = assignMinzoom(crowd(20), { k: 5 });
    const byId = new Map(groups.map((g) => [g.id, g.minzoom]));
    expect(byId.get("g000")).toBe(0);
    expect(byId.get("g019")).toBeGreaterThan(0);
  });

  it("selects strictly by the comparator, so tier-1 wins a scarce slot", () => {
    const { groups } = assignMinzoom(
      [
        group({ id: "ordinary", salience: 99, lat: 40, lon: -74 }),
        group({ id: "tier1", salience: 0.1, tier1Fresh: true, lat: 40, lon: -74 }),
      ],
      { k: 1 }
    );
    expect(groups.find((g) => g.id === "tier1")?.minzoom).toBe(0);
    expect(groups.find((g) => g.id === "ordinary")?.minzoom).toBeGreaterThan(0);
  });

  it("keeps minzoom monotonic — a group selected at z is never missing at z+1", () => {
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
      { k, maxZoom: 5 }
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
    const { groups } = assignMinzoom(
      [...spread(50, 40, -74), group({ id: "hormuz", lat: 26.6, lon: 56.3, salience: 0.01 })],
      { k: 5 }
    );
    expect(groups.find((g) => g.id === "hormuz")?.minzoom).toBe(1);
  });

  it("admits ONE story per coordinate below the spiderfy zoom", () => {
    const { groups } = assignMinzoom(crowd(12), { k: 15 });
    const shallow = groups.filter((g) => g.minzoom < SPIDERFY_ZOOM);
    expect(shallow.map((g) => g.id)).toEqual(["g000"]);
    expect(groups.filter((g) => g.minzoom === SPIDERFY_ZOOM)).toHaveLength(11);
  });

  it("lifts the cap exactly where the client can spread the stack", () => {
    const { groups, overflow } = assignMinzoom(crowd(12), { k: 15 });
    expect(overflow).toBe(0);
    expect(groups.every((g) => g.minzoom <= SPIDERFY_ZOOM)).toBe(true);
  });

  it("frees the slots a stack used to hold, so other places get in", () => {
    const { groups } = assignMinzoom(
      [...crowd(50, 40, -74), group({ id: "hormuz", lat: 26.6, lon: 56.3, salience: 0.01 })],
      { k: 5 }
    );
    expect(groups.find((g) => g.id === "hormuz")?.minzoom).toBe(0);
  });

  it("keeps minzoom monotonic across the cap boundary", () => {
    const { groups } = assignMinzoom([...crowd(20), ...crowd(20, 51.5, -0.12)], {
      k: 4,
      maxZoom: 11,
    });
    for (let zoom = 0; zoom <= 11; zoom++) {
      const visible = groups.filter((g) => g.minzoom <= zoom).map((g) => g.id);
      const deeper = new Set(groups.filter((g) => g.minzoom <= zoom + 1).map((g) => g.id));
      for (const id of visible) expect(deeper.has(id)).toBe(true);
    }
  });

  it("reports the overflow rather than dumping it at the deepest zoom", () => {
    const { groups, overflow } = assignMinzoom(crowd(100), { k: 1, maxZoom: 3 });
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
