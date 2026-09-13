import { describe, expect, it } from "vitest";
import { assertUsable, loadRefData, type RefData, sourceCountry } from "./refdata.ts";

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

  it("has all 128 tier-1 domains", () => {
    expect(data.tier1.size).toBe(128);
    expect(data.tier1.has("reuters.com")).toBe(true);
    expect(data.tier1.has("newsweek.com")).toBe(true);
  });

  it("reaches every region, not just the US and UK", () => {
    for (const domain of [
      "thehindu.com",
      "nation.africa",
      "folha.uol.com.br",
      "hani.co.kr",
      "kyivindependent.com",
      "lorientlejour.com",
      "abc.net.au",
    ]) {
      expect(data.tier1.has(domain)).toBe(true);
    }
  });

  it("strips the inline funding caveats from domains", () => {
    expect(data.tier1.has("rferl.org")).toBe(true);
    expect([...data.tier1].some((d) => d.includes("#") || d !== d.trim())).toBe(false);
  });

  it("matches domains exactly, never by suffix", () => {
    for (const impostor of [
      "warringtonguardian.co.uk",
      "dawnofthedawg.com",
      "thestar.com.my",
      "dailystar.co.uk",
    ]) {
      expect(data.tier1.has(impostor)).toBe(false);
    }
  });

  it("keeps the blocklist short and free of legitimate outlets", () => {
    expect(data.blocklist.has("iheart.com")).toBe(true);
    expect(data.blocklist.has("themarketsdaily.com")).toBe(true);
    expect(data.blocklist.has("indiatimes.com")).toBe(false);
    expect(data.blocklist.has("thehindu.com")).toBe(false);
  });
});

describe("the FIPS trap", () => {
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
    expect(data.countries.get("IS")).toEqual({ iso: "IL", name: "Israel", continent: "Asia" });
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
    countries.set("RS", { iso: "RS", name: "Serbia" });
    expect(() => assertUsable(broken({ countries }))).toThrow(/FIPS trap: RS/);
  });

  it("rejects a truncated demonym list", () => {
    expect(() => assertUsable(broken({ demonyms: new Set(["british"]) }))).toThrow(/demonym/);
  });

  it("rejects a domain that is both tier-1 and blocklisted", () => {
    expect(() =>
      assertUsable(broken({ blocklist: new Set([...data.blocklist, "reuters.com"]) }))
    ).toThrow(/both tier-1 and blocklist/);
  });
});

describe("publisher country inference", () => {
  it("resolves an explicit override before anything else", () => {
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
    expect(sourceCountry("wcvb.com", data)).toBe("");
    expect(sourceCountry("something.io", data)).toBe("");
  });

  it("returns unknown for an empty domain", () => {
    expect(sourceCountry("", data)).toBe("");
  });
});
