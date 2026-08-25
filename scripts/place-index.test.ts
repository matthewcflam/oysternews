import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { countryOutlines, placeIndexFrom, regionOutlines } from "./build-boundaries.ts";

/**
 * The searchable name -> id table behind "Where to next?".
 *
 * These exist because a bad join here is silent in the same way a bad bbox
 * is: nothing throws, a suggestion just resolves to an id the outline archive
 * cannot draw or the panel cannot answer. Mirrors region-bbox.test.ts's use
 * of small synthetic features over the real 54 MB Natural Earth files.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const countryFeature = (properties: Record<string, string>) => ({
  type: "Feature" as const,
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },
  properties,
});

const regionFeature = (properties: Record<string, string>) => ({
  type: "Feature" as const,
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },
  properties,
});

describe("countryOutlines: name and alias derivation", () => {
  it("prefers NAME_EN, falling back through NAME then NAME_LONG", () => {
    const [feature] = countryOutlines(
      [countryFeature({ FIPS_10: "SP", NAME_EN: "Spain", NAME: "España", NAME_LONG: "Kingdom of Spain" })],
      new Map(),
      {},
    );
    expect(feature.properties.name).toBe("Spain");
  });

  it("treats Natural Earth's -99 sentinel as absent, not as a literal value", () => {
    const [feature] = countryOutlines(
      [countryFeature({ FIPS_10: "XX", NAME_EN: "-99", NAME: "Realname", NAME_LONG: "-99" })],
      new Map(),
      {},
    );
    expect(feature.properties.name).toBe("Realname");
  });

  it("collects a bounded, deduped alias list and drops aliases equal to the name", () => {
    const [feature] = countryOutlines(
      [
        countryFeature({
          FIPS_10: "RS",
          NAME_EN: "Russia",
          NAME_LONG: "Russia",
          FORMAL_EN: "Russian Federation",
          ABBREV: "Rus.",
        }),
      ],
      new Map(),
      { RS: { iso: "RU", name: "Russian Federation" } },
    );
    expect(feature.properties.alt).toEqual(["Russian Federation", "Rus."]);
  });
});

describe("regionOutlines: the US postal rewrite and name/parent derivation", () => {
  it("derives USCA from iso_3166_2, never the Natural Earth numeric fips", () => {
    const byIso = new Map([["US", "US"]]);
    const [feature] = regionOutlines(
      [
        regionFeature({
          iso_3166_2: "US-CA",
          fips: "US06",
          name_en: "California",
          iso_a2: "US",
        }),
      ],
      byIso,
    );
    expect(feature.properties.id).toBe("USCA");
    expect(feature.properties.id).not.toBe("US06");
  });

  it("prefers name_en over name", () => {
    const [feature] = regionOutlines(
      [
        regionFeature({
          iso_3166_2: "FR-A",
          fips: "FR01",
          name_en: "Alsace",
          name: "Alsace (local)",
          iso_a2: "FR",
        }),
      ],
      new Map(),
    );
    expect(feature.properties.name).toBe("Alsace");
  });

  it("resolves parent to the country FIPS via the byIso map", () => {
    const byIso = new Map([["US", "US"]]);
    const [feature] = regionOutlines(
      [regionFeature({ iso_3166_2: "US-TX", fips: "US48", name_en: "Texas", iso_a2: "US" })],
      byIso,
    );
    expect(feature.properties.parent).toBe("US");
  });
});

describe("placeIndexFrom", () => {
  it("drops an id with no matching bbox", () => {
    const countries = [countryFeature({ id: "ZZ", name: "Nowhere" })];
    const entries = placeIndexFrom(countries, [], {});
    expect(entries).toEqual([]);
  });

  it("keeps an id with a matching bbox", () => {
    const countries = [countryFeature({ id: "SP", name: "Spain" })];
    const entries = placeIndexFrom(countries, [], { SP: [-9, 36, 4, 43] });
    expect(entries).toEqual([{ id: "SP", name: "Spain", kind: "country" }]);
  });

  it("orders countries before regions", () => {
    const countries = [countryFeature({ id: "US", name: "United States" })];
    const regions = [regionFeature({ id: "USCA", name: "California", parent: "US" })];
    const entries = placeIndexFrom(countries, regions, { US: [0, 0, 1, 1], USCA: [0, 0, 1, 1] });
    expect(entries.map((e) => e.id)).toEqual(["US", "USCA"]);
    expect(entries[1].kind).toBe("state");
    expect(entries[1].parent).toBe("US");
  });

  it("skips an entry with no name", () => {
    const countries = [countryFeature({ id: "ZZ", name: "" })];
    const entries = placeIndexFrom(countries, [], { ZZ: [0, 0, 1, 1] });
    expect(entries).toEqual([]);
  });
});

/**
 * The mechanical guarantee: every id the committed place index offers as a
 * suggestion is an id the committed bbox table can fly the camera to. This is
 * what actually prevents a dead search result in production, since the unit
 * tests above exercise the *logic* but not the real, committed output.
 */
describe("committed artifacts", () => {
  it("every place-index id exists in region-bbox.json", async () => {
    const [places, bboxes] = await Promise.all([
      readFile(path.join(REPO_ROOT, "public", "place-index.json"), "utf8").then(JSON.parse),
      readFile(path.join(REPO_ROOT, "public", "region-bbox.json"), "utf8").then(JSON.parse),
    ]);

    const missing = places.filter((place: { id: string }) => !(place.id in bboxes));
    expect(missing).toEqual([]);
  });
});
