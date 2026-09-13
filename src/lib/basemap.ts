const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

// z2, not lower: MapTiler draws no country labels below it, and the label click needs one.
export const DEFAULT_CENTER: [number, number] = [0, 20];
export const DEFAULT_ZOOM = 2;

export type Basemap = {
  styleUrl: string;
  provider: "maptiler" | "openfreemap";
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
