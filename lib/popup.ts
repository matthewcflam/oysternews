/**
 * What a story popup says (HANDOFF.md §2.6, §5.2 decision 3).
 *
 * Extracted from `MapView.tsx` for the same reason `lib/layers.ts` was: this is
 * a product rule, not decoration. Two of them meet here.
 *
 * 1. **§2.6 is link-out only** — title, source, link, never article text. This
 *    function is the whole surface through which a story reaches the popup, so
 *    "the popup contains title, source and link and nothing else" is a thing a
 *    test can assert (§7 critical gap 2) rather than a thing review has to catch.
 * 2. **§5.2 decision 3: the geotag-confidence treatment, pin half.** The
 *    container half is the hollow ring in `lib/layers.ts` — a container is drawn
 *    unlike a pin because it claims less. A pin claims a point, and the pipeline
 *    measured itself getting that right 69.7% of the time [52.7, 82.6]. So the
 *    popup **names the place the rule picked, and says it was picked
 *    automatically**.
 *
 * **Why naming the place is the treatment, rather than a visual one.** The
 * obvious alternative was to grade pins — draw the shaky ones differently — and
 * that was tested before it was built. The only per-pin quantity available at
 * render time is how many times the placed location was mentioned, and it does
 * not predict correctness:
 *
 * ```
 *                        mentioned once        mentioned 2+        Fisher
 *   out-of-sample (60)   n= 6  33.3%           n=27  77.8%         p=0.053
 *   transferred  (110)   n=12  58.3%           n=28  64.3%         p=0.736
 *   pooled               n=18  50.0%           n=55  70.9%         p=0.152
 * ```
 *
 * The out-of-sample draw looks like a strong signal at n=6 and would have been
 * built on; the larger sample flattens it. **There is no per-pin signal, so the
 * treatment is uniform** — and a uniform *visual* treatment carries no
 * information (the ring works because it contrasts with pins; a halo on every
 * pin has nothing to contrast with) while costing a third circle layer of
 * overdraw on a phone (§1). Naming the place costs nothing: `place` is already
 * in the tile properties and was unused in the browser. It also makes the claim
 * falsifiable at a glance — a reader who sees a Houston headline over
 * "Ranchi, Jharkhand, India" can tell immediately, which is the point.
 *
 * **The number itself is Phase 6's job**, not this line's: §5.2 decision 3 puts
 * "publish 69.7% [52.7, 82.6] and the method" on the About page. Repeating an
 * interval in every popup would be noise, and §0 rule 2 says not to scaffold a
 * later phase from here.
 *
 * The region panel is deliberately left alone. It already names each story's
 * place in its meta line, and a qualifier repeated on every row is noise where
 * one on a single selected story is not.
 */

/** The only fields a popup may read. There is no field for article text. */
export type PopupStory = {
  title?: unknown;
  source?: unknown;
  url?: unknown;
  place?: unknown;
  kind?: unknown;
};

export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] as string,
  );

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * The placement line, or `""` when the feature carries no place name.
 *
 * A container says "somewhere in", because that is exactly what §2.1 chose it
 * for: the story had no usable exact location. A pin names the point. Both say
 * the choice was automatic — the accuracy is a property of the rule, and the
 * measurement above says it is not a property of the individual pin.
 */
export function placementLine(story: PopupStory): string {
  const place = text(story.place);
  if (!place) return "";
  const where = story.kind === "CONTAINER" ? `Somewhere in ${place}` : place;
  return `${where} · placed automatically`;
}

/**
 * The popup's inner HTML.
 *
 * Built as a string rather than as a DOM tree because MapLibre's `setHTML` takes
 * one; every interpolation therefore goes through `escapeHtml`, including the
 * href, which is remote content from GDELT.
 */
export function storyPopupHtml(story: PopupStory): string {
  const placement = placementLine(story);
  return (
    `<strong>${escapeHtml(story.title)}</strong><br>` +
    `<em>${escapeHtml(story.source)}</em><br>` +
    (placement ? `<span class="popup__place">${escapeHtml(placement)}</span><br>` : "") +
    `<a href="${escapeHtml(story.url)}" target="_blank" rel="noopener noreferrer">Read at source</a>`
  );
}
