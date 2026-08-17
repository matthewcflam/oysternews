import { describe, expect, it } from "vitest";
import { linkLabel, panelStory, placeLine, publishedAt } from "./story";

/** A tile feature's properties, as `queryRenderedFeatures` hands them over. */
const pin = {
  title: "Storm damage closes I-45",
  source: "chron.com",
  url: "https://chron.com/storm",
  place: "Houston, Texas, United States",
  kind: "PIN",
  date: "20260813193400",
  image: "https://chron.com/storm.jpg",
  // A `\n`-joined string, not an array: MVT property values are scalar. See
  // `worker/tiles.ts` — pinned there too, because an array is silently
  // JSON-stringified and triples what the field costs in the archive.
  more: "https://ap.org/storm\nhttps://reuters.com/storm",
};

describe("panelStory", () => {
  it("carries the title, source, url, place, kind, date, image and more — and nothing else", () => {
    // §7 critical gap 2, inherited from the deleted popup.test.ts. §2.6 is a
    // copyright constraint, so the assertion is that the panel's content model
    // is EXACTLY these eight fields: anything upstream that starts carrying
    // article text must fail here rather than ship.
    //
    // **Six until 2026-08-14 (the thumbnail), seven until 2026-08-16 (the
    // coverage links).** The list growing is the assertion weakening, so it is
    // changed by hand and never widened to make a failure go away. Each of the
    // two additions is defensible in one sentence — an image URL and a list of
    // article URLs are both pointers to publishers, the same class of thing as
    // `url` — and anything that is not defensible in one sentence does not
    // belong on this list.
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
    // A feature carries salience, domains, tier1, region and country
    // (worker/tiles.ts). None may reach the panel — tier1 least of all: §2.3
    // says the preference is invisible, and a badge is exactly what that forbids.
    //
    // **`topic` is on this list by decision, not by omission.** The classifier
    // exists and the tile carries the field, but the story card shows no topic
    // label — chips filter a region's rows, which is Mode 3. If that ever
    // changes, `topic` moves to the allowlist above and this line comes out;
    // what must not happen is it arriving in neither place.
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
    // The second lock on a door `worker/parse.ts` already holds: these urls are
    // rendered as hrefs the reader clicks, and `javascript:` and `data:` are the
    // two schemes that turn a link into code. A pipeline change that started
    // emitting one would otherwise reach the DOM before anyone read the diff.
    expect(panelStory(pin)?.more).toEqual([
      "https://ap.org/storm",
      "https://reuters.com/storm",
    ]);

    expect(
      panelStory({
        ...pin,
        more: "javascript:alert(1)\nhttps://ap.org/storm\ndata:text/html,<script>",
      })?.more,
    ).toEqual(["https://ap.org/storm"]);
  });

  it("reads an absent `more` as an empty list, because that is the common case", () => {
    // 87.2% of groups are a single article and carry no coverage at all
    // (measured). The field is also simply absent until the pipeline half of
    // Mode 2 lands, and absent has to read the same as empty — the card omits
    // the section either way rather than rendering an empty heading.
    const { more } = panelStory({ ...pin, more: undefined })!;
    expect(more).toEqual([]);
    expect(panelStory({ ...pin, more: "" })?.more).toEqual([]);
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
      // 12.2% of GDELT records carry no sharing image, so "" is the normal
      // answer here rather than the degraded one — the panel has a designed
      // header for it.
      image: "",
      more: [],
    });
  });
});

describe("linkLabel", () => {
  it("names the host, without www", () => {
    // A domain, not a masthead — `chron.com`, not "The Houston Chronicle". A
    // domain-to-publisher lookup is §3.4's join-on-names trap wearing display
    // clothing: it fails silently and plausibly on the outlets nobody checks.
    expect(linkLabel("https://www.chron.com/storm/i-45")).toBe("chron.com");
    expect(linkLabel("https://apnews.com/article/x?utm=1")).toBe("apnews.com");
  });

  it("says nothing for a url it cannot parse", () => {
    // The card drops the row rather than printing a bare href at a reader.
    expect(linkLabel("not a url")).toBe("");
    expect(linkLabel("")).toBe("");
  });
});

describe("placeLine", () => {
  const at = (place: string, kind = "PIN") => placeLine({ place, kind });

  it("keeps every part of the place name", () => {
    // The admin-1 is what separates one Springfield from the next, and at 12px
    // in a 288px column all three parts fit. `placeHeading` dropped the middle
    // because it printed at 34px across the hero; that heading is gone.
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
    // §2.1 chose a container precisely because the story had no usable exact
    // location. "Somewhere in" is that fact said out loud; the hollow ring in
    // lib/layers.ts is the same claim made visually. **This is the half of the
    // deleted `placementLine` that had to survive Mode 2** — the other half, "·
    // placed automatically", moved to /about behind "How does this work?".
    expect(at("Texas, United States", "CONTAINER")).toBe("Somewhere in Texas, USA");
  });

  it("says nothing when there is no place to name", () => {
    // Better silent than a dangling "Somewhere in" with no subject.
    expect(at("")).toBe("");
    expect(at("  ,  , ")).toBe("");
    expect(at("", "CONTAINER")).toBe("");
  });

  it("does not grade the pin", () => {
    // §5.2 decision 3, measured: mention count does not predict correctness
    // (pooled n=73, 50.0% at one mention against 70.9% at 2+, Fisher p=0.152).
    // Two stories differing only in salience or domain count must read
    // identically — a per-pin hedge would claim a signal the audit says is not
    // there. See lib/story.ts's header for the full table.
    const quiet = panelStory({ ...pin, salience: 0.69, domains: 1 })!;
    const loud = panelStory({ ...pin, salience: 4.35, domains: 40 })!;
    expect(placeLine(quiet)).toBe(placeLine(loud));
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
