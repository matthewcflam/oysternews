/**
 * The favicon and the search field, centred over the top of the map.
 *
 * **It is deliberately inert.** Search is not built: there is no place index, no
 * geocoder and no decision about whether a query moves the camera or filters the
 * stories. What exists is the mark from the mockup, at the size the mockup gives
 * it, so the layout it has to live in is settled before the behaviour is.
 *
 * That is why this is a `div` with `aria-hidden` and not a disabled `<input>`. A
 * real field invites a reader to type and then swallows what they typed, which
 * is worse than no field; a disabled one still lands in the tab order on some
 * browsers and announces itself to a screen reader as a control that exists but
 * cannot be used. Neither is true — the control does not exist yet. When it does,
 * this becomes a `form` and the `aria-hidden` comes off.
 *
 * **The mark stopped being the pin (2026-08-15).** It was the map's own `#D24F39`
 * disc, ringed and highlighted like a top-5 story. Mode 1 now draws real stories
 * in exactly that orange with their headlines attached, an inch below this, so a
 * decorative copy of the mark read as a sixth story that would not open. The
 * mockup makes it a purple sphere instead: still a mark, no longer a claim. Its
 * highlight moved to the wordmark, where it is an orange bead in the "O".
 */
export default function SearchBar() {
  return (
    <div className="search" aria-hidden="true">
      <span className="search__mark" />

      <div className="search__field">
        <span className="search__placeholder">Where to next?</span>
        <svg
          className="search__icon"
          viewBox="0 0 19 19"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="8" cy="8" r="5" />
          <path d="M11.8 11.8 L16.4 16.4" />
        </svg>
      </div>
    </div>
  );
}
