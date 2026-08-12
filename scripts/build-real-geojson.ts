/**
 * Phase 2.5 (HANDOFF.md §5) — one real GKG bundle onto the map.
 *
 *   fetch one 15-minute bundle -> parse -> demonym filter -> placeStory ->
 *   city pins only -> build/stories.geojson -> npm run tiles:real
 *
 * Deliberately NOT the Phase 3 worker. There is no state, no shard pool, no
 * grouping, no ranking, no per-tile budget, no publish gate — Phase 2.5 exists to
 * put real news on the live map for one evening so that every later phase
 * improves something that already exists. `worker/` per §3.3 is Phase 3's job and
 * this file must not grow into it.
 *
 * What it does share with Phase 3 is the stuff that is a bug if it is wrong:
 * the >=27 schema canary, the tab-offset scan that never materializes V2GCAM,
 * the demonym filter running before placement, and Rule H (§2.1) with its 2x/3x
 * margins.
 *
 * Run:  node scripts/build-real-geojson.ts [YYYYMMDDHHMMSS]
 *       (no argument = the newest completed bundle)
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(REPO_ROOT, ".cache", "gkg");
const OUTPUT = path.join(REPO_ROOT, "build", "stories.geojson");
const DEMONYMS_FILE = path.join(REPO_ROOT, "data", "demonyms.txt");

/**
 * HTTP, not HTTPS. `https://data.gdeltproject.org` fails certificate
 * verification (§4). This is a public, unauthenticated, integrity-uncritical
 * bulk feed and the URL is not user-controlled.
 */
const BASE = "http://data.gdeltproject.org/gdeltv2";
const UA = "sonder/0.1 (portfolio project; contact matthewcflam@gmail.com)";

/** GKG 2.1 column indices, 0-based. */
const C_DATE = 1;
const C_SOURCE = 3;
const C_DOCID = 4;
const C_LOC = 10;
const C_EXTRAS = 26;

/**
 * Schema canary: >= 27, indexed from the left (§3.2). A strict `!== 27` would
 * fail closed the first time GDELT appends a benign column.
 */
const MIN_COLS = 27;

/** V2EnhancedLocations type codes. 2/5 are admin-1, 3/4 are city-level. */
const TYPE_COUNTRY = 1;
const TYPES_ADM1 = new Set([2, 5]);
const TYPES_CITY = new Set([3, 4]);

type Location = {
  type: number;
  name: string;
  lat: number;
  lon: number;
  offset: number;
};

type Record_ = {
  date: string;
  domain: string;
  url: string;
  title: string;
  locations: Location[];
};

type Placement =
  | { kind: "PIN"; location: Location }
  | { kind: "CONTAINER"; location: Location }
  | { kind: "DROP"; location: null };

// --------------------------------------------------------------------- fetch

/** The newest bundle GDELT has finished writing. */
async function newestStamp(): Promise<string> {
  const response = await fetch(`${BASE}/lastupdate.txt`, { headers: { "user-agent": UA } });
  if (!response.ok) throw new Error(`lastupdate.txt: HTTP ${response.status}`);
  const line = (await response.text())
    .trim()
    .split("\n")
    .find((l) => l.includes(".gkg.csv.zip"));
  const stamp = line && /(\d{14})/.exec(line)?.[1];
  if (!stamp) throw new Error("lastupdate.txt carried no GKG bundle stamp");
  return stamp;
}

/** Download the bundle, or reuse the cached copy. Bundles are immutable. */
async function fetchBundle(stamp: string): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${stamp}.gkg.csv.zip`);

  const cached = await stat(file).catch(() => null);
  if (cached && cached.size > 0) {
    console.log(`  cached  ${stamp}  ${(cached.size / 1e6).toFixed(2)} MB`);
    return file;
  }

  const started = Date.now();
  const response = await fetch(`${BASE}/${stamp}.gkg.csv.zip`, {
    headers: { "user-agent": UA },
  });
  if (!response.ok) throw new Error(`bundle ${stamp}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(file, bytes);
  console.log(
    `  fetched ${stamp}  ${(bytes.length / 1e6).toFixed(2)} MB  ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  return file;
}

/**
 * Minimal single-entry ZIP reader. A GKG bundle is one deflated CSV, so the
 * whole of the format this needs is: find the end-of-central-directory record,
 * follow it to the first local file header, inflate what follows.
 *
 * This is here instead of a dependency because §0 rule 5 asks before adding
 * one, and thirty lines beats a package for a file layout that has not changed
 * since 1989.
 */
function unzipSingleEntry(archive: Buffer): Buffer {
  const EOCD_SIGNATURE = 0x06054b50;
  let eocd = -1;
  // The EOCD sits at the end, followed only by an optional comment (<= 64 KB).
  for (let i = archive.length - 22; i >= 0 && i >= archive.length - 22 - 0xffff; i--) {
    if (archive.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file: no end-of-central-directory record");

  const centralDirOffset = archive.readUInt32LE(eocd + 16);
  if (archive.readUInt32LE(centralDirOffset) !== 0x02014b50) {
    throw new Error("zip central directory header is malformed");
  }

  const method = archive.readUInt16LE(centralDirOffset + 10);
  const compressedSize = archive.readUInt32LE(centralDirOffset + 20);
  const localHeader = archive.readUInt32LE(centralDirOffset + 42);
  if (archive.readUInt32LE(localHeader) !== 0x04034b50) {
    throw new Error("zip local file header is malformed");
  }

  const nameLength = archive.readUInt16LE(localHeader + 26);
  const extraLength = archive.readUInt16LE(localHeader + 28);
  const start = localHeader + 30 + nameLength + extraLength;
  const body = archive.subarray(start, start + compressedSize);

  if (method === 0) return body; // stored
  if (method === 8) return inflateRawSync(body); // deflate
  throw new Error(`unsupported zip compression method ${method}`);
}

// --------------------------------------------------------------------- parse

/**
 * Return the requested columns of one tab-separated row, or null if the row is
 * short of the schema canary.
 *
 * Scans for tab offsets and slices only what it is asked for. V2GCAM is 69.4%
 * of the bytes in a bundle and nothing in this project reads it (§3.2), so it is
 * never turned into a string. A plain `row.split("\t")` would materialize it
 * ~1,200 times per bundle.
 */
function columns(row: string, wanted: number[]): string[] | null {
  const want = new Set(wanted);
  const out: string[] = new Array(wanted.length).fill("");
  const slot = new Map(wanted.map((column, index) => [column, index]));

  let column = 0;
  let cursor = 0;
  for (;;) {
    const tab = row.indexOf("\t", cursor);
    const end = tab === -1 ? row.length : tab;
    if (want.has(column)) out[slot.get(column)!] = row.slice(cursor, end);
    column++;
    if (tab === -1) break;
    cursor = tab + 1;
  }

  return column >= MIN_COLS ? out : null;
}

const TITLE_RE = /<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/;

/** GKG is ASCII-only and HTML-entity-escapes its titles (§4). */
function unescapeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1]?.toLowerCase() === "x"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    return named[body.toLowerCase()] ?? whole;
  });
}

/** V2EnhancedLocations: Type#FullName#CC#ADM1#ADM2#Lat#Long#FeatureID#Offset */
function parseLocations(field: string): Location[] {
  const out: Location[] = [];
  for (const chunk of field.split(";")) {
    if (!chunk) continue;
    const parts = chunk.split("#");
    if (parts.length < 9) continue;
    const type = Number.parseInt(parts[0], 10);
    const lat = Number.parseFloat(parts[5]);
    const lon = Number.parseFloat(parts[6]);
    if (!Number.isFinite(type) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const offset = Number.parseInt(parts[8], 10);
    out.push({
      type,
      name: parts[1],
      lat,
      lon,
      offset: Number.isFinite(offset) ? offset : Number.MAX_SAFE_INTEGER,
    });
  }
  return out;
}

// ----------------------------------------------------------------- placement

async function loadDemonyms(): Promise<Set<string>> {
  const text = await readFile(DEMONYMS_FILE, "utf8");
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    const content = line.split("#")[0].trim();
    if (!content) continue;
    for (const token of content.split(",")) {
      const cleaned = token.trim().toLowerCase();
      if (cleaned) out.add(cleaned);
    }
  }
  return out;
}

/**
 * Match the FIRST COMMA SEGMENT, not the whole FullName. GDELT writes country
 * demonyms bare ("Americans") and state demonyms with a suffix ("Texans, United
 * States"), so whole-string matching silently misses every US state — 11.9% of
 * all location mentions are demonyms (§2.1, FINDINGS §10).
 */
function isDemonym(name: string, demonyms: Set<string>): boolean {
  return demonyms.has(name.split(",")[0].trim().toLowerCase());
}

/**
 * placeStory() — Rule H from §2.1. Specificity wins unless it is dominated:
 * adm1 at >= 2x the city means the story is regional, country at >= 3x means it
 * is national. The margins differ because countries are structurally
 * over-mentioned; a domestic article names its own country constantly.
 *
 * Do not "simplify" this to specificity-first. That was the spec's original rule
 * and it failed the abort criterion at 54.1% pin accuracy (§5.2).
 */
function placeStory(record: Record_, demonyms: Set<string>): Placement {
  const locations = record.locations.filter((l) => !isDemonym(l.name, demonyms));
  if (locations.length === 0) return { kind: "DROP", location: null };

  const mentions = new Map<string, number>();
  for (const l of locations) mentions.set(l.name, (mentions.get(l.name) ?? 0) + 1);

  const best = (types: Set<number> | number): Location | null => {
    const matches = locations.filter((l) =>
      typeof types === "number" ? l.type === types : types.has(l.type),
    );
    if (matches.length === 0) return null;
    // Most mentioned, ties broken by earliest mention in the article.
    return matches.reduce((winner, candidate) => {
      const a = mentions.get(candidate.name)!;
      const b = mentions.get(winner.name)!;
      if (a !== b) return a > b ? candidate : winner;
      return candidate.offset < winner.offset ? candidate : winner;
    });
  };

  const city = best(TYPES_CITY);
  const adm1 = best(TYPES_ADM1);
  const country = best(TYPE_COUNTRY);

  if (city) {
    if (adm1 && mentions.get(adm1.name)! >= 2 * mentions.get(city.name)!) {
      return { kind: "CONTAINER", location: adm1 };
    }
    if (country && mentions.get(country.name)! >= 3 * mentions.get(city.name)!) {
      return { kind: "CONTAINER", location: country };
    }
    return { kind: "PIN", location: city };
  }
  if (adm1) return { kind: "CONTAINER", location: adm1 };
  if (country) return { kind: "CONTAINER", location: country };
  return { kind: "DROP", location: null };
}

/** Titles duplicate at 22% through syndication (§4), so dedupe on a normal form. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ----------------------------------------------------------------------- run

async function main(): Promise<void> {
  const requested = process.argv[2];
  const stamp = requested ?? (await newestStamp());
  console.log(`Phase 2.5 — GKG bundle ${stamp}`);

  const file = await fetchBundle(stamp);
  const csv = unzipSingleEntry(await readFile(file)).toString("utf8");

  let rows = 0;
  let shortRows = 0;
  let noTitle = 0;
  const counts = { PIN: 0, CONTAINER: 0, DROP: 0 };
  const domains = new Map<string, number>();
  const seenTitles = new Set<string>();
  let duplicates = 0;

  const demonyms = await loadDemonyms();
  const features: unknown[] = [];

  for (const line of csv.split("\n")) {
    if (!line) continue;
    rows++;

    const row = columns(line, [C_DATE, C_SOURCE, C_DOCID, C_LOC, C_EXTRAS]);
    if (!row) {
      shortRows++;
      continue;
    }
    const [date, source, url, locationField, extras] = row;

    const match = TITLE_RE.exec(extras);
    const title = match ? unescapeEntities(match[1]).trim() : "";
    if (!title) {
      noTitle++;
      continue;
    }

    const domain = source.trim().toLowerCase();
    domains.set(domain, (domains.get(domain) ?? 0) + 1);

    const record: Record_ = {
      date,
      domain,
      url,
      title,
      locations: parseLocations(locationField),
    };
    const placement = placeStory(record, demonyms);
    counts[placement.kind]++;

    // §5: city pins only. A story Rule H sends to a region is not mis-pinned at
    // its city here — containers are Phase 3/4 and these stories simply wait.
    if (placement.kind !== "PIN") continue;

    const key = normalizeTitle(title);
    if (seenTitles.has(key)) {
      duplicates++;
      continue;
    }
    seenTitles.add(key);

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [placement.location.lon, placement.location.lat],
      },
      properties: {
        title,
        source: domain,
        url,
        place: placement.location.name,
        date,
      },
    });
  }

  // Phase 3 has a real publish gate with output invariants (§3.2). This is the
  // one part of it worth having now: an empty archive looks like a working map.
  if (features.length === 0) {
    throw new Error("no pins produced — refusing to write an empty map");
  }

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(
    OUTPUT,
    `${JSON.stringify({ type: "FeatureCollection", features })}\n`,
    "utf8",
  );

  const top = [...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const share = (n: number) => `${((100 * n) / rows).toFixed(1)}%`;

  console.log(`
  rows                ${rows}
  short of ${MIN_COLS} cols   ${shortRows}
  no title            ${noTitle}  (${share(noTitle)})
  PIN                 ${counts.PIN}  (${share(counts.PIN)})
  CONTAINER           ${counts.CONTAINER}  (${share(counts.CONTAINER)})  -- held for Phase 3
  DROP                ${counts.DROP}  (${share(counts.DROP)})
  duplicate titles    ${duplicates}
  pins written        ${features.length}

  top domains         ${top.map(([d, n]) => `${d} ${share(n)}`).join("  ")}

  wrote ${path.relative(REPO_ROOT, OUTPUT)}`);
}

await main();
