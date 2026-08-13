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

/**
 * The default camera, and the "Global" button's target (§2.3).
 *
 * **z2, not z1.5, and the basemap is what forces it.** MapTiler draws no country
 * labels below z2 (`country_label` is z2-12; OpenFreeMap's are z0-9), and §2.3's
 * whole gesture is clicking a country label — so at z1.5 on the production
 * basemap the feature is invisible on arrival, with nothing on screen to click.
 * Measured against both live styles on 2026-08-13.
 *
 * It lives in this file rather than next to the layers because the constraint is
 * a property of the basemap, not of our data.
 */
export const DEFAULT_CENTER: [number, number] = [0, 20];
export const DEFAULT_ZOOM = 2;

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
      styleUrl: `https://api.maptiler.com/maps/019fef1b-6271-7b5d-bc0d-bc743ed95216/style.json?key=${key}`,
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
