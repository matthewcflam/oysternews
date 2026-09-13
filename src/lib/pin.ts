import { MARK } from "./layers";

export const PIN_WIDTH = 30;
export const PIN_HEIGHT = 34;

export const PIN_LEFT_PAD = 0.2;

export const PIN_PIXEL_RATIO = 2;

const SUBSAMPLES = 4;

const rgb = (hex: string): [number, number, number] => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`pin: expected #RRGGBB, got ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
};

const coverage = (x: number, y: number, width: number, height: number): number => {
  const apex = width / 2;
  const start = width * PIN_LEFT_PAD;
  let inside = 0;

  for (let sy = 0; sy < SUBSAMPLES; sy++) {
    // Subpixel centres, not corners: a corner sample on an edge miscounts coverage.
    const py = y + (sy + 0.5) / SUBSAMPLES;
    const ratio = py / height;
    const left = start + (apex - start) * ratio;
    const right = width + (apex - width) * ratio;

    for (let sx = 0; sx < SUBSAMPLES; sx++) {
      const px = x + (sx + 0.5) / SUBSAMPLES;
      if (px >= left && px <= right) inside++;
    }
  }

  return inside / (SUBSAMPLES * SUBSAMPLES);
};

// Straight alpha, not premultiplied: MapLibre expects colour bytes at full strength.
export function trianglePin(
  cssWidth: number = PIN_WIDTH,
  cssHeight: number = PIN_HEIGHT,
  pixelRatio: number = PIN_PIXEL_RATIO
): { width: number; height: number; data: Uint8ClampedArray } {
  const width = Math.round(cssWidth * pixelRatio);
  const height = Math.round(cssHeight * pixelRatio);
  const [r, g, b] = rgb(MARK);
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = Math.round(coverage(x, y, width, height) * 255);
    }
  }

  return { width, height, data };
}
