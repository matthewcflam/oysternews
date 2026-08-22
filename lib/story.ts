/**
 * What a story panel says. Link-out only — title, source, link, never
 * article text. `PanelStory` is the whole content model the panel may
 * render, and `panelStory()` is the only door into it: it reads eight
 * named fields off a tile feature and drops everything else, so a
 * property that started carrying prose upstream cannot reach the DOM
 * (`story.test.ts` enforces this). The uniform "a rule placed this"
 * disclosure (no per-pin confidence grading) is measured, not a
 * preference: mention count does not predict placement correctness
 * (pooled n=73, 50.0% vs 70.9%, Fisher p=0.152). See
 * docs/DESIGN.md#panelstory-the-2-6-allowlist and #no-per-pin-confidence-signal.
 */

import { ago } from "./age";

/**
 * The only fields a story panel may read — the literal allowlist that
 * enforces link-out-only. Widening this list to make a test pass is the
 * failure mode. `image` is a pointer to the publisher's own CDN, the same
 * class of thing as `url`, not article text. See
 * docs/DESIGN.md#panelstory-the-2-6-allowlist.
 */
export type PanelStory = {
  title: string;
  /** The publishing domain. */
  source: string;
  url: string;
  /** GDELT's FullName for wherever the placement rule put the story. */
  place: string;
  kind: string;
  /** GKG stamp of the newest article in the group, YYYYMMDDHHMMSS, UTC. */
  date: string;
  /** The article's sharing image, or "" (~12% of records have none — panel draws its flat accent header). Validated in worker/parse.ts, not here: the archive is the boundary. */
  image: string;
  /**
   * Other outlets covering the SAME story — "More Reporting" on the card.
   * Empty for the ~87% of groups that are one article. A url list is more
   * link-out, same class of thing as `url` itself. `topic` deliberately did
   * NOT join this list — see docs/DESIGN.md#panelstory-the-2-6-allowlist.
   * Arrives as a delimited string (MVT properties are scalar); the tile
   * pipeline does not currently write it, so this is presently always "".
   */
  more: string[];
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// Scheme filter, applied at the render door as a second lock even though
// worker/parse.ts already validated url/more: these render as clickable
// hrefs, and javascript:/data: are the schemes that turn a link into code.
const isLinkable = (url: string) => /^https?:\/\//i.test(url);

/**
 * Read a tile feature's properties into a `PanelStory`, or `null`. The
 * field list is the copyright enforcement point — `worker/tiles.ts` also
 * publishes `salience`, `domains`, `tier1`, `region`, `country`, none of
 * which are read here. `null` on no url, since url is the story's identity
 * everywhere else in the client (feature id, spider dedupe key, top-5
 * state key).
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

// A coverage link's label: the url's host, without www. Says a domain, not
// a masthead (chron.com, not "The Houston Chronicle") — a domain-to-publisher
// lookup would be a join-on-names trap that fails silently on outlets
// nobody checks. Returns "" on an unparseable url, and the card drops that
// row rather than print a bare href.
export function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Display-only country shortenings for the card's place line. Deliberately
// tiny (3 entries) — a large name->abbreviation table would be a
// join-on-names trap wearing a display hat; nothing downstream joins on
// this output, it's rendered and thrown away. The third entry exists
// because the region panel's breadcrumb reads the FIPS crosswalk's name
// rather than GDELT's, and the two spell it differently.
const SHORT_COUNTRY: Record<string, string> = {
  "United States": "USA",
  "United States of America": "USA",
  "United Kingdom": "UK",
};

// One country name, at display length. Exported so lib/flag.ts's breadcrumb
// and this file's place line can't disagree about the spelling.
export function shortCountry(name: string): string {
  return SHORT_COUNTRY[name] ?? name;
}

/**
 * The card's place line: the whole place, country shortened, and "Somewhere
 * in" prefixed for a CONTAINER placement — a container was chosen because
 * the story had no usable exact location, and the line must not read as if
 * it had one (the hollow ring in lib/layers.ts makes the same claim
 * visually). Deliberately does NOT grade the pin by salience or domain
 * count — that signal is measured not to exist (pooled n=73, 50.0% vs
 * 70.9%, Fisher p=0.152). See docs/DESIGN.md#no-per-pin-confidence-signal.
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
 * The story's age — "3 hours ago" — via lib/age.ts. Relative, not a clock:
 * `date` is when GDELT assembled the 15-minute bundle the article arrived
 * in, not a publication time, so a specific clock minute would overclaim
 * precision the pipeline doesn't have; a relative label only claims a
 * magnitude, which is accurate. `now` is a parameter for pure testability.
 */
export function publishedAt(date: string, now: number = Date.now()): string {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(date ?? "");
  if (!match) return "";
  const [, year, month, day, hour, minute, second] = match.map(Number);

  return ago(Date.UTC(year, month - 1, day, hour, minute, second), now);
}
