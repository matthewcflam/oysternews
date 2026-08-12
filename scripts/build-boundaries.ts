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

function regionOutlines(features: Feature[]): Feature[] {
  const out: Feature[] = [];
  let usPostal = 0;

  for (const feature of features) {
    const iso3166 = value(feature.properties.iso_3166_2);

    // The US rule comes FIRST and overwrites NE's own fips: GDELT never emits
    // `US06`, so keeping it would produce a polygon nothing can ever match.
    const id = iso3166.startsWith("US-")
      ? `US${iso3166.slice(3)}`
      : value(feature.properties.fips);

    if (!id) continue;
    if (iso3166.startsWith("US-")) usPostal += 1;
    out.push(outline(feature, id));
  }

  console.log(`  regions:   ${out.length} outlines (${usPostal} rewritten to US postal codes)`);
  return out;
}

function runTippecanoe(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [path.join(REPO_ROOT, "scripts", "run-tippecanoe.sh"), ...args], {
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
