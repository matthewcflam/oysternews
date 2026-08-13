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
  properties: Record<string, string | number | null | undefined>;
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

/**
 * ISO -> FIPS, inverted from the committed crosswalk plus its overrides.
 *
 * Needed because Natural Earth's own `FIPS_10` is blank for exactly the places
 * the overrides file exists to fix. Built from the same data the rest of the
 * pipeline joins on, so boundaries cannot drift from placement.
 */
async function isoToFips(): Promise<Map<string, string>> {
  const read = async (file: string) =>
    JSON.parse(await readFile(path.join(REPO_ROOT, "data", file), "utf8")).fips as Record<
      string,
      { iso: string; name: string }
    >;

  const merged = { ...(await read("crosswalk.json")), ...(await read("fips-overrides.json")) };
  const byIso = new Map<string, string>();
  for (const [fips, entry] of Object.entries(merged)) {
    // First writer wins: the crosswalk is generated in Natural Earth's own order,
    // and a later territory sharing an ISO code must not displace its country.
    if (entry.iso && !byIso.has(entry.iso)) byIso.set(entry.iso, fips);
  }
  return byIso;
}

/** One property, `id`, holding the code a story's `region` will be compared to. */
const outline = (feature: Feature, id: string): Feature => ({
  type: "Feature",
  geometry: feature.geometry,
  properties: { id },
});

function countryOutlines(features: Feature[], byIso: Map<string, string>): Feature[] {
  const out: Feature[] = [];
  let recovered = 0;

  for (const feature of features) {
    const fips =
      value(feature.properties.FIPS_10) ||
      byIso.get(value(feature.properties.ISO_A2) || value(feature.properties.ISO_A2_EH)) ||
      "";

    if (!fips) continue;
    if (!value(feature.properties.FIPS_10)) recovered += 1;
    out.push(outline(feature, fips));
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

function regionOutlines(features: Feature[]): Feature[] {
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

    out.push(outline(feature, id));
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

  const byIso = await isoToFips();
  const countries = countryOutlines(await naturalEarth(SOURCES.countries), byIso);
  const regions = regionOutlines(await naturalEarth(SOURCES.regions));

  const countriesFile = path.join(BUILD_DIR, "countries.geojson");
  const regionsFile = path.join(BUILD_DIR, "regions.geojson");
  const collection = (features: Feature[]) =>
    `${JSON.stringify({ type: "FeatureCollection", features })}\n`;

  await writeFile(countriesFile, collection(countries), "utf8");
  await writeFile(regionsFile, collection(regions), "utf8");

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

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
