/**
 * Basemap style resolution: MapTiler in production, OpenFreeMap as a
 * fallback so the app still renders with no key. NOT a silent substitute —
 * `basemap().provider` is surfaced in the UI so a keyless deploy is
 * visible rather than merely different. See docs/DESIGN.md#basemap.
 */

const MAPTILER_STYLE = "streets-v2";
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

/**
 * The default camera, and the "Global" button's target. z2, not z1.5 — the
 * basemap forces it: MapTiler draws no country labels below z2, and the
 * label-click gesture needs one visible on arrival. See
 * docs/DESIGN.md#the-label-based-gesture-and-no-name-matching-ever.
 */
export const DEFAULT_CENTER: [number, number] = [0, 20];
export const DEFAULT_ZOOM = 2;

export type Basemap = {
  styleUrl: string;
  provider: "maptiler" | "openfreemap";
  /** Attribution and logo stay visible; MapLibre renders this itself. */
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
