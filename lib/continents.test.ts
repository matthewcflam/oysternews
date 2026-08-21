import { describe, expect, it } from "vitest";
import crosswalk from "@/data/crosswalk.json";
import { CONTINENT_BBOX, continentIdFor } from "./continents";

describe("continentIdFor", () => {
  it("resolves every continent MapTiler's live style carries (name:en, 2026-08-21)", () => {
    expect(continentIdFor("Africa")).toBe("CONT:AF");
    expect(continentIdFor("Antarctica")).toBe("CONT:AN");
    expect(continentIdFor("Asia")).toBe("CONT:AS");
    expect(continentIdFor("Europe")).toBe("CONT:EU");
    expect(continentIdFor("North America")).toBe("CONT:NA");
    expect(continentIdFor("South America")).toBe("CONT:SA");
    expect(continentIdFor("Australia")).toBe("CONT:OC");
  });

  it("resolves Natural Earth's spelling of the same continent MapTiler calls Australia", () => {
    expect(continentIdFor("Oceania")).toBe(continentIdFor("Australia"));
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(continentIdFor("  EUROPE  ")).toBe("CONT:EU");
  });

  it("returns null for anything outside the closed table", () => {
    expect(continentIdFor("Atlantis")).toBeNull();
    expect(continentIdFor("")).toBeNull();
    expect(continentIdFor(null)).toBeNull();
    expect(continentIdFor(undefined)).toBeNull();
    expect(continentIdFor("Seven seas (open ocean)")).toBeNull();
  });
});

describe("CONTINENT_BBOX", () => {
  it("has exactly the seven ids continentIdFor can produce", () => {
    const ids = ["CONT:AF", "CONT:AN", "CONT:AS", "CONT:EU", "CONT:NA", "CONT:OC", "CONT:SA"].sort();
    expect(Object.keys(CONTINENT_BBOX).sort()).toEqual(ids);
  });

  it("every box is a valid, non-degenerate [west, south, east, north]", () => {
    for (const box of Object.values(CONTINENT_BBOX)) {
      const [west, south, east, north] = box;
      expect(box).toHaveLength(4);
      expect(box.every((n) => Number.isFinite(n))).toBe(true);
      expect(east).toBeGreaterThan(west);
      expect(north).toBeGreaterThan(south);
    }
  });

  it("Oceania crosses the antimeridian in the same east>180 form region-bbox.json uses for Fiji", () => {
    expect(CONTINENT_BBOX["CONT:OC"][2]).toBeGreaterThan(180);
  });
});

describe("data/crosswalk.json's continent column", () => {
  it("gives every country a name continentIdFor can resolve, or leaves it empty", () => {
    const rows = Object.values((crosswalk as { fips: Record<string, { continent?: string }> }).fips);
    for (const row of rows) {
      if (!row.continent) continue;
      expect(continentIdFor(row.continent)).not.toBeNull();
    }
  });
});
