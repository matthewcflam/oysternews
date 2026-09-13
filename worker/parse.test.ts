import { describe, expect, it } from "vitest";
import {
  columns,
  MIN_COLS,
  parseBundle,
  parseLocations,
  parseRow,
  parseSharingImage,
  parseThemes,
  unescapeEntities,
} from "./parse.ts";

function row(
  fields: Partial<{
    date: string;
    source: string;
    url: string;
    themes: string;
    locations: string;
    image: string;
    extras: string;
  }>,
  columnCount = MIN_COLS
): string {
  const cells = new Array(Math.max(columnCount, MIN_COLS)).fill("");
  cells[1] = fields.date ?? "20260812050000";
  cells[3] = fields.source ?? "Example.COM";
  cells[4] = fields.url ?? "https://example.com/a";
  cells[8] = fields.themes ?? "";
  cells[10] = fields.locations ?? "";
  cells[18] = fields.image ?? "";
  cells[26] = fields.extras ?? "<PAGE_TITLE>A title</PAGE_TITLE>";
  cells[17] = "wc:100,c1.1:5,c12.1:9";
  return cells.slice(0, columnCount).join("\t");
}

describe("the schema canary", () => {
  it("accepts exactly 27 columns", () => {
    expect(columns(row({}, 27))).not.toBeNull();
  });

  it("accepts MORE than 27 — GDELT appending a column must not take the map down", () => {
    expect(columns(row({}, 31))).not.toBeNull();
  });

  it("rejects fewer than 27", () => {
    expect(columns(row({}, 26))).toBeNull();
  });

  it("counts a trailing empty column rather than dropping it", () => {
    const short = "a\t".repeat(26);
    expect(columns(short)).not.toBeNull();
  });
});

describe("titles", () => {
  it("extracts and unescapes PAGE_TITLE", () => {
    const { article } = parseRow(
      row({ extras: "<PAGE_TITLE>Bath &amp; North East Somerset</PAGE_TITLE>" })
    );
    expect(article?.title).toBe("Bath & North East Somerset");
  });

  it("handles numeric and hex entities", () => {
    expect(unescapeEntities("It&#39;s &#x2014; here")).toBe("It's — here");
  });

  it("leaves an unknown entity alone rather than mangling it", () => {
    expect(unescapeEntities("A &notarealentity; B")).toBe("A &notarealentity; B");
  });

  it("treats a record with no title as unusable", () => {
    const { article, short } = parseRow(row({ extras: "<OTHER>x</OTHER>" }));
    expect(article).toBeNull();
    expect(short).toBe(false);
  });

  it("lowercases the domain, because SourceCommonName is not normalized", () => {
    const { article } = parseRow(row({ source: "Example.COM" }));
    expect(article?.domain).toBe("example.com");
  });
});

describe("locations", () => {
  const one = "4#Perth, Western Australia, Australia#AS#AS08#0#-31.9333#115.833#12345#678";

  it("parses a full location", () => {
    const [location] = parseLocations(one);
    expect(location).toMatchObject({
      type: 4,
      name: "Perth, Western Australia, Australia",
      countryCode: "AS",
      adm1Code: "AS08",
      lat: -31.9333,
      lon: 115.833,
      featureId: "12345",
      offset: 678,
    });
  });

  it("keeps one entry per mention, which is what placement counts", () => {
    expect(parseLocations([one, one, one].join(";")).length).toBe(3);
  });

  it("skips 0,0 — GDELT's null island, not a place in the Gulf of Guinea", () => {
    expect(parseLocations("1#Nowhere#XX#0#0#0#0#1#2")).toEqual([]);
  });

  it("skips malformed chunks instead of throwing", () => {
    expect(parseLocations("garbage;4#X#US#0#0#1#2#3#4;;").length).toBe(1);
  });

  it("sorts a missing offset last rather than first", () => {
    const [location] = parseLocations("4#X#US#0#0#1#2#3#notanumber");
    expect(location.offset).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("the sharing image", () => {
  it("reads the publisher's image off column 18", () => {
    const { article } = parseRow(row({ image: "https://cdn.example.com/a.jpg" }));
    expect(article?.image).toBe("https://cdn.example.com/a.jpg");
  });

  it("refuses every scheme but http and https", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
    ]) {
      expect(parseSharingImage(hostile)).toBe("");
    }
  });

  it("returns empty for junk rather than passing it through", () => {
    expect(parseSharingImage("")).toBe("");
    expect(parseSharingImage("   ")).toBe("");
    expect(parseSharingImage("not a url")).toBe("");
    expect(parseSharingImage("/relative/path.jpg")).toBe("");
  });

  it("takes the first usable value when the field is multi-valued", () => {
    expect(parseSharingImage("https://a.test/1.jpg;https://b.test/2.jpg")).toBe(
      "https://a.test/1.jpg"
    );
    expect(parseSharingImage("javascript:alert(1);https://b.test/2.jpg")).toBe(
      "https://b.test/2.jpg"
    );
  });
});

describe("themes", () => {
  it("strips the offsets", () => {
    expect(parseThemes("TAX_FNCACT,10;WB_696,25;")).toEqual(["TAX_FNCACT", "WB_696"]);
  });

  it("returns nothing for an empty field", () => {
    expect(parseThemes("")).toEqual([]);
  });
});

describe("parseBundle", () => {
  it("counts rows, short rows and missing titles separately", () => {
    const csv = [
      row({}),
      row({}, 20),
      row({ extras: "" }),
      "",
      row({ locations: "4#X#US#0#0#1#2#3#4" }),
    ].join("\n");

    const result = parseBundle(csv);
    expect(result.rows).toBe(4);
    expect(result.shortRows).toBe(1);
    expect(result.noTitle).toBe(1);
    expect(result.articles.length).toBe(2);
  });
});
