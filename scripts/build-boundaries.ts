import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(REPO_ROOT, ".cache");
const BUILD_DIR = path.join(REPO_ROOT, "build", "boundaries");
const OUTPUT = path.join(REPO_ROOT, "public", "boundaries.pmtiles");

const BBOX_OUTPUT = path.join(REPO_ROOT, "public", "region-bbox.json");

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

async function loadCrosswalk(): Promise<Record<string, CrosswalkEntry>> {
  const read = async (file: string) =>
    JSON.parse(await readFile(path.join(REPO_ROOT, "data", file), "utf8")).fips as Record<
      string,
      CrosswalkEntry
    >;

  return { ...(await read("crosswalk.json")), ...(await read("fips-overrides.json")) };
}

function isoToFips(crosswalk: Record<string, CrosswalkEntry>): Map<string, string> {
  const byIso = new Map<string, string>();
  for (const [fips, entry] of Object.entries(crosswalk)) {
    // First writer wins: a later territory sharing an ISO code must not displace its country.
    if (entry.iso && !byIso.has(entry.iso)) byIso.set(entry.iso, fips);
  }
  return byIso;
}

const outline = (feature: Feature, properties: Feature["properties"]): Feature => ({
  type: "Feature",
  geometry: feature.geometry,
  properties,
});

const stripped = (features: Feature[]): Feature[] =>
  features.map((feature) => ({
    type: "Feature",
    geometry: feature.geometry,
    properties: { id: feature.properties.id },
  }));

export function countryOutlines(
  features: Feature[],
  byIso: Map<string, string>,
  crosswalk: Record<string, CrosswalkEntry>
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

    const alt = [
      ...new Set(
        [
          value(feature.properties.NAME_LONG),
          value(feature.properties.FORMAL_EN),
          value(feature.properties.ABBREV),
          crosswalk[fips]?.name ?? "",
        ].filter((candidate) => candidate && candidate !== name)
      ),
    ];

    out.push(outline(feature, { id: fips, name, ...(alt.length ? { alt } : {}) }));
  }

  console.log(`  countries: ${out.length} outlines (${recovered} via the crosswalk)`);
  return out;
}

// Only where Natural Earth's fips is provably wrong from both sides: NE writes IN22 on
// Tamil Nadu and Puducherry, and GDELT emits IN25 for Tamil Nadu.
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

    // US rule first: GDELT never emits NE's numeric US06, so keeping it would match nothing.
    const id = iso3166.startsWith("US-")
      ? `US${iso3166.slice(3)}`
      : (ADM1_FIPS_OVERRIDES[iso3166] ?? value(feature.properties.fips));

    if (!id) continue;
    if (iso3166.startsWith("US-")) usPostal += 1;
    if (ADM1_FIPS_OVERRIDES[iso3166]) overridden += 1;

    const country = value(feature.properties.iso_a2) || value(feature.properties.adm0_a3) || "??";
    (countriesById.get(id) ?? countriesById.set(id, new Set()).get(id)!).add(country);

    const name = value(feature.properties.name_en) || value(feature.properties.name);
    const parent = byIso.get(value(feature.properties.iso_a2));

    out.push(outline(feature, { id, name, ...(parent ? { parent } : {}) }));
  }

  console.log(
    `  regions:   ${out.length} outlines (${usPostal} rewritten to US postal codes,` +
      ` ${overridden} corrected by ADM1_FIPS_OVERRIDES)`
  );

  // Loud, not fatal: an id answered by polygons in two countries draws a wrong outline silently.
  const crossBorder = [...countriesById].filter(([, countries]) => countries.size > 1);
  if (crossBorder.length > 0) {
    console.warn(
      `  WARN ${crossBorder.length} region ids span more than one country and may ` +
        `outline the wrong place: ` +
        crossBorder.map(([id, c]) => `${id} (${[...c].join("/")})`).join(", ")
    );
  }

  return out;
}

export type Bbox = [number, number, number, number];

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

// Antimeridian trap: naive min/max gives Russia or Fiji a whole-planet box. Use the narrower
// of the raw and [0, 360) frames; east may exceed 180, which renderWorldCopies draws correctly.
function longitudeBounds(lons: number[]): [number, number] {
  const raw: [number, number] = [Math.min(...lons), Math.max(...lons)];

  const shiftedLons = lons.map((lon) => (lon < 0 ? lon + 360 : lon));
  const shifted: [number, number] = [Math.min(...shiftedLons), Math.max(...shiftedLons)];

  if (shifted[1] - shifted[0] >= raw[1] - raw[0]) return raw;
  return shifted[0] >= 180 ? [shifted[0] - 360, shifted[1] - 360] : shifted;
}

// The union, not the first match: Natural Earth splits regions into features sharing the parent's code.
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

export type PlaceEntry = {
  id: string;
  name: string;
  kind: "country" | "state";
  parent?: string;
  alt?: string[];
};

export function placeIndexFrom(
  countries: Feature[],
  regions: Feature[],
  bboxes: Record<string, Bbox>
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

// Forward slashes, never path.join: bash reads Windows backslashes as escapes.
const SCRIPT = "scripts/run-tippecanoe.sh";

const posix = (value: string): string => value.replaceAll("\\", "/");

function runTippecanoe(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [SCRIPT, ...args.map(posix)], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`tippecanoe exited ${code}`))
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

  // Stripped to { id }: the archive's bytes must not change.
  await writeFile(countriesFile, collection(stripped(countries)), "utf8");
  await writeFile(regionsFile, collection(stripped(regions)), "utf8");

  const bboxes = { ...bboxesById(countries), ...bboxesById(regions) };
  await writeFile(BBOX_OUTPUT, `${JSON.stringify(bboxes)}\n`, "utf8");
  const bboxSize = (await stat(BBOX_OUTPUT)).size;
  console.log(
    `  bbox:      ${Object.keys(bboxes).length} regions -> ${BBOX_OUTPUT}` +
      ` (${(bboxSize / 1024).toFixed(0)} KB)`
  );

  const places = placeIndexFrom(countries, regions, bboxes);
  await writeFile(PLACE_INDEX_OUTPUT, `${JSON.stringify(places)}\n`, "utf8");
  const placeSize = (await stat(PLACE_INDEX_OUTPUT)).size;
  console.log(
    `  places:    ${places.length} entries -> ${PLACE_INDEX_OUTPUT}` +
      ` (${(placeSize / 1024).toFixed(0)} KB)`
  );

  if (process.argv.includes("--bbox-only")) {
    console.log("--bbox-only: skipping tippecanoe");
    return;
  }

  // No --drop-densest-as-needed: a dropped boundary makes a click outline nothing, silently.
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

// Guarded so tests can import bboxesById without a 54 MB parse and a tippecanoe run.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
