import { describe, expect, it } from "vitest";
import { countryName, fipsForIso, flagUrl } from "./flag";

describe("flagUrl", () => {
  it("maps a FIPS country code to its ISO flag", () => {
    expect(flagUrl("ID")).toBe("https://flagcdn.com/w640/id.png");
  });

  it("does not pass FIPS codes through as ISO", () => {
    expect(flagUrl("RS")).toBe("https://flagcdn.com/w640/ru.png");
    expect(flagUrl("CH")).toBe("https://flagcdn.com/w640/cn.png");
    expect(flagUrl("IS")).toBe("https://flagcdn.com/w640/il.png");
    expect(flagUrl("AS")).toBe("https://flagcdn.com/w640/au.png");
    expect(flagUrl("UK")).toBe("https://flagcdn.com/w640/gb.png");
    expect(flagUrl("GM")).toBe("https://flagcdn.com/w640/de.png");
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

  it("names the parent country of an admin-1 id", () => {
    expect(countryName("USCA")).toBe("USA");
    expect(countryName("IN25")).toBe("India");
  });

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

  it("refuses a continent id rather than slicing it", () => {
    expect(countryName("CONT:EU")).toBe("");
    expect(countryName("CONT:EU")).not.toBe("Colombia");
  });
});

describe("fipsForIso", () => {
  it("round-trips flagUrl's own mapping", () => {
    expect(fipsForIso("RU")).toBe("RS");
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
