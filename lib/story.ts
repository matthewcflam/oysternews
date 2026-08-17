/**
 * What a story panel says (HANDOFF.md §2.6, §5.2 decision 3).
 *
 * **This file replaces `lib/popup.ts` and inherits its job.** The map popup is
 * gone — a click now opens the left panel — but the constraint the popup existed
 * to enforce is not, and it must not evaporate with the surface it guarded.
 *
 * 1. **§2.6 is link-out only** — title, source, link, never article text.
 *    `PanelStory` is the whole of what the panel may render, and `panelStory()`
 *    is the only door into it: it reads eight named fields off a tile feature and
 *    drops everything else, so a property that started carrying prose upstream
 *    cannot reach the DOM. §7 critical gap 2 asked for that to be a test rather
 *    than a review note; `story.test.ts` is that test.
 * 2. **§5.2 decision 3: the geotag-confidence treatment, pin half.** The card
 *    names the place the rule picked; that a rule picked it, and how often the
 *    rule is right, moved to /about on 2026-08-16 behind "How does this work?".
 *    The measurement behind the treatment — mention count does not predict
 *    correctness, pooled n=73, 50.0% against 70.9%, Fisher p=0.152 — is unchanged
 *    by that move, so the treatment stays uniform and `placementLine` still
 *    refuses to grade a pin by salience or domain count. **It is still exported
 *    and still tested**: what changed is which surface says it, not whether it is
 *    said, and deleting it would be dropping a measured disclosure by accident.
 *
 * The one thing the panel adds over the popup is a *heading*: the mock puts the
 * place at the top, over the image, as the panel's subject. `placeHeading` is
 * that, and it is display-only — see the note on `SHORT_COUNTRY`.
 */

import { ago } from "./age";

/**
 * The only fields a story panel may read. There is no field for article text.
 *
 * **`image` joined this list on 2026-08-14, and the reasoning matters more than
 * the field.** It was deliberately absent while the thumbnail came from
 * `lib/og.ts`, which fetched it per url at click time — keeping it out of the
 * type meant this stayed an assertion about the *story*. The thumbnail now
 * arrives on the tile feature with everything else, because GDELT hands it to
 * the pipeline (`V2.1SHARINGIMAGE`) and re-deriving it cost a server-side fetch
 * of the article page.
 *
 * So the field list grew from six names to seven, and **that is the assertion
 * loosening by exactly one field** — worth saying out loud, because the list is
 * the §2.6 enforcement point and a list that grows quietly enforces nothing. An
 * image URL is not article text: it is a pointer to the publisher's own CDN, the
 * same class of thing as `url`. `story.test.ts` pins the seven names and still
 * drops `salience`, `domains`, `tier1`, `region`, `country` and an injected
 * `body`.
 */
export type PanelStory = {
  title: string;
  /** The publishing domain. */
  source: string;
  url: string;
  /** GDELT's FullName for wherever §2.1 put the story. */
  place: string;
  kind: string;
  /** GKG stamp of the newest article in the group, YYYYMMDDHHMMSS, UTC. */
  date: string;
  /**
   * The article's own sharing image, or "" — most often "" because 12.2% of
   * records declare none, in which case the panel draws its flat accent header.
   *
   * **Validated in `worker/parse.ts`, not here.** The archive is the boundary:
   * a URL that is not http/https never reaches a tile. The panel's own guards —
   * `onError` and the minimum-width check — exist for images that break or turn
   * out to be tracking pixels, which is a different problem.
   */
  image: string;
  /**
   * Other outlets covering the SAME story — "More Reporting" on the card. Empty
   * for a one-article group, which is 87.2% of them (measured, `theme-audit`), so
   * the empty case is the normal one and the card omits the section entirely.
   *
   * **The eighth field, and the eighth is admitted on the same argument as the
   * seventh.** A list of urls is more link-out, not article text — the same class
   * of thing as `url` itself. That is the whole defence, and it has to fit in one
   * sentence or the field does not belong here.
   *
   * **`topic` deliberately did NOT join this list.** The classifier exists and
   * `worker/topics.ts` computes a display topic per group, but the story card
   * shows no topic label — chips are a Mode 3 filter over a region's rows. So it
   * belongs on the leak list rather than in the allowlist, and `story.test.ts`
   * asserts it is dropped. Decided explicitly, because the plan asked for it to
   * be decided rather than omitted.
   *
   * **Arrives as a delimited string, not an array.** MVT property values are
   * scalar, so `worker/tiles.ts` writes `coverage.join("\n")`; splitting is this
   * function's job. Until that pipeline change lands the property is simply
   * absent, and absent reads the same as empty — which is why the card could be
   * built before it.
   */
  more: string[];
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * The scheme filter, applied at the render door.
 *
 * `url` itself has been validated in `worker/parse.ts` since the archive was the
 * boundary, and `more` is validated there too. This is the second lock on the
 * same door, and it is here rather than only there because these urls are
 * rendered as `href`s the reader clicks: `javascript:` and `data:` are the two
 * schemes that turn a link into code, and the cost of checking is one comparison
 * per row against a pipeline change that could reach the DOM before anyone reads
 * the diff.
 */
const isLinkable = (url: string) => /^https?:\/\//i.test(url);

/**
 * Read a tile feature's properties into a `PanelStory`, or `null`.
 *
 * **The field list here is the copyright constraint.** `worker/tiles.ts` also
 * publishes `salience`, `domains`, `tier1`, `region` and `country`; none of them
 * are read, `tier1` least of all — §2.3 says the preference is invisible, and a
 * badge is precisely what that forbids.
 *
 * `image` is read but never trusted to be present: it is "" for the 12.2% of
 * records GDELT has no sharing image for, and the panel has a designed state for
 * that rather than a broken one.
 *
 * `null` when there is no url, because the url is the story's identity
 * everywhere else in the client: it is the promoted feature id (`MapView.tsx`),
 * the spider's dedupe key, and the top-5 state key. A feature without one cannot
 * be selected, excluded from its own nearby list, or linked out to.
 */
export function panelStory(properties: unknown): PanelStory | null {
  if (!properties || typeof properties !== "object") return null;
  const source = properties as Record<string, unknown>;
  const url = text(source.url);
  if (!url) return null;

  return {
    title: text(source.title),
    source: text(source.source),
    url,
    place: text(source.place),
    kind: text(source.kind),
    date: text(source.date),
    image: text(source.image),
    more: text(source.more).split("\n").map(text).filter(isLinkable),
  };
}

/**
 * A coverage link's label: the url's host, without `www.`.
 *
 * **It says a domain, not a masthead** — `chron.com`, not "The Houston
 * Chronicle" — for the same reason `.panel__chip` does. A domain-to-publisher
 * lookup is §3.4's join-on-names trap wearing display clothing: it fails
 * silently and plausibly on exactly the outlets nobody checks.
 *
 * A url that `URL` cannot parse returns "", and the card drops the row rather
 * than printing a bare href. `panelStory` has already required `https?:`, so
 * this is only reachable for a host the parser rejects.
 */
export function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Display-only country shortenings for the card's place line.
 *
 * **Three entries, and it must stay about that size.** §3.4 is this project's
 * standing warning about joining on names, and a 250-row country table would be
 * exactly that trap wearing a display hat. These are here because GDELT's
 * FullName — and, for the third, Natural Earth's crosswalk name — spell them at a
 * length that wraps the line on a 390px phone, and because nothing joins on the
 * output: it is rendered and thrown away.
 *
 * The third row exists because the region panel's breadcrumb reads the crosswalk
 * rather than GDELT, and the two spell the same country differently.
 */
const SHORT_COUNTRY: Record<string, string> = {
  "United States": "USA",
  "United States of America": "USA",
  "United Kingdom": "UK",
};

/**
 * One country name, at display length. `SHORT_COUNTRY` with a miss returning the
 * input, exported so the breadcrumb in `lib/flag.ts` and the place line below it
 * cannot disagree about how a country is spelled two inches apart on the same
 * card.
 */
export function shortCountry(name: string): string {
  return SHORT_COUNTRY[name] ?? name;
}

/**
 * The card's place line: the whole place, with the country shortened, and
 * "Somewhere in" where the pipeline only knows the region.
 *
 * GDELT's FullName is `City, Admin-1, Country` for a city and `Admin-1, Country`
 * or bare `Country` above that. All of it is kept — "Anaheim, California, USA".
 *
 * **This replaced `placeHeading`, which kept only the two ends** ("Anaheim,
 * USA"). That function existed for the 34px heading printed across the hero, on
 * the argument that the reader infers the middle from the map in front of them.
 * Mode 2 deleted that heading: the place is now a 12px line inside a 288px
 * column, where all three parts fit comfortably, and at that size the admin-1 is
 * the part that distinguishes one Springfield from the next. The shortening
 * table survives the change because the reason for it — "United States" wrapping
 * a phone-width line — survives it too.
 *
 * **It also absorbed `placementLine`, and the half that mattered came with it.**
 * That function returned "…· placed automatically", and the card no longer says
 * that anywhere — "How does this work?" at its foot routes to /about, which
 * carries the rule, the measured accuracy and the interval rather than four
 * words. But the OTHER half of it was §2.1's distinction, and dropping that would
 * have been dropping an honesty feature by accident: a container was chosen
 * precisely because the story had no usable exact location, so it must not print
 * as though it had one. The hollow ring in `lib/layers.ts` makes the same claim
 * visually.
 *
 * What is deliberately NOT here is any grading of the pin. §5.2 decision 3 is
 * measured — mention count does not predict correctness, pooled n=73, 50.0%
 * against 70.9%, Fisher p=0.152 — so two stories differing only in salience or
 * domain count read identically, and a per-pin hedge would claim a signal the
 * audit says is not there.
 *
 * A one-part name is returned as it stands.
 */
export function placeLine(story: Pick<PanelStory, "place" | "kind">): string {
  const parts = text(story.place)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";

  const last = parts.length - 1;
  parts[last] = shortCountry(parts[last]);

  const place = parts.join(", ");
  return story.kind === "CONTAINER" ? `Somewhere in ${place}` : place;
}

/**
 * The story's age — "3 hours ago" — in `lib/age.ts`'s one voice.
 *
 * **Relative, not a clock (2026-08-14).** It rendered `19:34 UTC`, and before
 * that the reader's local time. A clock face is the wrong unit for this panel:
 * the reader's question is "is this current?", and answering it from `19:34 UTC`
 * costs them a subtraction against a timezone they may not be in. It also read
 * as a *byline time*, which it is not — see below.
 *
 * **This stamp is a bundle timestamp, not a publication time.** `date` is when
 * GDELT's crawler assembled the 15-minute bundle the article arrived in. The
 * relative form is materially more honest about that than the clock was: `19:34`
 * named a minute the pipeline does not know, where "3 hours ago" claims only a
 * magnitude, and the magnitude is right.
 *
 * That is also why this no longer rounds sub-hour ages up to "just now", as the
 * deleted `storyAge` did. The bundle is 15 minutes wide, so "30 minutes ago" is
 * accurate to within the bundle; what the pipeline cannot support is a specific
 * minute *of the clock*, and no relative label claims one.
 *
 * `now` is a parameter so this is a pure function of its inputs — the tests pass
 * a fixed instant rather than racing the wall clock.
 */
export function publishedAt(date: string, now: number = Date.now()): string {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(date ?? "");
  if (!match) return "";
  const [, year, month, day, hour, minute, second] = match.map(Number);

  return ago(Date.UTC(year, month - 1, day, hour, minute, second), now);
}
