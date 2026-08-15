import FreshnessStamp from "@/components/FreshnessStamp";
import MapView from "@/components/MapView";

/**
 * The map, and one line of chrome over it.
 *
 * **The masthead is gone (2026-08-14).** The wordmark, the subtitle and the
 * plate they sat on took the top ~100px of every screen and pushed the panels
 * down to clear them; the map is the product, so the page now starts at the top
 * edge. What survived is the freshness stamp — a claim of freshness with no
 * timestamp is one a visitor cannot check — and it moved to the top-right corner
 * that MapLibre's zoom control vacated (see `MapView`, which now docks it
 * bottom-right).
 *
 * "How this works" moved into the story panel rather than being deleted: §5.2
 * decision 3 requires the measured accuracy to be reachable from the product,
 * and the panel is the only surface with room for a link that is not covering
 * map. It is therefore reachable only with a story open — the deliberate trade.
 */
export default function Home() {
  return (
    <main>
      <MapView />
      <FreshnessStamp />
    </main>
  );
}
