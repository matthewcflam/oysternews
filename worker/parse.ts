import type { Article, GdeltLocation } from "../src/lib/types.ts";

const C_DATE = 1;
const C_SOURCE = 3;
const C_DOCID = 4;
const C_THEMES = 8;
const C_LOC = 10;
const C_IMAGE = 18;
const C_EXTRAS = 26;

const WANTED = [C_DATE, C_SOURCE, C_DOCID, C_THEMES, C_LOC, C_IMAGE, C_EXTRAS];

export const MIN_COLS = 27;

export type ParseResult = {
  articles: Article[];
  rows: number;
  shortRows: number;
  noTitle: number;
};

export function columns(row: string, wanted: readonly number[] = WANTED): string[] | null {
  const out: string[] = new Array(wanted.length).fill("");
  const slot = new Map(wanted.map((column, index) => [column, index]));

  let column = 0;
  let cursor = 0;
  for (;;) {
    const tab = row.indexOf("\t", cursor);
    const end = tab === -1 ? row.length : tab;
    const index = slot.get(column);
    if (index !== undefined) out[index] = row.slice(cursor, end);
    column++;
    if (tab === -1) break;
    cursor = tab + 1;
  }

  return column >= MIN_COLS ? out : null;
}

const TITLE_RE = /<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function unescapeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1]?.toLowerCase() === "x"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export function parseLocations(field: string): GdeltLocation[] {
  const out: GdeltLocation[] = [];
  for (const chunk of field.split(";")) {
    if (!chunk) continue;
    const parts = chunk.split("#");
    if (parts.length < 9) continue;

    const type = Number.parseInt(parts[0], 10);
    const lat = Number.parseFloat(parts[5]);
    const lon = Number.parseFloat(parts[6]);
    if (!Number.isFinite(type) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // 0,0 is GDELT's null island, not the Gulf of Guinea.
    if (lat === 0 && lon === 0) continue;

    const offset = Number.parseInt(parts[8], 10);
    out.push({
      type,
      name: parts[1],
      countryCode: parts[2],
      adm1Code: parts[3],
      lat,
      lon,
      featureId: parts[7],
      offset: Number.isFinite(offset) ? offset : Number.MAX_SAFE_INTEGER,
    });
  }
  return out;
}

// Sanitizes untrusted input for <img src>: https:/http: only, never javascript:/data:.
export function parseSharingImage(field: string): string {
  for (const chunk of field.split(";")) {
    const candidate = chunk.trim();
    if (!candidate) continue;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    return url.href;
  }
  return "";
}

export function parseThemes(field: string): string[] {
  const out: string[] = [];
  for (const chunk of field.split(";")) {
    if (!chunk) continue;
    const theme = chunk.split(",")[0];
    if (theme) out.push(theme);
  }
  return out;
}

export function parseRow(row: string): { article: Article | null; short: boolean } {
  const cols = columns(row);
  if (!cols) return { article: null, short: true };

  const [date, source, url, themeField, locationField, imageField, extras] = cols;

  const match = TITLE_RE.exec(extras);
  const title = match ? unescapeEntities(match[1]).trim() : "";
  if (!title) return { article: null, short: false };

  return {
    article: {
      date,
      domain: source.trim().toLowerCase(),
      url,
      title,
      image: parseSharingImage(imageField),
      themes: parseThemes(themeField),
      locations: parseLocations(locationField),
    },
    short: false,
  };
}

export function parseBundle(csv: string): ParseResult {
  const result: ParseResult = { articles: [], rows: 0, shortRows: 0, noTitle: 0 };

  for (const line of csv.split("\n")) {
    if (!line) continue;
    result.rows++;

    const { article, short } = parseRow(line);
    if (short) {
      result.shortRows++;
      continue;
    }
    if (!article) {
      result.noTitle++;
      continue;
    }
    result.articles.push(article);
  }

  return result;
}
