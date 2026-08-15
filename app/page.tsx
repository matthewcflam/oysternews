import BrandMark from "@/components/BrandMark";
import MapView from "@/components/MapView";
import SearchBar from "@/components/SearchBar";

/**
 * The map, and two small pieces of chrome over it.
 *
 * **The masthead came back small (2026-08-14).** The original was a band across
 * the top that pushed the panels down to clear it, and deleting it gave the map
 * its top edge — at the cost of the product's name and of /about, which had to
 * hide inside the story panel where it was reachable only with a story open.
 *
 * What replaced it takes two corners instead of a band: `BrandMark` top-right
 * (wordmark, freshness stamp, About Us) and `SearchBar` top-centre. Both float
 * over the map with no plate and no reserved height, so the map still starts at
 * the top edge and the panels still start at 0.
 *
 * Both sit UNDER the panels (`z-index: 2` against 3). Below 520px the story
 * panel is the full viewport width and would otherwise collide with both; it
 * covers them instead, and they are still there when it closes.
 */
export default function Home() {
  return (
    <main>
      <MapView />
      <SearchBar />
      <BrandMark />
    </main>
  );
}
