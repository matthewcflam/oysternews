/**
 * Build public/boundaries.pmtiles — the polygons behind §2.2's red click-outline.
 *
 * HANDOFF.md §3.1: "Static `boundaries.pmtiles`, built once from Natural Earth.
 * Needed only for the red click-outline." Static is the operative word. Unlike
 * the story archive, this file does not change between runs, so it is built here,
 * committed, and served from the deploy rather than from Blob.
 *
 * Run:  npm run boundaries
 *
 * ---------------------------------------------------------------------------
 * THE JOIN, WHICH IS THE WHOLE PROBLEM (§3.4, the FIPS trap, again)
 *
 * A story carries `region`: `SP` for Spain, `USCA` for California, `UKC9` for
 * Cumbria. Natural Earth carries something else, and *which* something else
 * depends on the country. Measured 2026-08-12 against the 691 containers of the
 * first real run:
 *
 *   - **admin-0** joins on NE's `FIPS_10`. 64 of 67 country containers matched;
 *     the gaps are Israel, Tokelau and the West Bank, which is exactly the hole
 *     `data/fips-overrides.json` already documents. Applying the existing
 *     crosswalk in reverse (ISO -> FIPS) closes Israel and the West Bank.
 *   - **admin-1** joins on NE's `fips` for most of the world — but **not for the
 *     United States**, where Natural Earth writes numeric FIPS (`US06`) and
 *     GDELT writes postal letters (`USCA`). That is 45 of the 66 admin-1 regions
 *     in one run and 295 of 331 container stories: joining on `fips` alone loses
 *     nearly all of the American map. US regions are matched on `iso_3166_2`
 *     (`US-CA`) instead, which is a mechanical rewrite of the GDELT code.
 *   - The 50m admin-1 file is unusable regardless of key: it carries **zero**
 *     British regions. 10m is required, and it is 40 MB of GeoJSON.
 *
 * Together the two rules resolve 328 of 331 admin-1 container stories. The
 * remainder is logged loudly rather than guessed at, per §3.4 — a wrong polygon
 * outlines the wrong place, which is the same class of error as putting Russian
 * news in Serbia.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(REPO_ROOT, ".cache");
const BUILD_DIR = path.join(REPO_ROOT, "build", "boundaries");
const OUTPUT = path.join(REPO_ROOT, "public", "boundaries.pmtiles");

/**
 * The second output: `id -> [west, south, east, north]`, for Mode 3's "Zoom to
 * Texas" button.
 *
 * **It is built HERE, from the same two feature lists the archive is built from,
 * and that is the entire point.** A bbox computed anywhere else is a second join
 * — a second chance to decide that `US06` and `USCA` are different places, or
 * that Tamil Nadu is `IN22`. Every id in this file is an id the outline archive
 * can draw, by construction, because it comes off the same `outline()` calls.
 *
 * JSON rather than a second pmtiles layer: it is one array of four numbers per
 * region, the browser needs a random-access lookup rather than a tile, and
 * `fitBounds` wants numbers, not geometry.
 */
const BBOX_OUTPUT = path.join(REPO_ROOT, "public", "region-bbox.json");

/**
 * The third output: a flat, searchable name -> id index for countries and
 * admin-1 regions, for the "Where to next?" search box.
 *
 * **Built from the same `outline()` calls as the archive and the bbox table —
 * this is the first join, not a second one.** A name reaches this file only
 * riding along with an id the build already decided; the browser never turns a
 * typed string into an id on its own. See
 * docs/DESIGN.md#the-label-based-gesture-and-no-name-matching-ever.
 */
const PLACE_INDEX_OUTPUT = path.join(REPO_ROOT, "public", "place-index.json");

export const COUNTRIES_LAYER = "countries";
export const REGIONS_LAYER = "regions";

const SOURCES = {
  countries: {
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson",
    cache: path.join(CACHE_DIR, "ne_countries.json"),
  },
  regions: {
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
    cache: path.join(CACHE_DIR, "ne_regions.json"),
  },
};

type Feature = {
  type: "Feature";
  geometry: unknown;
  properties: Record<string, string | number | string[] | null | undefined>;
};

/** Natural Earth writes -99 rather than null for "no value". */
const value = (raw: unknown): string =>
  typeof raw === "string" && raw !== "-99" ? raw.trim() : "";

async function naturalEarth(source: { url: string; cache: string }): Promise<Feature[]> {
  await mkdir(CACHE_DIR, { recursive: true });
  const cached = await stat(source.cache).catch(() => null);
  if (!cached || cached.size === 0) {
    console.log(`  fetching ${source.url}`);
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`Natural Earth: HTTP ${response.status}`);
    await writeFile(source.cache, Buffer.from(await response.arrayBuffer()));
  }
  return JSON.parse(await readFile(source.cache, "utf8")).features as Feature[];
}

type CrosswalkEntry = { iso: string; name: string };

/** The committed crosswalk plus its overrides, merged — fips -> {iso, name}. */
async function loadCrosswalk(): Promise<Record<string, CrosswalkEntry>> {
  const read = async (file: string) =>
    JSON.parse(await readFile(path.join(REPO_ROOT, "data", file), "utf8")).fips as Record<
      string,
      CrosswalkEntry
    >;

  return { ...(await read("crosswalk.json")), ...(await read("fips-overrides.json")) };
}

/**
 * ISO -> FIPS, inverted from the merged crosswalk.
 *
 * Needed because Natural Earth's own `FIPS_10` is blank for exactly the places
 * the overrides file exists to fix. Built from the same data the rest of the
 * pipeline joins on, so boundaries cannot drift from placement.
 */
function isoToFips(crosswalk: Record<string, CrosswalkEntry>): Map<string, string> {
  const byIso = new Map<string, string>();
  for (const [fips, entry] of Object.entries(crosswalk)) {
    // First writer wins: the crosswalk is generated in Natural Earth's own order,
    // and a later territory sharing an ISO code must not displace its country.
    if (entry.iso && !byIso.has(entry.iso)) byIso.set(entry.iso, fips);
  }
  return byIso;
}

/**
 * A feature carrying whatever properties are handed to it — `id` always, plus
 * `name`/`alt`/`parent` when the caller has them. `stripped()` reduces this
 * back to `{ id }` at tippecanoe-write time, so the archive never sees the
 * extra columns.
 */
const outline = (feature: Feature, properties: Feature["properties"]): Feature => ({
  type: "Feature",
  geometry: feature.geometry,
  properties,
});

/** Reduces a feature list back to `{ id }` — the archive's bytes must not change. */
const stripped = (features: Feature[]): Feature[] =>
  features.map((feature) => ({
    type: "Feature",
    geometry: feature.geometry,
    properties: { id: feature.properties.id },
  }));

export function countryOutlines(
  features: Feature[],
  byIso: Map<string, string>,
  crosswalk: Record<string, CrosswalkEntry>,
): Feature[] {
  const out: Feature[] = [];
  let recovered = 0;

  for (const feature of features) {
    const fips =
      value(feature.properties.FIPS_10) ||
      byIso.get(value(feature.properties.ISO_A2) || value(feature.properties.ISO_A2_EH)) ||
      "";

    if (!fips) continue;
    if (!value(feature.properties.FIPS_10)) recovered += 1;

    const name =
      value(feature.properties.NAME_EN) ||
      value(feature.properties.NAME) ||
      value(feature.properties.NAME_LONG);

    // A bounded set of aliases, not the full 30-odd localized NAME_* columns —
    // enough to catch "Russia" vs "Russian Federation", not a translation table.
    const alt = [
      ...new Set(
        [
          value(feature.properties.NAME_LONG),
          value(feature.properties.FORMAL_EN),
          value(feature.properties.ABBREV),
          crosswalk[fips]?.name ?? "",
        ].filter((candidate) => candidate && candidate !== name),
      ),
    ];

    out.push(outline(feature, { id: fips, name, ...(alt.length ? { alt } : {}) }));
  }

  console.log(`  countries: ${out.length} outlines (${recovered} via the crosswalk)`);
  return out;
}

/**
 * Admin-1 regions where Natural Earth's own `fips` is demonstrably wrong, keyed
 * by its `iso_3166_2`. **This is not the same thing as guessing a join** (§3.4) —
 * an entry belongs here only with evidence from both sides.
 *
 * `IN-TN`, added 2026-08-13, is the whole list and shows the standard:
 *
 *   - **GDELT emits `IN25` for Tamil Nadu**, 80 mentions across the 12 committed
 *     GKG bundles, and never `IN22`.
 *   - **Natural Earth writes `fips: IN22` on Tamil Nadu** — and writes `IN22` on
 *     **Puducherry** as well, which is where the error shows itself. FIPS 10-4
 *     assigns `IN22` to Puducherry, so NE's Tamil Nadu is the wrong one of the
 *     two, by NE's own internal contradiction rather than by our say-so.
 *
 * It was costing two bugs, not one. `IN25` had no outline at all (the symptom in
 * the plan), and a **Puducherry** container outlined *Tamil Nadu* along with it,
 * because both polygons answered to the same id. The second was silent.
 */
const ADM1_FIPS_OVERRIDES: Record<string, string> = {
  "IN-TN": "IN25",
};

export function regionOutlines(features: Feature[], byIso: Map<string, string>): Feature[] {
  const out: Feature[] = [];
  const countriesById = new Map<string, Set<string>>();
  let usPostal = 0;
  let overridden = 0;

  for (const feature of features) {
    const iso3166 = value(feature.properties.iso_3166_2);

    // The US rule comes FIRST and overwrites NE's own fips: GDELT never emits
    // `US06`, so keeping it would produce a polygon nothing can ever match.
    const id = iso3166.startsWith("US-")
      ? `US${iso3166.slice(3)}`
      : (ADM1_FIPS_OVERRIDES[iso3166] ?? value(feature.properties.fips));

    if (!id) continue;
    if (iso3166.startsWith("US-")) usPostal += 1;
    if (ADM1_FIPS_OVERRIDES[iso3166]) overridden += 1;

    const country =
      value(feature.properties.iso_a2) || value(feature.properties.adm0_a3) || "??";
    (countriesById.get(id) ?? countriesById.set(id, new Set()).get(id)!).add(country);

    const name = value(feature.properties.name_en) || value(feature.properties.name);
    const parent = byIso.get(value(feature.properties.iso_a2));

    out.push(outline(feature, { id, name, ...(parent ? { parent } : {}) }));
  }

  console.log(
    `  regions:   ${out.length} outlines (${usPostal} rewritten to US postal codes,` +
      ` ${overridden} corrected by ADM1_FIPS_OVERRIDES)`,
  );

  /**
   * **An id answered by polygons in two different countries is a wrong outline
   * waiting to happen**, and it is the §11 failure shape: nothing errors, the
   * map just draws a border somewhere else. Natural Earth's `fips` is not a
   * unique key — 187 codes are carried by more than one admin-1 feature, and
   * most of those are *fine*, because NE splits a region into provinces that
   * each carry the parent's code and together compose it. The ones that are not
   * fine are the ones that cross a border, so that is what this counts.
   *
   * Measured 2026-08-13: 16 such codes, all but one in the Balkans, where NE's
   * fips column is stale about Kosovo, Serbia, Montenegro and North Macedonia.
   * Only **one of the 16 is reachable from real data** (`AE02`, Ajman against two
   * Omani governorates). Loud, not fatal: the outline is cosmetic and a build
   * that refuses to produce a map over a Kosovo boundary code would be worse
   * than one that says so.
   */
  const crossBorder = [...countriesById].filter(([, countries]) => countries.size > 1);
  if (crossBorder.length > 0) {
    console.warn(
      `  WARN ${crossBorder.length} region ids span more than one country and may ` +
        `outline the wrong place: ` +
        crossBorder.map(([id, c]) => `${id} (${[...c].join("/")})`).join(", "),
    );
  }

  return out;
}

/* ------------------------------------------------------------------------- */
/* The bbox table                                                             */
/* ------------------------------------------------------------------------- */

/** `[west, south, east, north]`. West may exceed east's usual range — see below. */
export type Bbox = [number, number, number, number];

/** Every coordinate pair in a Polygon or MultiPolygon, flattened. */
function* positions(geometry: unknown): Generator<[number, number]> {
  const walk = function* (node: unknown): Generator<[number, number]> {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      yield [node[0], node[1]];
      return;
    }
    for (const child of node) yield* walk(child);
  };

  const geo = geometry as { coordinates?: unknown };
  yield* walk(geo?.coordinates);
}

/**
 * Longitude bounds for one region, chosen between two candidate frames.
 *
 * **This is the antimeridian trap, and it is silent.** Russia spans 19°E to
 * 169°W; the United States runs to the Aleutians at 172°E. Take the naive
 * min/max of their longitudes and you get -180 to 180 — a bbox of the entire
 * planet — so "Zoom to Russia" zooms OUT to the world view and looks like a
 * button that does nothing. Fiji is worse: it straddles 180 exactly, so a naive
 * fit centres it on the Atlantic.
 *
 * The fix is to measure the same points twice: once as given, and once with
 * every longitude mapped into [0, 360). The correct frame is whichever is
 * NARROWER, because a region is the small arc between its edges and never the
 * large one — Russia is 190° wide in the raw frame and 150° in the shifted one.
 *
 * When the shifted frame wins, the result is returned with west back inside
 * [-180, 180) and east allowed to run past 180 (Fiji becomes 174 → 182). That is
 * a form MapLibre understands directly, because `renderWorldCopies` means the
 * copy of the world at +360 is a real place on screen; normalising east back to
 * -178 would recreate the bug this function exists to remove.
 */
function longitudeBounds(lons: number[]): [number, number] {
  const raw: [number, number] = [Math.min(...lons), Math.max(...lons)];

  const shiftedLons = lons.map((lon) => (lon < 0 ? lon + 360 : lon));
  const shifted: [number, number] = [Math.min(...shiftedLons), Math.max(...shiftedLons)];

  if (shifted[1] - shifted[0] >= raw[1] - raw[0]) return raw;
  return shifted[0] >= 180 ? [shifted[0] - 360, shifted[1] - 360] : shifted;
}

/**
 * One bbox per id, over every feature carrying that id.
 *
 * **The union, not the first match.** Natural Earth splits a great many regions
 * into several features that each carry the parent's code — that is exactly the
 * "187 codes carried by more than one feature" the cross-border check above
 * counts, and most of them are legitimate. Taking the first would zoom to one
 * province of a region and call it the region.
 *
 * Rounded to three decimals: ~100m at the equator, which is four orders of
 * magnitude finer than a camera fit needs, and it halves the file.
 */
export function bboxesById(features: Feature[]): Record<string, Bbox> {
  const lons = new Map<string, number[]>();
  const lats = new Map<string, number[]>();

  for (const feature of features) {
    const id = String(feature.properties.id ?? "");
    if (!id) continue;
    const lon = lons.get(id) ?? lons.set(id, []).get(id)!;
    const lat = lats.get(id) ?? lats.set(id, []).get(id)!;
    for (const [x, y] of positions(feature.geometry)) {
      lon.push(x);
      lat.push(y);
    }
  }

  const round = (value: number) => Math.round(value * 1000) / 1000;
  const out: Record<string, Bbox> = {};
  for (const [id, lon] of lons) {
    const lat = lats.get(id)!;
    if (lon.length === 0) continue;
    const [west, east] = longitudeBounds(lon);
    out[id] = [round(west), round(Math.min(...lat)), round(east), round(Math.max(...lat))];
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* The place index                                                           */
/* ------------------------------------------------------------------------- */

export type PlaceEntry = {
  id: string;
  name: string;
  kind: "country" | "state";
  parent?: string;
  alt?: string[];
};

/**
 * The searchable name -> id table for countries and admin-1 regions, built
 * from the same `outline()` output the archive and the bbox table use.
 *
 * Countries first, then regions — the same one-flat-table reasoning as the
 * merged bbox object: a FIPS country code is two characters and an admin-1
 * code is four, so the namespaces cannot collide.
 *
 * An id with no bbox is dropped — a suggestion the camera cannot fly to is a
 * dead row — which is what `place-index.test.ts`'s committed-artifact
 * invariant checks mechanically.
 */
export function placeIndexFrom(
  countries: Feature[],
  regions: Feature[],
  bboxes: Record<string, Bbox>,
): PlaceEntry[] {
  const entries: PlaceEntry[] = [];
  const seen = new Set<string>();

  const push = (feature: Feature, kind: PlaceEntry["kind"]) => {
    const id = String(feature.properties.id ?? "");
    const name = String(feature.properties.name ?? "");
    if (!id || !name) return;
    if (!(id in bboxes)) return;
    if (seen.has(id)) return;
    seen.add(id);

    const parent = feature.properties.parent ? String(feature.properties.parent) : undefined;
    const alt = Array.isArray(feature.properties.alt)
      ? (feature.properties.alt as string[])
      : undefined;

    entries.push({
      id,
      name,
      kind,
      ...(parent ? { parent } : {}),
      ...(alt && alt.length ? { alt } : {}),
    });
  };

  for (const feature of countries) push(feature, "country");
  for (const feature of regions) push(feature, "state");

  return entries;
}

/**
 * **A forward-slash literal, never `path.join`** — and the paths handed after it
 * get the same treatment (`posix`, below).
 *
 * This is the trap `worker/tiles.ts` documents at length, found here on
 * 2026-08-13 by being the second script to run tippecanoe from Windows Node.
 * `path.join` returns `scripts\run-tippecanoe.sh`, bash reads `\r` as an escape,
 * and reports `scriptsrun-tippecanoe.sh: No such file or directory`. It hid
 * because this file is run **by hand and rarely** — the archive it builds is
 * committed and static (§3.1) — so the fix that landed in `tiles.ts` never
 * reached the one other caller.
 */
const SCRIPT = "scripts/run-tippecanoe.sh";

/** A path as an argument to bash, not as a path for this process. See tiles.ts. */
const posix = (value: string): string => value.replaceAll("\\", "/");

function runTippecanoe(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [SCRIPT, ...args.map(posix)], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`tippecanoe exited ${code}`)),
    );
  });
}

async function main(): Promise<void> {
  await mkdir(BUILD_DIR, { recursive: true });
  await mkdir(path.dirname(OUTPUT), { recursive: true });

  const crosswalk = await loadCrosswalk();
  const byIso = isoToFips(crosswalk);
  const countries = countryOutlines(await naturalEarth(SOURCES.countries), byIso, crosswalk);
  const regions = regionOutlines(await naturalEarth(SOURCES.regions), byIso);

  const countriesFile = path.join(BUILD_DIR, "countries.geojson");
  const regionsFile = path.join(BUILD_DIR, "regions.geojson");
  const collection = (features: Feature[]) =>
    `${JSON.stringify({ type: "FeatureCollection", features })}\n`;

  // Stripped to `{ id }` here — the archive's bytes must not change just
  // because `outline()` now carries a name/parent/alt alongside it.
  await writeFile(countriesFile, collection(stripped(countries)), "utf8");
  await writeFile(regionsFile, collection(stripped(regions)), "utf8");

  /**
   * Countries and regions in ONE table, because the browser looks up by id and
   * the two namespaces cannot collide — a FIPS country code is two characters
   * and an admin-1 code is four, which is the same fact `buildRegionIndex` files
   * both levels into one flat map on.
   */
  const bboxes = { ...bboxesById(countries), ...bboxesById(regions) };
  await writeFile(BBOX_OUTPUT, `${JSON.stringify(bboxes)}\n`, "utf8");
  const bboxSize = (await stat(BBOX_OUTPUT)).size;
  console.log(
    `  bbox:      ${Object.keys(bboxes).length} regions -> ${BBOX_OUTPUT}` +
      ` (${(bboxSize / 1024).toFixed(0)} KB)`,
  );

  const places = placeIndexFrom(countries, regions, bboxes);
  await writeFile(PLACE_INDEX_OUTPUT, `${JSON.stringify(places)}\n`, "utf8");
  const placeSize = (await stat(PLACE_INDEX_OUTPUT)).size;
  console.log(
    `  places:    ${places.length} entries -> ${PLACE_INDEX_OUTPUT}` +
      ` (${(placeSize / 1024).toFixed(0)} KB)`,
  );

  /**
   * **`--bbox-only` exists because the two outputs have wildly different costs.**
   * The archive needs tippecanoe installed and takes minutes; the bbox table and
   * the place index are a pass over feature lists already in memory. Regenerating
   * them after a join change should not require the tool, and skipping the
   * archive here is safe precisely because nothing above this line is
   * archive-specific.
   */
  if (process.argv.includes("--bbox-only")) {
    console.log("--bbox-only: skipping tippecanoe");
    return;
  }

  /**
   * -z8, not the stories archive's z12. An outline is a shape, not a
   * measurement: MapLibre overzooms a z8 tile for free, and the difference is
   * invisible against a 2px stroke while the file is a fraction of the size.
   *
   * **No `--drop-densest-as-needed` here**, unlike §3.1's story flags. Dropping a
   * story defers it to a higher zoom; dropping a boundary means clicking a
   * country outlines nothing, silently. `--drop-smallest-as-needed` is the
   * safety valve instead — it sheds slivers under tile pressure, never whole
   * mainlands — and `--coalesce-smallest-as-needed` merges what it can first.
   */
  await runTippecanoe([
    "--force",
    "--name=sonder-boundaries",
    "--quiet",
    "-o",
    OUTPUT,
    "-Z0",
    "-z8",
    "-r1",
    "--simplification=10",
    "--coalesce-smallest-as-needed",
    "--drop-smallest-as-needed",
    "-L",
    `${COUNTRIES_LAYER}:${countriesFile}`,
    "-L",
    `${REGIONS_LAYER}:${regionsFile}`,
  ]);

  const built = await stat(OUTPUT);
  console.log(`built ${OUTPUT} (${(built.size / 1_000_000).toFixed(1)} MB)`);
}

/**
 * **Guarded, so the module can be imported.** `bboxesById` is the one piece of
 * this script worth unit-testing — the antimeridian rule is silent when it is
 * wrong (see `longitudeBounds`), which is exactly the §11 shape — and an
 * unguarded `main()` would kick off a 54 MB parse and a tippecanoe run the
 * moment a test file imported it.
 */
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
