/**
 * GKG 2.1 parsing. PURE (HANDOFF.md §3.3) — takes text, returns records, touches
 * nothing. worker/fetch.ts does the downloading and unzipping.
 *
 * Two things here are load-bearing and neither is obvious from the code alone:
 *
 * 1. **V2GCAM is never materialized.** It is 69.4% of the bytes in a bundle
 *    (§4) and nothing in this project reads it. `columns()` scans for tab
 *    offsets and slices only the five fields that are wanted, so the largest
 *    field in the file never becomes a string. A plain `row.split("\t")` would
 *    build it ~1,200 times per bundle and then discard it.
 *
 * 2. **The schema canary is `>= 27`, indexed from the left** (§3.2). A strict
 *    `!== 27` fails closed the first time GDELT appends a benign column, which
 *    is the more likely event by far — and failing closed on GDELT's only usable
 *    access path (§4: there is no fallback) takes the whole map down.
 */

import type { Article, GdeltLocation } from "../lib/types.ts";

/** GKG 2.1 column indices, 0-based. */
const C_DATE = 1;
const C_SOURCE = 3;
const C_DOCID = 4;
const C_THEMES = 8;
const C_LOC = 10;
/**
 * `V2.1SHARINGIMAGE` — the image the publisher declared for social sharing,
 * which is the `og:image` tag GDELT already read off the page.
 *
 * **Added 2026-08-14, and it deleted a whole endpoint.** The story panel's
 * thumbnail used to come from `/api/og`, which fetched the article page itself,
 * server-side, per story opened — an SSRF primitive guarded by a scheme
 * allowlist, DNS checks and hand-followed redirects. All of that existed to
 * re-derive a field that was sitting in the row this parser was already reading,
 * eleven columns to the left of the one it took the title from.
 *
 * Measured on two committed bundles, 1,085 rows: **87.8% non-empty**, 8 of 8
 * sampled URLs live, 6 of 8 byte-identical to what the page declares today (the
 * other two are CDN rewrites that still serve). `V2.1RELATEDIMAGES` (17.2%) and
 * `V2.1SOCIALIMAGEEMBEDS` (6.0%) are the neighbouring columns and are not worth
 * the bytes.
 */
const C_IMAGE = 18;
const C_EXTRAS = 26;

const WANTED = [C_DATE, C_SOURCE, C_DOCID, C_THEMES, C_LOC, C_IMAGE, C_EXTRAS];

export const MIN_COLS = 27;

export type ParseResult = {
  articles: Article[];
  /** Every row seen, including the ones dropped below. */
  rows: number;
  /** Rows failing the schema canary. A nonzero count here is a GDELT schema change. */
  shortRows: number;
  /** Rows with no PAGE_TITLE. Measured at 0.3% (§4); a spike means GDELT changed V2EXTRASXML. */
  noTitle: number;
};

/**
 * Slice the requested columns out of one tab-separated row.
 * Returns null when the row is short of the canary.
 */
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

/** GKG is ASCII-only and its titles are HTML-entity-escaped (§4). */
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

/**
 * V2EnhancedLocations:
 *   Type#FullName#CountryCode#ADM1Code#ADM2Code#Lat#Long#FeatureID#CharOffset
 *
 * Records carry 6+ locations half the time (§4), so this runs on every kept row
 * and is worth keeping allocation-light.
 */
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

/**
 * The sharing image, or "" — and this is the only place it is ever validated.
 *
 * **It ends up in an `<img src>` in the browser, so it is untrusted input from
 * GDELT to the DOM.** Sanitising here rather than in the panel means a bad value
 * cannot reach a tile at all: the archive is the boundary, and a URL that fails
 * this check is simply not published. The client keeps its own fallbacks —
 * `onError` and the minimum-width check that rejects tracking pixels — but they
 * guard against images that *break*, not against schemes that should never have
 * been rendered.
 *
 * **`https:` and `http:` only.** `javascript:` is the reason a scheme allowlist
 * beats every other kind of check, and `data:` would let a row carry an
 * arbitrarily large payload into a tile.
 *
 * GDELT writes at most one image here in practice, but the field is documented
 * as multi-valued and 6 rows in the sample carried a `;`. The first valid one
 * wins, which matches how the publisher ordered them.
 */
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

/** V2EnhancedThemes is `THEME,offset;THEME,offset;...` — the offsets are unused. */
export function parseThemes(field: string): string[] {
  const out: string[] = [];
  for (const chunk of field.split(";")) {
    if (!chunk) continue;
    const theme = chunk.split(",")[0];
    if (theme) out.push(theme);
  }
  return out;
}

/** One row -> one Article, or null if it fails the canary or has no title. */
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
