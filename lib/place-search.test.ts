import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPlaceIndex,
  normalize,
  resetPlaceIndexCache,
  searchablePlaces,
  searchPlaces,
  type PlaceEntry,
} from "./place-search";

afterEach(() => {
  resetPlaceIndexCache();
  vi.unstubAllGlobals();
});

const stubFetch = (impl: (url: string) => Promise<Response> | Response) => {
  const fetchMock = vi.fn((url: string) => Promise.resolve(impl(url)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("loadPlaceIndex", () => {
  it("fetches once for many callers", async () => {
    const fetchMock = stubFetch(() => ok([]));
    const [a, b] = await Promise.all([loadPlaceIndex(), loadPlaceIndex()]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws on a bad response, and lets the next keystroke retry", async () => {
    const fetchMock = stubFetch(() => ({ ok: false, status: 404 }) as Response);
    await expect(loadPlaceIndex()).rejects.toThrow("HTTP 404");
    // A cached rejected promise would make one blip permanent for the session.
    await expect(loadPlaceIndex()).rejects.toThrow("HTTP 404");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("searchablePlaces", () => {
  it("merges the fetched index with all seven continents", () => {
    const places = searchablePlaces([{ id: "SP", name: "Spain", kind: "country" }]);
    expect(places.filter((p) => p.kind === "continent")).toHaveLength(7);
    expect(places.some((p) => p.id === "SP")).toBe(true);
    expect(places.find((p) => p.id === "CONT:EU")?.name).toBe("Europe");
  });
});

describe("normalize", () => {
  it("lowercases, strips diacritics, and collapses whitespace", () => {
    expect(normalize("Curaçao")).toBe("curacao");
    expect(normalize("Malmö")).toBe("malmo");
    expect(normalize("  New   York  ")).toBe("new york");
  });
});

const places: PlaceEntry[] = [
  { id: "US", name: "United States", kind: "country", alt: ["USA", "U.S.A."] },
  { id: "USGA", name: "Georgia", kind: "state", parent: "US" },
  { id: "GG", name: "Georgia", kind: "country" },
  { id: "CU", name: "Curaçao", kind: "country" },
  { id: "USNY", name: "New York", kind: "state", parent: "US" },
  { id: "CONT:EU", name: "Europe", kind: "continent" },
];

describe("searchPlaces", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(searchPlaces(places, "")).toEqual([]);
    expect(searchPlaces(places, "   ")).toEqual([]);
  });

  it("folds diacritics and case so 'curac' and 'Curaçao' reach the same row", () => {
    const a = searchPlaces(places, "curac");
    const b = searchPlaces(places, "Curaçao");
    expect(a.map((p) => p.id)).toEqual(["CU"]);
    expect(b.map((p) => p.id)).toEqual(["CU"]);
  });

  it("ranks a prefix match above a substring match", () => {
    const withSubstring: PlaceEntry[] = [
      { id: "AA", name: "Substring Country", kind: "country" },
      { id: "BB", name: "United States", kind: "country" },
    ];
    const results = searchPlaces(withSubstring, "unit");
    expect(results[0].id).toBe("BB");
  });

  it("matches a later word in the name ('york' -> 'New York')", () => {
    const results = searchPlaces(places, "york");
    expect(results.map((p) => p.id)).toContain("USNY");
  });

  it("ranks the country above the same-named state", () => {
    const results = searchPlaces(places, "georgia");
    expect(results[0].id).toBe("GG");
    expect(results.map((p) => p.id)).toContain("USGA");
  });

  it("finds an alias hit ('USA' -> US)", () => {
    const results = searchPlaces(places, "usa");
    expect(results.map((p) => p.id)).toContain("US");
  });

  it("respects the limit", () => {
    const many: PlaceEntry[] = Array.from({ length: 20 }, (_, i) => ({
      id: `X${i}`,
      name: `Testland ${i}`,
      kind: "country",
    }));
    expect(searchPlaces(many, "testland", 3)).toHaveLength(3);
  });

  it("dedupes by id", () => {
    const duped: PlaceEntry[] = [
      { id: "US", name: "United States", kind: "country" },
      { id: "US", name: "United States", kind: "country" },
    ];
    expect(searchPlaces(duped, "united")).toHaveLength(1);
  });
});
