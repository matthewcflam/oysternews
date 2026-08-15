import { describe, expect, it } from "vitest";
import { panelStory, placeHeading, placementLine, publishedAt } from "./story";

/** A tile feature's properties, as `queryRenderedFeatures` hands them over. */
const pin = {
  title: "Storm damage closes I-45",
  source: "chron.com",
  url: "https://chron.com/storm",
  place: "Houston, Texas, United States",
  kind: "PIN",
  date: "20260813193400",
};

describe("panelStory", () => {
  it("carries the title, source, url, place, kind and date — and nothing else", () => {
    // §7 critical gap 2, inherited from the deleted popup.test.ts. §2.6 is a
    // copyright constraint, so the assertion is that the panel's content model
    // is EXACTLY these six fields: anything upstream that starts carrying
    // article text must fail here rather than ship.
    expect(Object.keys(panelStory(pin) ?? {}).sort()).toEqual([
      "date",
      "kind",
      "place",
      "source",
      "title",
      "url",
    ]);
  });

  it("drops every field that is not one of the six", () => {
    // A feature carries salience, domains, tier1, region and country
    // (worker/tiles.ts). None may reach the panel — tier1 least of all: §2.3
    // says the preference is invisible, and a badge is exactly what that forbids.
    const story = panelStory({
      ...pin,
      tier1: 1,
      salience: 4.3567,
      domains: 40,
      region: "USTX",
      country: "US",
      body: "Article prose that must never render.",
    }) as Record<string, unknown>;

    for (const leak of ["tier1", "salience", "domains", "region", "country", "body"]) {
      expect(story).not.toHaveProperty(leak);
    }
    expect(JSON.stringify(story)).not.toContain("Article prose");
  });

  it("refuses a feature with no url", () => {
    // The url is the story's identity everywhere else in the client: the
    // promoted feature id, the spider's dedupe key, the top-5 state key. A
    // feature without one cannot be selected, excluded from its own nearby list,
    // or linked out to.
    expect(panelStory({ ...pin, url: "" })).toBeNull();
    expect(panelStory({ ...pin, url: undefined })).toBeNull();
    expect(panelStory(null)).toBeNull();
    expect(panelStory("not an object")).toBeNull();
  });

  it("survives the missing and mistyped fields a tile can actually produce", () => {
    const story = panelStory({ url: "https://x.test/a", title: 7, place: null });
    expect(story).toEqual({
      title: "",
      source: "",
      url: "https://x.test/a",
      place: "",
      kind: "",
      date: "",
    });
  });
});

describe("placeHeading", () => {
  it("keeps the two ends of a full place name", () => {
    // The middle is what the reader already infers from the map in front of them.
    expect(placeHeading("Anaheim, California, United States")).toBe("Anaheim, USA");
    expect(placeHeading("Lahore, Punjab, Pakistan")).toBe("Lahore, Pakistan");
  });

  it("shortens the two countries whose full names wrap a 390px heading", () => {
    expect(placeHeading("Leeds, England, United Kingdom")).toBe("Leeds, UK");
  });

  it("does not duplicate a one-part name", () => {
    // A country-level container has no city and no admin-1. "France, France"
    // would be worse than the name on its own.
    expect(placeHeading("France")).toBe("France");
    expect(placeHeading("United States")).toBe("USA");
  });

  it("says nothing when there is no place", () => {
    expect(placeHeading("")).toBe("");
    expect(placeHeading("  ,  , ")).toBe("");
  });
});

describe("placementLine", () => {
  it("names the point a pin was placed at", () => {
    expect(placementLine(pin)).toBe("Houston, Texas, United States · placed automatically");
  });

  it("says a container is only somewhere in its region", () => {
    // §2.1 chose a container precisely because the story had no usable exact
    // location. "Somewhere in" is that fact said out loud; the hollow ring in
    // lib/layers.ts is the same claim made visually.
    expect(placementLine({ kind: "CONTAINER", place: "Texas, United States" })).toBe(
      "Somewhere in Texas, United States · placed automatically",
    );
  });

  it("says nothing when there is no place to name", () => {
    // Better silent than a dangling "· placed automatically" with no subject.
    expect(placementLine({ ...pin, place: "" })).toBe("");
    expect(placementLine({ ...pin, place: "   " })).toBe("");
  });

  it("does not grade the pin", () => {
    // §5.2 decision 3, measured: mention count does not predict correctness
    // (pooled n=73, 50.0% at one mention against 70.9% at 2+, Fisher p=0.152).
    // Two stories differing only in salience or domain count must read
    // identically — a per-pin hedge would claim a signal the audit says is not
    // there. See lib/story.ts's header for the full table.
    const quiet = panelStory({ ...pin, salience: 0.69, domains: 1 })!;
    const loud = panelStory({ ...pin, salience: 4.35, domains: 40 })!;
    expect(placementLine(quiet)).toBe(placementLine(loud));
  });
});

describe("publishedAt", () => {
  // The stamp is UTC at the source, so `now` is given as UTC too. Injected
  // rather than read off the clock: the label is a function of both instants,
  // and a test that raced the wall clock would fail at its own boundaries.
  const now = Date.UTC(2026, 7, 13, 22, 34, 0);

  it("renders the age, not a clock face", () => {
    expect(publishedAt("20260813193400", now)).toBe("3 hours ago");
  });

  it("reads the stamp as UTC regardless of the machine's zone", () => {
    // The regression this guards: parsing the stamp as LOCAL time would shift
    // the age by the runner's offset, which is silent and passes in London.
    expect(publishedAt("20260813223400", now)).toBe("just now");
    expect(publishedAt("20260812223400", now)).toBe("a day ago");
  });

  it("says nothing for a stamp it cannot parse", () => {
    // Silence beats "Invalid Date" in a panel. Date.parse reads this format as
    // invalid in every engine, and the 8-character prefix as a LOCAL date in
    // some — both silent, which is why the parse is by field.
    expect(publishedAt("", now)).toBe("");
    expect(publishedAt("2026-08-13", now)).toBe("");
    expect(publishedAt("not a date", now)).toBe("");
  });
});
