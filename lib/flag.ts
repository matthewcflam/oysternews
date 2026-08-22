/**
 * A country's flag, and its name — what the region panel's header needs
 * that a FIPS region id alone can't give it. `countryName` lives here
 * because it reads the same merged crosswalk table `flagUrl` does, so the
 * merge only happens once. The id is FIPS 10-4; flags are addressed by ISO
 * 3166, and a naive two-letter passthrough would draw Serbia's flag over
 * Russia, Switzerland's over China, Iceland's over Israel, American
 * Samoa's over Australia — see docs/DESIGN.md#the-fips-trap. Reads the
 * same `data/crosswalk.json` the worker uses rather than a second copy
 * that could drift.
 */

import crosswalk from "@/data/crosswalk.json";
import overrides from "@/data/fips-overrides.json";
import { shortCountry } from "@/lib/story";

// flagcdn: public-domain flag PNGs keyed by lowercase ISO alpha-2, no key,
// no rate limit. w640 rather than full-resolution — this is decoration
// behind a heading, not a hero image.
const FLAG_BASE = "https://flagcdn.com/w640";

/**
 * FIPS 10-4 -> ISO 3166 alpha-2. The generated crosswalk alone is not the
 * whole table — Natural Earth populates FIPS_10 on 236/258 features, and
 * the gaps include Israel (1.7% of location mentions, the largest single
 * hole) — so `data/fips-overrides.json` is merged in after and wins on
 * collision. See docs/DESIGN.md#the-fips-trap.
 */
type CrosswalkRow = { iso: string; name: string };

const MERGED: [string, CrosswalkRow][] = [
  ...Object.entries((crosswalk as { fips: Record<string, CrosswalkRow> }).fips),
  ...Object.entries((overrides as { fips: Record<string, CrosswalkRow> }).fips),
];

const FIPS_TO_ISO: Record<string, string> = Object.fromEntries(
  MERGED.map(([fips, entry]) => [fips, entry.iso]),
);

/** The same merge, read for the other column — see `countryName`. */
const FIPS_TO_NAME: Record<string, string> = Object.fromEntries(
  MERGED.map(([fips, entry]) => [fips, entry.name]),
);

// Inverse of FIPS_TO_ISO, for the city shard lookup: city_label carries
// iso_a2, but a country's shard is keyed by FIPS. Overrides win on
// collision (MERGED iterates crosswalk-then-overrides).
const ISO_TO_FIPS: Record<string, string> = {};
for (const [fips, entry] of MERGED) {
  const iso = entry.iso.toUpperCase();
  if (iso && !(iso in ISO_TO_FIPS)) ISO_TO_FIPS[iso] = fips;
}
for (const [fips, entry] of Object.entries(
  (overrides as { fips: Record<string, CrosswalkRow> }).fips,
)) {
  const iso = entry.iso.toUpperCase();
  if (iso) ISO_TO_FIPS[iso] = fips;
}

/** A country's FIPS code from its ISO 3166-1 alpha-2, or `null` when unknown. */
export function fipsForIso(iso: string): string | null {
  return ISO_TO_FIPS[(iso ?? "").trim().toUpperCase()] ?? null;
}

/** A region id shaped like a FIPS country or admin-1 code — two letters, optionally followed by two more alphanumerics. Everything else (a `CONT:XX` continent id, a city's empty id) is not. */
const FIPS_SHAPE = /^[A-Z]{2}([A-Z0-9]{2})?$/;

/**
 * The flag for a region id, or `null` when there is not one to draw — a
 * normal answer for an admin-1 id (4 chars, no flag set), a FIPS code the
 * crosswalk doesn't carry, or an ISO code flagcdn has no image for (that
 * last case surfaces as a failed image load instead). The panel falls back
 * to the flat hero in all three, same as a story with no sharing image.
 */
export function flagUrl(regionId: string): string | null {
  const fips = (regionId ?? "").trim().toUpperCase();
  if (fips.length !== 2) return null;

  const iso = FIPS_TO_ISO[fips];
  if (!iso) return null;

  return `${FLAG_BASE}/${iso.toLowerCase()}.png`;
}

/**
 * The country a region id belongs to, for the panel's breadcrumb —
 * `"India"` for `IN`, `"USA"` for `USCA`. Reads the first two characters
 * only: an admin-1 id is its country's FIPS code with a subdivision
 * appended, so the parent is a prefix, not a join (avoids the name-join
 * trap `flagUrl` also avoids). `""` when the crosswalk lacks the code — the
 * breadcrumb drops the crumb rather than print a bare id. Refuses anything
 * not FIPS-shaped: a bare-prefix slice of `CONT:EU` once returned "Colombia"
 * ("CO") in the breadcrumb before this guard existed.
 */
export function countryName(regionId: string): string {
  const trimmed = (regionId ?? "").trim().toUpperCase();
  if (!FIPS_SHAPE.test(trimmed)) return "";
  return shortCountry(FIPS_TO_NAME[trimmed.slice(0, 2)] ?? "");
}
