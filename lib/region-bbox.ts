/**
 * The browser's half of "Zoom to Texas": per-region bounding boxes, and
 * the camera fit computed from one. Static and committed, unlike the
 * story index — built from the same Natural Earth features the outline
 * archive uses, so every id in it is one the outline can draw; addressed
 * relative to the origin rather than through the manifest, since it does
 * not change between runs. Fetched lazily on the first label click, same
 * reasoning as the region index.
 */

/** `[west, south, east, north]`. West may exceed east — see `MAX_FIT_ZOOM`. */
export type Bbox = [number, number, number, number];

export type BboxTable = Record<string, Bbox>;

export const BBOX_URL = "/region-bbox.json";

let pending: Promise<BboxTable> | null = null;

// Fetch the table once, however many clicks ask for it. Memoized on the
// promise so two fast clicks share one request. Not keyed by URL, unlike
// loadRegionIndex — there is only one URL, immutable for the deploy's life.
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

/** Test seam. */
export function resetRegionBboxCache(): void {
  pending = null;
}

// How far in a fit may go. A small region (Singapore, Delaware) would
// otherwise ask for z11-14, past the archive's own z12 ceiling — above it
// MapLibre overzooms the last real tile, which reads as the map running
// out of news. z9 keeps a region's pins in view with its neighbours around it.
export const MAX_FIT_ZOOM = 9;

/** Breathing room around the fitted box, so a coastline is not flush to the edge. */
export const FIT_PADDING = 48;

/**
 * A region's box, or `null` when the table doesn't carry it — a normal
 * answer (the story index and the boundary set are two different files
 * that never agree perfectly), and the panel hides the button rather than
 * offer one that does nothing. Validated rather than trusted, since this
 * is fetched JSON feeding a camera move, and `fitBounds` on a NaN strands
 * the reader without a reload.
 */
export function bboxFor(table: BboxTable | null, regionId: string): Bbox | null {
  if (!table || !regionId) return null;
  const box = table[regionId];
  if (!Array.isArray(box) || box.length !== 4) return null;
  if (!box.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  // A degenerate box — a region reduced to a point by a bad join — would fit to
  // maximum zoom on an arbitrary coordinate.
  if (box[2] <= box[0] || box[3] <= box[1]) return null;
  return box as Bbox;
}
