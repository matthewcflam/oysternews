const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

// The home view is a box, not a zoom: a fixed zoom is a fixed pixel width (z2 = 2048px), so small
// screens landed zoomed in. Cape Horn to the Arctic coasts; MapTiler labels countries from z1.
export const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-180, -56],
  [180, 75],
];

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
