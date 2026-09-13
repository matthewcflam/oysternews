// Region ids are FIPS 10-4 and flags are ISO 3166: a two-letter passthrough draws the
// wrong flag (FIPS RS is Russia, ISO RS is Serbia).

import { shortCountry } from "@/lib/story";
import crosswalk from "../../data/crosswalk.json";
import overrides from "../../data/fips-overrides.json";

const FLAG_BASE = "https://flagcdn.com/w640";

// data/fips-overrides.json is merged after the crosswalk and wins: Natural Earth has no
// FIPS_10 for some countries, Israel included.
type CrosswalkRow = { iso: string; name: string };

const MERGED: [string, CrosswalkRow][] = [
  ...Object.entries((crosswalk as { fips: Record<string, CrosswalkRow> }).fips),
  ...Object.entries((overrides as { fips: Record<string, CrosswalkRow> }).fips),
];

const FIPS_TO_ISO: Record<string, string> = Object.fromEntries(
  MERGED.map(([fips, entry]) => [fips, entry.iso])
);

const FIPS_TO_NAME: Record<string, string> = Object.fromEntries(
  MERGED.map(([fips, entry]) => [fips, entry.name])
);

const ISO_TO_FIPS: Record<string, string> = {};
for (const [fips, entry] of MERGED) {
  const iso = entry.iso.toUpperCase();
  if (iso && !(iso in ISO_TO_FIPS)) ISO_TO_FIPS[iso] = fips;
}
for (const [fips, entry] of Object.entries(
  (overrides as { fips: Record<string, CrosswalkRow> }).fips
)) {
  const iso = entry.iso.toUpperCase();
  if (iso) ISO_TO_FIPS[iso] = fips;
}

export function fipsForIso(iso: string): string | null {
  return ISO_TO_FIPS[(iso ?? "").trim().toUpperCase()] ?? null;
}

const FIPS_SHAPE = /^[A-Z]{2}([A-Z0-9]{2})?$/;

export function flagUrl(regionId: string): string | null {
  const fips = (regionId ?? "").trim().toUpperCase();
  if (fips.length !== 2) return null;

  const iso = FIPS_TO_ISO[fips];
  if (!iso) return null;

  return `${FLAG_BASE}/${iso.toLowerCase()}.png`;
}

// Refuses ids that aren't FIPS-shaped: a prefix slice of `CONT:EU` would read as Colombia.
export function countryName(regionId: string): string {
  const trimmed = (regionId ?? "").trim().toUpperCase();
  if (!FIPS_SHAPE.test(trimmed)) return "";
  return shortCountry(FIPS_TO_NAME[trimmed.slice(0, 2)] ?? "");
}
