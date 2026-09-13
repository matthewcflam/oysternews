import { describe, expect, it } from "vitest";
import { linkLabel, panelStory, placeLine, publishedAt } from "./story";

const pin = {
  title: "Storm damage closes I-45",
  source: "chron.com",
  url: "https://chron.com/storm",
  place: "Houston, Texas, United States",
  kind: "PIN",
  date: "20260813193400",
  image: "https://chron.com/storm.jpg",
  more: "https://ap.org/storm\nhttps://reuters.com/storm",
};

describe("panelStory", () => {
  it("carries the title, source, url, place, kind, date, image and more — and nothing else", () => {
    expect(Object.keys(panelStory(pin) ?? {}).sort()).toEqual([
      "date",
      "image",
      "kind",
      "more",
      "place",
      "source",
      "title",
      "url",
    ]);
  });

  it("drops every field that is not one of the eight, topic included", () => {
    const story = panelStory({
      ...pin,
      tier1: 1,
      salience: 4.3567,
      domains: 40,
      region: "USTX",
      country: "US",
      topic: "Disaster",
      body: "Article prose that must never render.",
    }) as Record<string, unknown>;

    for (const leak of ["tier1", "salience", "domains", "region", "country", "topic", "body"]) {
      expect(story).not.toHaveProperty(leak);
    }
    expect(JSON.stringify(story)).not.toContain("Article prose");
  });

  it("splits the coverage links and drops any scheme that is not http(s)", () => {
    expect(panelStory(pin)?.more).toEqual(["https://ap.org/storm", "https://reuters.com/storm"]);

    expect(
      panelStory({
        ...pin,
        more: "javascript:alert(1)\nhttps://ap.org/storm\ndata:text/html,<script>",
      })?.more
    ).toEqual(["https://ap.org/storm"]);
  });

  it("reads an absent `more` as an empty list, because that is the common case", () => {
    const { more } = panelStory({ ...pin, more: undefined })!;
    expect(more).toEqual([]);
    expect(panelStory({ ...pin, more: "" })?.more).toEqual([]);
  });

  it("refuses a feature with no url", () => {
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
      image: "",
      more: [],
    });
  });
});

describe("linkLabel", () => {
  it("names the host, without www", () => {
    expect(linkLabel("https://www.chron.com/storm/i-45")).toBe("chron.com");
    expect(linkLabel("https://apnews.com/article/x?utm=1")).toBe("apnews.com");
  });

  it("says nothing for a url it cannot parse", () => {
    expect(linkLabel("not a url")).toBe("");
    expect(linkLabel("")).toBe("");
  });
});

describe("placeLine", () => {
  const at = (place: string, kind = "PIN") => placeLine({ place, kind });

  it("keeps every part of the place name", () => {
    expect(at("Anaheim, California, United States")).toBe("Anaheim, California, USA");
    expect(at("Lahore, Punjab, Pakistan")).toBe("Lahore, Punjab, Pakistan");
  });

  it("shortens the two countries whose full names wrap a 390px line", () => {
    expect(at("Leeds, England, United Kingdom")).toBe("Leeds, England, UK");
  });

  it("returns a one-part name as it stands", () => {
    expect(at("France")).toBe("France");
    expect(at("United States")).toBe("USA");
  });

  it("says a container is only somewhere in its region", () => {
    expect(at("Texas, United States", "CONTAINER")).toBe("Somewhere in Texas, USA");
  });

  it("says nothing when there is no place to name", () => {
    expect(at("")).toBe("");
    expect(at("  ,  , ")).toBe("");
    expect(at("", "CONTAINER")).toBe("");
  });

  it("does not grade the pin", () => {
    const quiet = panelStory({ ...pin, salience: 0.69, domains: 1 })!;
    const loud = panelStory({ ...pin, salience: 4.35, domains: 40 })!;
    expect(placeLine(quiet)).toBe(placeLine(loud));
  });
});

describe("publishedAt", () => {
  const now = Date.UTC(2026, 7, 13, 22, 34, 0);

  it("renders the age, not a clock face", () => {
    expect(publishedAt("20260813193400", now)).toBe("3 hours ago");
  });

  it("reads the stamp as UTC regardless of the machine's zone", () => {
    expect(publishedAt("20260813223400", now)).toBe("just now");
    expect(publishedAt("20260812223400", now)).toBe("a day ago");
  });

  it("says nothing for a stamp it cannot parse", () => {
    expect(publishedAt("", now)).toBe("");
    expect(publishedAt("2026-08-13", now)).toBe("");
    expect(publishedAt("not a date", now)).toBe("");
  });
});
