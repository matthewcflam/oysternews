import { describe, expect, it } from "vitest";
import type { PlacedArticle } from "@/lib/types";
import { cellOf, groupArticles, jaccard, overCommonThemes, titleTokens } from "./group";

const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);

let counter = 0;

function article(patch: Partial<PlacedArticle> = {}): PlacedArticle {
  counter++;
  return {
    date: "20260812050000",
    domain: `outlet${counter}.com`,
    url: `https://outlet${counter}.com/${counter}`,
    title: "t",
    themes: [],
    lat: 40,
    lon: -74,
    kind: "PIN",
    countryCode: "US",
    regionId: "",
    placeName: "New York",
    sourceCountry: "US",
    tier1: false,
    ...patch,
  };
}

describe("the theme ceiling", () => {
  it("excludes themes that appear on more than the ceiling of articles", () => {
    // CRISISLEX_CRISISLEXREC is on 39.4% of all GDELT articles. Without the
    // ceiling it alone joins 39% of the corpus into one story. FINDINGS §8.
    const articles = [
      ...Array.from({ length: 9 }, () => article({ themes: ["CRISISLEX", "RARE_A"] })),
      article({ themes: ["RARE_B"] }),
    ];
    const common = overCommonThemes(articles, 0.15);
    expect(common.has("CRISISLEX")).toBe(true);
    expect(common.has("RARE_B")).toBe(false);
  });

  it("counts a theme once per article even when GDELT repeats it", () => {
    const articles = [article({ themes: ["X", "X", "X"] }), article({ themes: [] })];
    expect(overCommonThemes(articles, 0.9).has("X")).toBe(false);
  });
});

describe("title tokens", () => {
  it("drops stopwords and short tokens", () => {
    expect([...titleTokens("The floods in the north of Spain")]).toEqual([
      "floods",
      "north",
      "spain",
    ]);
  });

  it("scores an identical headline as 1 and a disjoint one as 0", () => {
    expect(jaccard(titleTokens("Flood warning Perth"), titleTokens("Flood warning Perth"))).toBe(1);
    expect(jaccard(titleTokens("Flood warning Perth"), titleTokens("Cricket result Leeds"))).toBe(0);
  });
});

describe("cells", () => {
  it("puts nearby coordinates in one 0.5 degree cell and distant ones apart", () => {
    expect(cellOf(40.1, -74.1)).toBe(cellOf(40.2, -74.2));
    expect(cellOf(40.1, -74.1)).not.toBe(cellOf(41.9, -74.1));
  });
});

describe("grouping", () => {
  it("merges two outlets covering the same event", () => {
    const groups = groupArticles(
      [
        article({
          title: "Wildfire forces evacuations in the San Gabriel Valley",
          themes: ["WILDFIRE", "EVACUATION", "NATURAL_DISASTER"],
        }),
        article({
          title: "Evacuations ordered as wildfire spreads through San Gabriel Valley",
          themes: ["WILDFIRE", "EVACUATION", "EMERGENCY"],
        }),
      ],
      { now: NOW, themeCeiling: 1 },
    );
    expect(groups.length).toBe(1);
    expect(groups[0].distinctDomains).toBe(2);
  });

  it("keeps unrelated stories in the same city apart", () => {
    const groups = groupArticles(
      [
        article({ title: "Wildfire forces evacuations", themes: ["WILDFIRE", "EVACUATION"] }),
        article({ title: "Council approves new budget", themes: ["GOVERNMENT", "TAX"] }),
      ],
      { now: NOW, themeCeiling: 1 },
    );
    expect(groups.length).toBe(2);
  });

  it("requires TWO shared themes, not one", () => {
    const groups = groupArticles(
      [
        article({ title: "Flood warning issued for Perth", themes: ["FLOOD", "A"] }),
        article({ title: "Flood warning issued for Perth region", themes: ["FLOOD", "B"] }),
      ],
      { now: NOW, themeCeiling: 1 },
    );
    expect(groups.length).toBe(2);
  });

  it("requires the Jaccard floor even when themes match", () => {
    const groups = groupArticles(
      [
        article({ title: "Wildfire near Azusa", themes: ["WILDFIRE", "EVACUATION"] }),
        article({ title: "Council approves stadium funding", themes: ["WILDFIRE", "EVACUATION"] }),
      ],
      { now: NOW, themeCeiling: 1 },
    );
    expect(groups.length).toBe(2);
  });

  it("requires the same cell — the same story 3 degrees away is a different pin", () => {
    const groups = groupArticles(
      [
        article({ title: "Wildfire forces evacuations", themes: ["WILDFIRE", "EVACUATION"], lat: 40 }),
        article({ title: "Wildfire forces evacuations", themes: ["WILDFIRE", "EVACUATION"], lat: 43 }),
      ],
      { now: NOW, themeCeiling: 1 },
    );
    expect(groups.length).toBe(2);
  });

  it("collapses exact syndication regardless of themes", () => {
    // 22% of titles are duplicates, syndication 1.59x (§4). The same headline in
    // the same cell is the same story even when GDELT tags it differently.
    const groups = groupArticles(
      [
        article({ title: "Markets close higher on jobs data", themes: ["A"] }),
        article({ title: "Markets close higher on jobs data", themes: ["Z"] }),
      ],
      { now: NOW, themeCeiling: 1 },
    );
    expect(groups.length).toBe(1);
    expect(groups[0].distinctDomains).toBe(2);
  });

  it("does NOT let title dedup alone invert the salience signal", () => {
    // §2.5's whole argument for real grouping: three outlets writing their own
    // headlines about one event must become a 3-domain story, not three
    // 1-domain stories that rank below a syndicated wire copy.
    const groups = groupArticles(
      [
        article({
          domain: "nytimes.com",
          title: "Senate passes the infrastructure bill after long debate",
          themes: ["LEGISLATION_X", "INFRASTRUCTURE"],
        }),
        article({
          domain: "bbc.co.uk",
          title: "Infrastructure bill passes Senate debate",
          themes: ["LEGISLATION_X", "INFRASTRUCTURE"],
        }),
        article({
          domain: "theguardian.com",
          title: "Senate debate ends as infrastructure bill passes",
          themes: ["LEGISLATION_X", "INFRASTRUCTURE"],
        }),
      ],
      { now: NOW, themeCeiling: 1 },
    );
    expect(groups.length).toBe(1);
    expect(groups[0].distinctDomains).toBe(3);
  });

  it("path 5: a group assembled from duplicated members counts each domain once", () => {
    // §7 path 5 / §3.5: a group present in BOTH shard families must not count
    // its domains twice. state.ts dedupes by (domain, url); this asserts the
    // salience that results is identical either way.
    const members = [
      article({ domain: "a.com", url: "https://a.com/1", title: "Quake hits the coast", themes: ["QUAKE", "DAMAGE"] }),
      article({ domain: "b.com", url: "https://b.com/1", title: "Quake hits coast towns", themes: ["QUAKE", "DAMAGE"] }),
    ];
    const once = groupArticles(members, { now: NOW, themeCeiling: 1 });
    const twice = groupArticles([...members, ...members.map((m) => ({ ...m }))], {
      now: NOW,
      themeCeiling: 1,
    });
    expect(once[0].distinctDomains).toBe(2);
    expect(twice[0].distinctDomains).toBe(2);
    expect(twice[0].salience).toBe(once[0].salience);
  });

  it("shows the tier-1 article as the group's face", () => {
    const groups = groupArticles(
      [
        article({ domain: "local.com", title: "Quake hits the coast", themes: ["QUAKE", "DAMAGE"] }),
        article({
          domain: "bbc.co.uk",
          title: "Quake hits coast towns",
          themes: ["QUAKE", "DAMAGE"],
          tier1: true,
        }),
      ],
      { now: NOW, themeCeiling: 1 },
    );
    expect(groups[0].domain).toBe("bbc.co.uk");
    expect(groups[0].tier1Fresh).toBe(true);
  });

  it("keeps a stable id while the oldest member stays in the window", () => {
    // A hash over all members would change every time one more outlet picked
    // the story up, and the id is what makes selection reproducible run to run.
    const oldest = article({
      date: "20260811000000",
      url: "https://first.com/1",
      title: "Quake hits the coast",
      themes: ["QUAKE", "DAMAGE"],
    });
    const first = groupArticles([oldest], { now: NOW, themeCeiling: 1 });
    const later = groupArticles(
      [oldest, article({ title: "Quake hits coast towns", themes: ["QUAKE", "DAMAGE"] })],
      { now: NOW, themeCeiling: 1 },
    );
    expect(later[0].id).toBe(first[0].id);
  });
});
