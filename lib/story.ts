/**
 * What a story panel says (HANDOFF.md §2.6, §5.2 decision 3).
 *
 * **This file replaces `lib/popup.ts` and inherits its job.** The map popup is
 * gone — a click now opens the left panel — but the constraint the popup existed
 * to enforce is not, and it must not evaporate with the surface it guarded.
 *
 * 1. **§2.6 is link-out only** — title, source, link, never article text.
 *    `PanelStory` is the whole of what the panel may render, and `panelStory()`
 *    is the only door into it: it reads five named fields off a tile feature and
 *    drops everything else, so a property that started carrying prose upstream
 *    cannot reach the DOM. §7 critical gap 2 asked for that to be a test rather
 *    than a review note; `story.test.ts` is that test.
 * 2. **§5.2 decision 3: the geotag-confidence treatment, pin half.** The panel
 *    names the place the rule picked and says it was picked automatically. The
 *    measurement behind that choice — mention count does not predict correctness,
 *    pooled n=73, 50.0% against 70.9%, Fisher p=0.152 — is unchanged by the move,
 *    so the treatment stays uniform and `placementLine` still refuses to grade a
 *    pin by salience or domain count.
 *
 * The one thing the panel adds over the popup is a *heading*: the mock puts the
 * place at the top, over the image, as the panel's subject. `placeHeading` is
 * that, and it is display-only — see the note on `SHORT_COUNTRY`.
 */

import { ago } from "./age";

/**
 * The only fields a story panel may read. There is no field for article text.
 *
 * `image` is deliberately absent: the thumbnail is not story content, it is
 * fetched separately by `lib/og.ts` and keyed by url. Keeping it out of this type
 * means the §2.6 assertion below stays an assertion about the *story*.
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
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Read a tile feature's properties into a `PanelStory`, or `null`.
 *
 * **The field list here is the copyright constraint.** `worker/tiles.ts` also
 * publishes `salience`, `domains`, `tier1`, `region` and `country`; none of them
 * are read, `tier1` least of all — §2.3 says the preference is invisible, and a
 * badge is precisely what that forbids.
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
  };
}

/**
 * Display-only country shortenings for the panel heading.
 *
 * **Two entries, and it must stay about that size.** §3.4 is this project's
 * standing warning about joining on names, and a 250-row country table would be
 * exactly that trap wearing a display hat. These two are here because GDELT's
 * FullName spells them at a length that wraps the heading on a 390px phone, and
 * because nothing joins on the output — it is rendered and thrown away.
 */
const SHORT_COUNTRY: Record<string, string> = {
  "United States": "USA",
  "United Kingdom": "UK",
};

/**
 * The panel's heading: the place, shortened to its two ends.
 *
 * GDELT's FullName is `City, Admin-1, Country` for a city and `Admin-1, Country`
 * or bare `Country` above that. The middle is what a reader already infers from
 * the map they are looking at, so the heading keeps the first part and the last —
 * "Anaheim, California, United States" reads "Anaheim, USA".
 *
 * A one-part name is returned as it stands. There is nothing to trim, and
 * duplicating it ("France, France") would be worse than leaving it.
 */
export function placeHeading(place: string): string {
  const parts = place
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";

  const last = SHORT_COUNTRY[parts[parts.length - 1]] ?? parts[parts.length - 1];
  if (parts.length === 1) return last;
  return `${parts[0]}, ${last}`;
}

/**
 * The placement line — carried over from the popup unchanged.
 *
 * A container says "somewhere in", because that is exactly what §2.1 chose it
 * for: the story had no usable exact location. A pin names the point. Both say
 * the choice was automatic — the accuracy is a property of the rule, and the
 * measurement in this file's header says it is not a property of the individual
 * pin.
 */
export function placementLine(story: Pick<PanelStory, "place" | "kind">): string {
  const place = text(story.place);
  if (!place) return "";
  const where = story.kind === "CONTAINER" ? `Somewhere in ${place}` : place;
  return `${where} · placed automatically`;
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
