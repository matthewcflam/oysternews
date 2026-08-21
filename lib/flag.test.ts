import { describe, expect, it } from "vitest";
import { countryName, fipsForIso, flagUrl } from "./flag";

describe("flagUrl", () => {
  it("maps a FIPS country code to its ISO flag", () => {
    expect(flagUrl("ID")).toBe("https://flagcdn.com/w640/id.png");
  });

  /**
   * §3.4's four collisions, and the whole reason this goes through the
   * crosswalk. Each of these is a real country whose FIPS code is a DIFFERENT
   * real country's ISO code, so a passthrough returns a flag that loads fine and
   * is simply the wrong nation.
   */
  it("does not pass FIPS codes through as ISO", () => {
    expect(flagUrl("RS")).toBe("https://flagcdn.com/w640/ru.png"); // Russia, not Serbia
    expect(flagUrl("CH")).toBe("https://flagcdn.com/w640/cn.png"); // China, not Switzerland
    expect(flagUrl("IS")).toBe("https://flagcdn.com/w640/il.png"); // Israel, not Iceland
    expect(flagUrl("AS")).toBe("https://flagcdn.com/w640/au.png"); // Australia, not Am. Samoa
    expect(flagUrl("UK")).toBe("https://flagcdn.com/w640/gb.png"); // GB is the ISO code
    expect(flagUrl("GM")).toBe("https://flagcdn.com/w640/de.png"); // Germany, not Gambia
  });

  it("returns null for an admin-1 id, which has no flag", () => {
    expect(flagUrl("USCA")).toBeNull();
    expect(flagUrl("IN25")).toBeNull();
  });

  it("returns null for an unknown or empty code rather than a broken URL", () => {
    expect(flagUrl("ZZ")).toBeNull();
    expect(flagUrl("")).toBeNull();
    expect(flagUrl("U")).toBeNull();
  });

  it("accepts the id in the case the outline archive happens to use", () => {
    expect(flagUrl("uk")).toBe("https://flagcdn.com/w640/gb.png");
  });
});

describe("countryName", () => {
  it("names a country from its own FIPS code", () => {
    expect(countryName("IN")).toBe("India");
  });

  /**
   * The breadcrumb's whole job on an admin-1: `USCA` is California IN the USA,
   * and the parent is the id's prefix rather than a name lookup (§3.4).
   */
  it("names the parent country of an admin-1 id", () => {
    expect(countryName("USCA")).toBe("USA");
    expect(countryName("IN25")).toBe("India");
  });

  /** Shared with `placeLine`, so a breadcrumb and a story row agree. */
  it("shortens the countries the place line shortens", () => {
    expect(countryName("UK")).toBe("UK");
    expect(countryName("US")).toBe("USA");
  });

  it("reads the overrides, not just the generated crosswalk", () => {
    expect(countryName("IS")).toBe("Israel");
  });

  it("returns '' for a code the crosswalk does not carry, so the crumb drops", () => {
    expect(countryName("ZZ")).toBe("");
    expect(countryName("")).toBe("");
  });

  /**
   * §4 regression: a naive `.slice(0, 2)` reads `CONT:EU`'s first two
   * characters as the FIPS code "CO" — Colombia — and the breadcrumb would
   * read `World › Colombia › Europe`. Anything not FIPS-shaped must refuse
   * rather than slice.
   */
  it("refuses a continent id rather than slicing it", () => {
    expect(countryName("CONT:EU")).toBe("");
    expect(countryName("CONT:EU")).not.toBe("Colombia");
  });
});

describe("fipsForIso", () => {
  it("round-trips flagUrl's own mapping", () => {
    expect(fipsForIso("RU")).toBe("RS"); // Russia's FIPS code, not Serbia's
    expect(fipsForIso("GB")).toBe("UK");
  });

  it("reads the overrides, not just the generated crosswalk", () => {
    expect(fipsForIso("IL")).toBe("IS");
  });

  it("returns null for an unknown or empty code", () => {
    expect(fipsForIso("ZZ")).toBeNull();
    expect(fipsForIso("")).toBeNull();
  });

  it("is case-insensitive, matching city_label's own iso_a2 casing", () => {
    expect(fipsForIso("id")).toBe("ID");
  });
});
