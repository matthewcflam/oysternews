/**
 * A country's flag, for the region panel's hero.
 *
 * The panel is the story panel's shell reused, and the story panel's hero is the
 * publisher's `og:image`. A region has no article and therefore no image, so the
 * flag is what fills that slot — it is the one picture that is unambiguously
 * *of* the country and needs no per-region curation.
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
const FIPS_TO_ISO: Record<string, string> = Object.fromEntries(
  [
    ...Object.entries((crosswalk as { fips: Record<string, { iso: string }> }).fips),
    ...Object.entries((overrides as { fips: Record<string, { iso: string }> }).fips),
  ].map(([fips, entry]) => [fips, entry.iso]),
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
