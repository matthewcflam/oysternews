/**
 * A country's flag, and its name — the two things the region panel's header
 * needs that a FIPS region id alone cannot give it.
 *
 * The flag is the panel's one picture. A region has no article and therefore no
 * `og:image` the way a story does, and a flag is the one image that is
 * unambiguously *of* the country and needs no per-region curation. Mode 3
 * (2026-08-16) moved it from a full-bleed hero to a small plate beside the
 * heading; nothing about the lookup changed with it.
 *
 * `countryName` is here rather than in a file of its own because it reads the
 * same merged table `flagUrl` does. Two modules merging the same two JSON files
 * is two places for the merge order to drift, and the order is load-bearing —
 * see below.
 *
 * **The id is FIPS 10-4, and flags are addressed by ISO 3166.** That is §3.4's
 * join trap, and it is silent: a naive two-letter passthrough draws Serbia's flag
 * over Russia, Switzerland's over China, Iceland's over Israel and American
 * Samoa's over Australia — four countries that would each look like a plausible
 * bug in the map rather than in a lookup. `data/crosswalk.json` is the mapping
 * the worker already uses, so the browser reads the same table rather than a
 * second copy that could drift.
 */

import crosswalk from "@/data/crosswalk.json";
import overrides from "@/data/fips-overrides.json";
import { shortCountry } from "@/lib/story";

/**
 * Where the images come from. flagcdn serves public-domain flag PNGs keyed by
 * lowercase ISO alpha-2, with no key and no rate limit to manage — the same
 * "free tier everywhere" constraint §2.6 puts on the basemap.
 *
 * w640 rather than the full-resolution file: the hero is 420px wide at most and
 * this is a decoration behind a heading, so anything larger is bytes spent on a
 * phone (§1) for pixels nobody sees.
 */
const FLAG_BASE = "https://flagcdn.com/w640";

/**
 * FIPS 10-4 → ISO 3166 alpha-2.
 *
 * **The generated crosswalk is not the whole table**, and reading it alone is a
 * mistake with a name: Natural Earth populates `FIPS_10` on 236 of 258 features
 * and the gaps are not random — they are territories plus, awkwardly, **Israel**,
 * which `data/fips-overrides.json` measures at 1.7% of all location mentions,
 * the largest single hole by a wide margin. `worker/refdata.ts` merges the two
 * files in this order for exactly that reason, and this is the same merge; the
 * overrides go last because they exist to correct AND to fill, so they must win.
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

/**
 * The flag for a region id, or `null` when there is not one to draw.
 *
 * `null` is a normal answer in three cases, and the panel treats all three the
 * same way — as the story panel already treats a story with no `og:image`, by
 * falling back to the flat purple hero:
 *
 * 1. **An admin-1 id** (`USCA`, `IN25` — four characters). A state or province
 *    is not a country, and there is no equivalent flag set for them. Length is
 *    the test because that is exactly what distinguishes the two id shapes in
 *    `boundaries.pmtiles`.
 * 2. **A FIPS code the crosswalk does not carry.** Natural Earth writes no
 *    `FIPS_10` for a handful of polygons, so the outline can exist where the
 *    mapping does not.
 * 3. **An ISO code flagcdn has no image for.** Not detectable here — it surfaces
 *    as a failed image load, which the panel handles the same way.
 */
export function flagUrl(regionId: string): string | null {
  const fips = (regionId ?? "").trim().toUpperCase();
  if (fips.length !== 2) return null;

  const iso = FIPS_TO_ISO[fips];
  if (!iso) return null;

  return `${FLAG_BASE}/${iso.toLowerCase()}.png`;
}

/**
 * The country a region id belongs to, for the panel's breadcrumb — `"India"`
 * for `IN`, `"USA"` for `USCA`.
 *
 * **It reads the first two characters and nothing else**, which is the whole of
 * the country/admin-1 relationship as `boundaries.pmtiles` encodes it: an
 * admin-1 id is its country's FIPS code with a two-character subdivision
 * appended (`USCA`, `IN25`), so the parent is a prefix rather than a join. That
 * matters — §3.4 — because the alternative is matching "California" to a country
 * by name, which is the trap `flagUrl` above exists to avoid.
 *
 * `""` when the crosswalk does not carry the code. The breadcrumb drops the
 * missing crumb rather than printing a bare id: it is a wayfinding line, and
 * "World › IN25 › …" tells the reader less than "World › …" does.
 *
 * Shortened through `shortCountry` so a breadcrumb and a story row two inches
 * below it cannot spell the same country two different ways — the crosswalk says
 * "United States of America" where GDELT says "United States".
 */
export function countryName(regionId: string): string {
  const fips = (regionId ?? "").trim().toUpperCase().slice(0, 2);
  return shortCountry(FIPS_TO_NAME[fips] ?? "");
}
