import { describe, expect, it } from "vitest";
import { flagUrl } from "./flag";

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
