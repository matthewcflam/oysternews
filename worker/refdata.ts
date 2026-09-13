import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

export type Country = { iso: string; name: string; continent?: string };

export type RefData = {
  countries: Map<string, Country>;
  nonCountries: Set<string>;
  demonyms: Set<string>;
  tier1: Set<string>;
  blocklist: Set<string>;
  sourceCountries: {
    domains: Map<string, string>;
    cctldExceptions: Map<string, string>;
  };
};

const MINIMUMS = {
  countries: 200,
  demonyms: 150,
  tier1: 20,
  blocklist: 1,
};

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.split("#")[0].trim())
    .filter((line) => line.length > 0);
}

async function json(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(DATA_DIR, file), "utf8"));
}

export async function loadRefData(): Promise<RefData> {
  const [
    crosswalkFile,
    overridesFile,
    nonCountriesFile,
    sourceFile,
    demonymText,
    tier1Text,
    blockText,
  ] = await Promise.all([
    json("crosswalk.json"),
    json("fips-overrides.json"),
    json("non-countries.json"),
    json("source-countries.json"),
    readFile(path.join(DATA_DIR, "demonyms.txt"), "utf8"),
    readFile(path.join(DATA_DIR, "tier1-domains.txt"), "utf8"),
    readFile(path.join(DATA_DIR, "blocklist.txt"), "utf8"),
  ]);

  const countries = new Map<string, Country>();
  for (const [code, entry] of Object.entries(
    (crosswalkFile.fips ?? {}) as Record<string, Country>
  )) {
    countries.set(code, entry);
  }
  // Overrides last: they exist to correct and to fill, so they must win.
  for (const [code, entry] of Object.entries(
    (overridesFile.fips ?? {}) as Record<string, Country>
  )) {
    countries.set(code, entry);
  }

  const demonyms = new Set<string>();
  for (const line of lines(demonymText)) {
    for (const token of line.split(",")) {
      const cleaned = token.trim().toLowerCase();
      if (cleaned) demonyms.add(cleaned);
    }
  }

  const refdata: RefData = {
    countries,
    nonCountries: new Set((nonCountriesFile.codes ?? []) as string[]),
    demonyms,
    tier1: new Set(lines(tier1Text).map((d) => d.toLowerCase())),
    blocklist: new Set(lines(blockText).map((d) => d.toLowerCase())),
    sourceCountries: {
      domains: new Map(
        Object.entries((sourceFile.domains ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ])
      ),
      cctldExceptions: new Map(
        Object.entries((sourceFile.cctldExceptions ?? {}) as Record<string, string>).map(
          ([k, v]) => [k.toLowerCase(), v]
        )
      ),
    },
  };

  assertUsable(refdata);
  return refdata;
}

// The FIPS/ISO trap check lives here, not in build-crosswalk.ts: Natural Earth has no
// FIPS_10 for Israel, so only the merged view with overrides can be asserted.
export function assertUsable(data: RefData): void {
  const problems: string[] = [];

  if (data.countries.size < MINIMUMS.countries) {
    problems.push(
      `crosswalk has ${data.countries.size} countries, expected >= ${MINIMUMS.countries}`
    );
  }
  if (data.demonyms.size < MINIMUMS.demonyms) {
    problems.push(
      `demonym list has ${data.demonyms.size} entries, expected >= ${MINIMUMS.demonyms}`
    );
  }
  if (data.tier1.size < MINIMUMS.tier1) {
    problems.push(`tier-1 list has ${data.tier1.size} domains, expected >= ${MINIMUMS.tier1}`);
  }
  if (data.blocklist.size < MINIMUMS.blocklist) {
    problems.push(`blocklist is empty`);
  }

  // These FIPS codes mean a different country under ISO, and a naive join produces
  // correct-looking output (Russian news in the Balkans). UK is unassigned in ISO.
  const traps: Record<string, string> = { RS: "RU", CH: "CN", IS: "IL", AS: "AU", UK: "GB" };
  for (const [fips, iso] of Object.entries(traps)) {
    const got = data.countries.get(fips)?.iso;
    if (got !== iso) {
      problems.push(`FIPS trap: ${fips} should map to ${iso}, got ${got ?? "nothing"}`);
    }
  }

  const overlap = [...data.tier1].filter((domain) => data.blocklist.has(domain));
  if (overlap.length > 0) {
    problems.push(`domains in both tier-1 and blocklist: ${overlap.join(", ")}`);
  }

  if (problems.length > 0) {
    throw new Error(`data/ failed its checks:\n  - ${problems.join("\n  - ")}`);
  }
}

// Returns "" when unknown. Callers must exclude "" from distinct-country counts: the
// unresolved tail is mostly US local stations, not one shared nationality.
export function sourceCountry(domain: string, data: RefData): string {
  const clean = domain.trim().toLowerCase();
  if (!clean) return "";

  const explicit = data.sourceCountries.domains.get(clean);
  if (explicit !== undefined) return explicit;

  const parts = clean.split(".");
  const tld = parts[parts.length - 1];
  if (tld.length !== 2) return "";

  const exception = data.sourceCountries.cctldExceptions.get(tld);
  if (exception !== undefined) return exception;
  return tld.toUpperCase();
}
