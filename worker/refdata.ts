/**
 * One loader and one schema check for everything in data/ (HANDOFF.md §3.3).
 *
 * Every other module takes reference data as an argument rather than reading a
 * file, which is what keeps the six pure modules pure and testable without a
 * filesystem. This is the only place that knows data/ exists.
 *
 * The checks below are not defensive padding. A silently truncated demonym list
 * or a crosswalk missing Israel produces a map that looks completely normal and
 * is wrong — the exact failure mode §0 rule 3 says to surface loudly rather than
 * paper over.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

export type Country = { iso: string; name: string };

export type RefData = {
  /** FIPS 10-4 -> ISO + name, crosswalk with overrides applied. */
  countries: Map<string, Country>;
  /** Known non-countries (oceans). Not gaps — they render as plain pins. */
  nonCountries: Set<string>;
  /** Lowercased demonym tokens, matched against the first comma segment. */
  demonyms: Set<string>;
  /** Tier-1 outlet domains (§2.5). Load-bearing. */
  tier1: Set<string>;
  /** Domains dropped before placement (§5 — before the tier-1 check). */
  blocklist: Set<string>;
  /** Publisher-country inference. */
  sourceCountries: {
    domains: Map<string, string>;
    cctldExceptions: Map<string, string>;
  };
};

/**
 * Minimum sizes. These are floors, not exact counts, so adding a demonym or an
 * override does not break the build — but a file that fails to load, gets
 * truncated, or loses its content entirely does.
 */
const MINIMUMS = {
  countries: 200,
  demonyms: 150,
  tier1: 20,
  blocklist: 1,
};

/** Line-oriented reference files: strip `#` comments and blank lines. */
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
  const [crosswalkFile, overridesFile, nonCountriesFile, sourceFile, demonymText, tier1Text, blockText] =
    await Promise.all([
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
    (crosswalkFile.fips ?? {}) as Record<string, Country>,
  )) {
    countries.set(code, entry);
  }
  // Overrides last: they exist to correct and to fill, so they must win.
  for (const [code, entry] of Object.entries(
    (overridesFile.fips ?? {}) as Record<string, Country>,
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
        ]),
      ),
      cctldExceptions: new Map(
        Object.entries((sourceFile.cctldExceptions ?? {}) as Record<string, string>).map(
          ([k, v]) => [k.toLowerCase(), v],
        ),
      ),
    },
  };

  assertUsable(refdata);
  return refdata;
}

/**
 * The build-time coverage check §3.2 requires, plus the §3.4 trap assertion.
 *
 * The trap check has to live here rather than in scripts/build-crosswalk.ts,
 * because Natural Earth has no FIPS_10 for Israel at all — the generator cannot
 * assert what only the override file supplies. Here the merged view exists.
 */
export function assertUsable(data: RefData): void {
  const problems: string[] = [];

  if (data.countries.size < MINIMUMS.countries) {
    problems.push(`crosswalk has ${data.countries.size} countries, expected >= ${MINIMUMS.countries}`);
  }
  if (data.demonyms.size < MINIMUMS.demonyms) {
    problems.push(`demonym list has ${data.demonyms.size} entries, expected >= ${MINIMUMS.demonyms}`);
  }
  if (data.tier1.size < MINIMUMS.tier1) {
    problems.push(`tier-1 list has ${data.tier1.size} domains, expected >= ${MINIMUMS.tier1}`);
  }
  if (data.blocklist.size < MINIMUMS.blocklist) {
    problems.push(`blocklist is empty`);
  }

  // §3.4. Four FIPS codes mean an entirely different country under ISO, and a
  // naive join produces correct-looking output with Russian news in the Balkans.
  // UK is unassigned in ISO and fails loudly rather than silently, which is why
  // it is checked too.
  const traps: Record<string, string> = { RS: "RU", CH: "CN", IS: "IL", AS: "AU", UK: "GB" };
  for (const [fips, iso] of Object.entries(traps)) {
    const got = data.countries.get(fips)?.iso;
    if (got !== iso) {
      problems.push(`FIPS trap: ${fips} should map to ${iso}, got ${got ?? "nothing"}`);
    }
  }

  // §5's ordering guarantee is about *when* the lists are consulted, but an
  // overlap would make the ordering load-bearing in a way nobody would notice.
  // There is none today; this makes a future edit that introduces one visible.
  const overlap = [...data.tier1].filter((domain) => data.blocklist.has(domain));
  if (overlap.length > 0) {
    problems.push(`domains in both tier-1 and blocklist: ${overlap.join(", ")}`);
  }

  if (problems.length > 0) {
    throw new Error(`data/ failed its checks:\n  - ${problems.join("\n  - ")}`);
  }
}

/**
 * Publisher country from a domain: explicit override, then ccTLD, then unknown.
 *
 * Returns "" for unknown, and callers must EXCLUDE that from the distinct-country
 * count rather than treat it as a country. See data/source-countries.json — the
 * unresolved tail is mostly US local broadcast stations, and bucketing them
 * together would invent a shared nationality for unrelated publishers.
 */
export function sourceCountry(domain: string, data: RefData): string {
  const clean = domain.trim().toLowerCase();
  if (!clean) return "";

  const explicit = data.sourceCountries.domains.get(clean);
  if (explicit !== undefined) return explicit;

  const parts = clean.split(".");
  const tld = parts[parts.length - 1];
  // Two-letter TLDs are ccTLDs; everything else (.com, .net, .info) carries no
  // country information at all.
  if (tld.length !== 2) return "";

  const exception = data.sourceCountries.cctldExceptions.get(tld);
  if (exception !== undefined) return exception;
  return tld.toUpperCase();
}
