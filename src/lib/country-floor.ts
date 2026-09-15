// Imported by worker/budget.ts: changing it changes the tiles, so rebuild the archive too.
// Capped: the country floor overlaps the stories layer, so past this zoom a story would
// draw twice on top of itself. The budget guarantees every floor story is in the stories
// layer by this zoom, or the handover would delete it.
export const COUNTRY_LAYER_MAXZOOM = 4;
