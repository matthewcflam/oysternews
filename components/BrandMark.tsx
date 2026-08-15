import Link from "next/link";
import FreshnessStamp from "./FreshnessStamp";

/**
 * The brand block over the map's top-right corner: the wordmark, when the data
 * was last built, and the way into /about.
 *
 * **This is the masthead coming back, at a tenth of the size.** The old one was
 * a ~100px band across the full width that pushed the panels down to clear it,
 * and it was deleted on 2026-08-14 because the map is the product. What went
 * with it was the product's name and the only always-reachable link to §5.2's
 * measured accuracy — the freshness stamp survived alone, holding a corner for
 * nothing else to use. Three stacked lines in one corner give both back without
 * taking a band of map from anyone.
 *
 * **No plate, no background.** Legibility over a light basemap comes from a
 * text-shadow, the same trick the stamp has used since it lost the band; a plate
 * here would be the masthead again in miniature.
 *
 * `pointer-events` are off for the block and back on for the link alone (see
 * `.brand` in globals.css) — a drag started anywhere in this corner has to reach
 * the map underneath it, because the corner is map.
 */
export default function BrandMark() {
  return (
    <div className="brand">
      {/*
        A `p`, not an `h1`. The page's heading is the map, and the one real
        heading on screen is the panel's `h2` for whatever is selected; an `h1`
        that says "Oyster" would put the brand above the content in the outline
        a screen reader reads, which is the wrong shape for a product whose whole
        surface is the thing underneath this text.
      */}
      {/*
        The bead in the counter of the "O" is the search sphere at a fifth of the
        size — one mark, declared once in `globals.css`. It was the map's orange
        until 2026-08-15, which made it a shrunken story pin sitting inside the
        product's name.

        Decoration on top of a glyph, so it is `aria-hidden` and the word stays a
        word — a screen reader reads "Oyster", not "Oyster, image".
      */}
      <p className="brand__word">
        Oyster
        <span className="brand__dot" aria-hidden="true" />
      </p>

      {/* Renders nothing until the manifest resolves — the block is sized by its
        contents, so the row simply is not there rather than sitting empty. */}
      <FreshnessStamp />

      {/* `next/link`, not an anchor: /about is a route in this app, and a full
        document load would discard the map and every tile it has cached. */}
      <Link className="brand__about" href="/about">
        <svg
          className="brand__info"
          viewBox="0 0 20 20"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        >
          <circle cx="10" cy="10" r="5.5" />
          <path d="M10 9v4" strokeLinecap="round" />
          <path d="M10 6.75v.5" strokeLinecap="round" />
        </svg>
        About Us
      </Link>
    </div>
  );
}
