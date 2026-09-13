import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CITY_SNAP_KM, loadCityShard, nearestCity, resetCityShardCache } from "./cities";
import type { CityRecord, CityShard } from "./types";

function record(patch: Partial<CityRecord> = {}): CityRecord {
  return {
    name: "Chicago",
    adm1Name: "Illinois",
    lat: 41.9,
    lon: -87.6,
    total: 5,
    sources: 3,
    stories: [],
    ...patch,
  };
}

describe("nearestCity", () => {
  it("picks the nearer of two candidates", () => {
    const shard: CityShard = [
      record({ name: "far", lat: 40.0, lon: -85.0 }),
      record({ name: "near", lat: 41.91, lon: -87.61 }),
    ];
    expect(nearestCity(shard, [-87.6, 41.9])?.name).toBe("near");
  });

  it("returns null past the snap radius", () => {
    const shard: CityShard = [record({ lat: 34.0, lon: -118.2 })]; // Los Angeles, far from Chicago
    expect(nearestCity(shard, [-87.6, 41.9])).toBeNull();
  });

  it("returns the exact match at distance 0", () => {
    const shard: CityShard = [record({ lat: 41.9, lon: -87.6 })];
    expect(nearestCity(shard, [-87.6, 41.9])?.name).toBe("Chicago");
  });

  it("respects a custom radius", () => {
    const shard: CityShard = [record({ lat: 41.9, lon: -87.6 })];
    // ~0.2 degrees of longitude at this latitude is well under CITY_SNAP_KM
    // but well over a 1km radius.
    expect(nearestCity(shard, [-87.8, 41.9], 1)).toBeNull();
    expect(nearestCity(shard, [-87.8, 41.9], CITY_SNAP_KM)).not.toBeNull();
  });

  it("returns null for an empty shard", () => {
    expect(nearestCity([], [0, 0])).toBeNull();
  });

  it("handles the antimeridian — a label anchor at lng 190 must still match a record at lng -170", () => {
    const shard: CityShard = [record({ name: "Suva", lat: -18.1, lon: -179.4 })];
    expect(nearestCity(shard, [180.6, -18.1])?.name).toBe("Suva");
  });
});

describe("loadCityShard", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetCityShardCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches once per URL, sharing a promise across concurrent calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [record()],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const [a, b] = await Promise.all([
      loadCityShard("https://x/cities/", "US"),
      loadCityShard("https://x/cities/", "US"),
    ]);
    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a 404 as ready-and-empty, not a failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    await expect(loadCityShard("https://x/cities/", "ZZ")).resolves.toEqual([]);
  });

  it("rejects and clears the cache on a server error, so the next click retries", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(loadCityShard("https://x/cities/", "US")).rejects.toThrow();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [record()],
    }) as unknown as typeof fetch;
    await expect(loadCityShard("https://x/cities/", "US")).resolves.toEqual([record()]);
  });
});
