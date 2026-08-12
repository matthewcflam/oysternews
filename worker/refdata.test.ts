import { describe, expect, it } from "vitest";
import { assertUsable, loadRefData, sourceCountry, type RefData } from "./refdata.ts";

/**
 * These run against the REAL data/ directory rather than fixtures. That is the
 * point: §3.2 asks for a build-time coverage check, and a check against a mock
 * would pass while the shipped crosswalk was missing Israel.
 */
const data = await loadRefData();

describe("data/ loads and is usable", () => {
  it("has the whole crosswalk, not a truncated one", () => {
    expect(data.countries.size).toBeGreaterThan(230);
  });

  it("carries every demonym, including the state ones", () => {
    expect(data.demonyms.size).toBeGreaterThan(150);
    expect(data.demonyms.has("texans")).toBe(true);
    expect(data.demonyms.has("americans")).toBe(true);
  });

  it("has all 28 tier-1 domains", () => {
    // §6 decision 9: membership is load-bearing, so the count is asserted.
    expect(data.tier1.size).toBe(28);
    expect(data.tier1.has("reuters.com")).toBe(true);
    expect(data.tier1.has("newsweek.com")).toBe(true);
  });

  it("keeps the blocklist short and free of legitimate outlets", () => {
    expect(data.blocklist.has("iheart.com")).toBe(true);
    expect(data.blocklist.has("themarketsdaily.com")).toBe(true);
    expect(data.blocklist.has("indiatimes.com")).toBe(false);
    expect(data.blocklist.has("thehindu.com")).toBe(false);
  });
});

describe("the FIPS trap (§3.4)", () => {
  it.each([
    ["RS", "RU", "Russia, not Serbia"],
    ["CH", "CN", "China, not Switzerland"],
    ["IS", "IL", "Israel, not Iceland"],
    ["AS", "AU", "Australia, not American Samoa"],
    ["UK", "GB", "the United Kingdom, unassigned in ISO"],
  ])("maps FIPS %s to %s — %s", (fips, iso) => {
    expect(data.countries.get(fips)?.iso).toBe(iso);
  });

  it("covers Israel, which Natural Earth has no FIPS_10 for at all", () => {
    // 1.7% of all location mentions in the measured sample — the largest single
    // hole, and the reason data/fips-overrides.json exists.
    expect(data.countries.get("IS")).toEqual({ iso: "IL", name: "Israel" });
  });

  it("knows the oceans are not gaps", () => {
    expect(data.nonCountries.has("OS")).toBe(true);
    expect(data.countries.has("OS")).toBe(false);
  });
});

describe("assertUsable", () => {
  const broken = (patch: Partial<RefData>): RefData => ({ ...data, ...patch });

  it("rejects a crosswalk that lost the FIPS collisions", () => {
    const countries = new Map(data.countries);
    countries.set("RS", { iso: "RS", name: "Serbia" }); // the naive ISO join
    expect(() => assertUsable(broken({ countries }))).toThrow(/FIPS trap: RS/);
  });

  it("rejects a truncated demonym list", () => {
    expect(() => assertUsable(broken({ demonyms: new Set(["british"]) }))).toThrow(/demonym/);
  });

  it("rejects a domain that is both tier-1 and blocklisted", () => {
    expect(() =>
      assertUsable(broken({ blocklist: new Set([...data.blocklist, "reuters.com"]) })),
    ).toThrow(/both tier-1 and blocklist/);
  });
});

describe("publisher country inference", () => {
  it("resolves an explicit override before anything else", () => {
    // reuters.com is a .com but is not American.
    expect(sourceCountry("reuters.com", data)).toBe("GB");
  });

  it("resolves a ccTLD", () => {
    expect(sourceCountry("lemonde.fr", data)).toBe("FR");
    expect(sourceCountry("smh.com.au", data)).toBe("AU");
  });

  it("maps .uk to GB rather than inventing a UK ISO code", () => {
    expect(sourceCountry("bbc.co.uk", data)).toBe("GB");
  });

  it("returns unknown for a generic TLD it has no override for", () => {
    // The measured residue: US local broadcast stations. Callers must exclude
    // these from the distinct-country count rather than bucket them together.
    expect(sourceCountry("wcvb.com", data)).toBe("");
    expect(sourceCountry("something.io", data)).toBe("");
  });

  it("returns unknown for an empty domain", () => {
    expect(sourceCountry("", data)).toBe("");
  });
});
