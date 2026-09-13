// West may exceed east for a region crossing the antimeridian.
export type Bbox = [number, number, number, number];

export type BboxTable = Record<string, Bbox>;

const BBOX_URL = "/region-bbox.json";

let pending: Promise<BboxTable> | null = null;

export function loadRegionBboxes(): Promise<BboxTable> {
  if (!pending) {
    pending = fetch(BBOX_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`region bbox: HTTP ${response.status}`);
        return (await response.json()) as BboxTable;
      })
      .catch((cause: unknown) => {
        pending = null;
        throw cause;
      });
  }
  return pending;
}

// Past the archive's z12 ceiling MapLibre overzooms the last tile and the map reads as empty.
export const MAX_FIT_ZOOM = 9;

export const FIT_PADDING = 48;

// Validated, not trusted: fitBounds on a NaN strands the reader until a reload.
export function bboxFor(table: BboxTable | null, regionId: string): Bbox | null {
  if (!table || !regionId) return null;
  const box = table[regionId];
  if (!Array.isArray(box) || box.length !== 4) return null;
  if (!box.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  // A degenerate box would fit to maximum zoom on an arbitrary point.
  if (box[2] <= box[0] || box[3] <= box[1]) return null;
  return box as Bbox;
}
