import { describe, expect, it } from "vitest";
import { escapeHtml, placementLine, storyPopupHtml } from "./popup";

/** A tile feature's properties, as `queryRenderedFeatures` hands them over. */
const pin = {
  title: "Storm damage closes I-45",
  source: "chron.com",
  url: "https://chron.com/storm",
  place: "Houston, Texas, United States",
  kind: "PIN",
};

describe("placementLine", () => {
  it("names the point a pin was placed at", () => {
    expect(placementLine(pin)).toBe("Houston, Texas, United States · placed automatically");
  });

  it("says a container is only somewhere in its region", () => {
    // §2.1 chose a container precisely because the story had no usable exact
    // location. "Somewhere in" is that fact said out loud; the hollow ring in
    // lib/layers.ts is the same claim made visually.
    expect(placementLine({ ...pin, kind: "CONTAINER", place: "Texas, United States" })).toBe(
      "Somewhere in Texas, United States · placed automatically",
    );
  });

  it("says nothing when there is no place to name", () => {
    // Better silent than a dangling "· placed automatically" with no subject.
    expect(placementLine({ ...pin, place: "" })).toBe("");
    expect(placementLine({ ...pin, place: undefined })).toBe("");
    expect(placementLine({ ...pin, place: "   " })).toBe("");
  });

  it("does not grade the pin", () => {
    // §5.2 decision 3, measured: mention count does not predict correctness
    // (pooled n=73, 50.0% at one mention against 70.9% at 2+, Fisher p=0.152).
    // Two pins differing only in salience or domain count must therefore read
    // identically — a per-pin hedge would claim a signal the audit says is not
    // there. See lib/popup.ts's header for the full table.
    const quiet = { ...pin, salience: 0.69, domains: 1 };
    const loud = { ...pin, salience: 4.35, domains: 40 };
    expect(placementLine(quiet)).toBe(placementLine(loud));
  });
});

describe("storyPopupHtml", () => {
  it("carries the title, the source, the placement and the link — and nothing else", () => {
    // §7 critical gap 2. §2.6 is a copyright constraint, so the assertion is
    // that the popup's text is EXACTLY these four things: anything upstream
    // starting to carry article text must fail here rather than ship.
    const html = storyPopupHtml(pin);
    const rendered = html.replace(/<[^>]*>/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean);

    expect(rendered).toEqual([
      "Storm damage closes I-45",
      "chron.com",
      "Houston, Texas, United States · placed automatically",
      "Read at source",
    ]);
  });

  it("links out rather than reproducing anything", () => {
    const html = storyPopupHtml(pin);
    expect(html).toContain('href="https://chron.com/storm"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("ignores every field that is not one of the four", () => {
    // A feature carries salience, tier1, region, country and date (worker/tiles.ts).
    // None may reach the popup — tier1 especially: §2.3 says the preference is
    // invisible, and a badge is exactly what that forbids.
    const html = storyPopupHtml({
      ...pin,
      tier1: 1,
      salience: 4.3567,
      region: "USTX",
      country: "US",
      date: "2026-08-13T10:00:00Z",
      body: "Article prose that must never render.",
    } as never);

    for (const leak of ["tier1", "4.3567", "USTX", "2026-08-13", "Article prose"]) {
      expect(html).not.toContain(leak);
    }
  });

  it("escapes remote content, in the href as well as the text", () => {
    // Title, source and url are all GDELT's, not ours.
    const html = storyPopupHtml({
      title: '<img src=x onerror="alert(1)">',
      source: "a&b.com",
      url: 'https://x.test/"onmouseover="alert(1)',
      place: "<script>",
      kind: "PIN",
    });

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("a&amp;b.com");
    // The quote is what would break out of the href attribute.
    expect(html).toContain("&quot;onmouseover=");
  });

  it("drops the placement line entirely when there is no place", () => {
    expect(storyPopupHtml({ ...pin, place: "" })).not.toContain("popup__place");
  });
});

describe("escapeHtml", () => {
  it("handles the values a missing property actually produces", () => {
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(0)).toBe("0");
  });
});
