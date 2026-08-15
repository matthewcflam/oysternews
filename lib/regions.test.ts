import { afterEach, describe, expect, it, vi } from "vitest";
import { gkgToMillis, loadRegionIndex, resetRegionIndexCache, storiesFor } from "./regions";
import type { RegionIndex } from "./types";

const index: RegionIndex = {
  PK: [{ title: "A", source: "dawn.com", url: "https://dawn.com/a", date: "20260813091500", place: "Pakistan" }],
  USCA: [],
};

afterEach(() => {
  resetRegionIndexCache();
  vi.unstubAllGlobals();
});

const stubFetch = (impl: (url: string) => Promise<Response> | Response) => {
  const fetchMock = vi.fn((url: string) => Promise.resolve(impl(url)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("loadRegionIndex", () => {
  it("fetches once for many callers", async () => {
    const fetchMock = stubFetch(() => ok(index));
    const [a, b] = await Promise.all([
      loadRegionIndex("/regions-abc.json"),
      loadRegionIndex("/regions-abc.json"),
    ]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches when the manifest points at a new hash", async () => {
    // A page left open across a run must not stay pinned to the old index.
    const fetchMock = stubFetch(() => ok(index));
    await loadRegionIndex("/regions-abc.json");
    await loadRegionIndex("/regions-def.json");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on a bad response, and lets the next click retry", async () => {
    const fetchMock = stubFetch(() => ({ ok: false, status: 404 }) as Response);
    await expect(loadRegionIndex("/regions-abc.json")).rejects.toThrow("HTTP 404");
    // A cached rejected promise would make one blip permanent for the session.
    await expect(loadRegionIndex("/regions-abc.json")).rejects.toThrow("HTTP 404");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("storiesFor", () => {
  it("reads country and admin-1 keys out of one flat map", () => {
    // The namespaces cannot collide: FIPS country codes are two characters and
    // admin-1 codes are four (worker/regions.ts).
    expect(storiesFor(index, "PK")).toHaveLength(1);
    expect(storiesFor(index, "USCA")).toEqual([]);
  });

  it("treats a region with no news as empty, not as an error", () => {
    // 124 of ~250 countries had any news in a 24-hour window (§2.4), and
    // Natural Earth draws polygons GDELT never mentions.
    expect(storiesFor(index, "AQ")).toEqual([]);
    expect(storiesFor(null, "PK")).toEqual([]);
    expect(storiesFor(index, "")).toEqual([]);
  });
});

describe("gkgToMillis", () => {
  it("reads a GKG stamp as UTC", () => {
    expect(gkgToMillis("20260813091500")).toBe(Date.UTC(2026, 7, 13, 9, 15, 0));
  });

  it("refuses anything that is not one, rather than guessing", () => {
    // Date.parse reads "20260813" as a LOCAL date in some engines and as
    // invalid in others. Both are silent.
    expect(gkgToMillis("20260813")).toBeNaN();
    expect(gkgToMillis("2026-08-13T09:15:00Z")).toBeNaN();
    expect(gkgToMillis("")).toBeNaN();
  });
});

/*
 * `storyAge`'s tests were here. It was deleted on 2026-08-14 — see the note
 * where it lived in `lib/regions.ts`. The behaviour it covered now belongs to
 * `publishedAt` (lib/story.test.ts) over `ago` (lib/age.test.ts).
 */
