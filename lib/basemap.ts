/**
 * Basemap style resolution.
 *
 * HANDOFF.md §3.1 locks MapTiler as the basemap, with OpenFreeMap as a one-line
 * escape hatch. §2.6 requires the MapTiler key to be domain-restricted, which
 * means the key is created in the MapTiler console, not here — this module only
 * reads it.
 *
 * The fallback exists so the app renders on a machine with no key at all. It is
 * a development convenience and a documented escape hatch, NOT a silent
 * substitute in production: `basemap().provider` is surfaced in the UI so a
 * keyless deploy is visible rather than merely different.
 */

const MAPTILER_STYLE = "streets-v2";
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export type Basemap = {
  styleUrl: string;
  provider: "maptiler" | "openfreemap";
  /** §2.6: attribution and logo stay visible. MapLibre renders this itself. */
  attribution: string;
};

export function basemap(): Basemap {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;

  if (key) {
    return {
      styleUrl: `https://api.maptiler.com/maps/${MAPTILER_STYLE}/style.json?key=${key}`,
      provider: "maptiler",
      attribution:
        '© <a href="https://www.maptiler.com/copyright/">MapTiler</a> ' +
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    };
  }

  return {
    styleUrl: OPENFREEMAP_STYLE,
    provider: "openfreemap",
    attribution:
      '© <a href="https://openfreemap.org/">OpenFreeMap</a> ' +
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  };
}
