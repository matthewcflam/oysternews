"use client";

import Link from "next/link";
import { useState } from "react";
import { linkLabel, placeLine, publishedAt, type PanelStory } from "@/lib/story";


/**
 * The story panel: what a click on a pin opens.
 *
 * **This replaces the map popup.** The popup was a 280px box anchored to a dot,
 * which is the wrong shape for a headline, a place, a timestamp and a list of
 * neighbours; the panel is the same slot §2.3's region panel already uses, so
 * only one of the two is ever open.
 *
 * **Mode 2 (2026-08-16) made it a floating card**, 324x489, against the note in
 * `globals.css` that said full-bleed and gave reasons. Those reasons are answered
 * rather than ignored — a fixed height and a soft shadow, see `.panel` — and the
 * content changed with the shape:
 *
 * - the headline **stops being the link**; a *Read The Story* button takes that
 *   job, so there is one primary action and it is drawn as one;
 * - source and age **merge into one italic line**, because they answer one
 *   question between them;
 * - "Stories Nearby" becomes **"More Reporting"** — other outlets covering *this*
 *   story rather than other stories near this one. The first was a geographic
 *   accident of what the map had rendered; the second is a fact about the story;
 * - the placement disclosure moves to **"How does this work?"** at the foot. It
 *   is not dropped — see `lib/story.ts`.
 *
 * **Presentational only**, for the same reason `RegionPanel` is: the gesture, the
 * selection and the outline all live in `MapView.tsx`, so the §2.6 constraint
 * can be checked by reading one short file. **It has no exceptions as of
 * 2026-08-14** — the thumbnail used to be fetched here, from `/api/og`, and that
 * was the one network call in the component. GDELT carries the publisher's
 * `og:image` (`V2.1SHARINGIMAGE`), so it now rides the tile feature like every
 * other field and this component fetches nothing at all.
 *
 * **§2.6 is enforced by `PanelStory`, not by care.** Title, source, url, place,
 * kind, date, image and the coverage links. There is no article text to render
 * because there is no field for it, and `panelStory()` is the only constructor —
 * see `lib/story.ts`, which explains why each of the eight is on that list.
 */

export type StoryPanelProps = {
  story: PanelStory;
  onClose: () => void;
};

export default function StoryPanel({ story, onClose }: StoryPanelProps) {
  /**
   * **The thumbnail arrives on the tile feature now (2026-08-14), so there is no
   * lookup to be in flight.** It used to be an async fetch of `/api/og`, which
   * read the article page server-side; GDELT already carries the publisher's
   * `og:image` in `V2.1SHARINGIMAGE`, so the pipeline carries it too and this
   * component just reads `story.image`.
   *
   * That deleted the three-state `undefined | null | string` this held. What is
   * left is the one thing the browser can still discover at render time: the
   * image was published and then turned out to be unusable — a 404, or a
   * tracking pixel wearing a thumbnail's clothes.
   *
   * **The rejection is stored as the url it applies to, not as a boolean**, for
   * the same reason `lib/flag.ts` stores failures rather than successes: a
   * boolean has to be cleared by an effect, and an effect runs *after* the
   * render that already used the stale value — so switching from a rejected
   * story to a good one flashed the flat header for a frame. Comparing urls
   * needs no effect and cannot be stale.
   */
  const [rejectedUrl, setRejectedUrl] = useState("");
  const image = rejectedUrl === story.url ? "" : story.image;

  /**
   * The smallest image worth showing, in natural pixels.
   *
   * **Not a guess — measured.** A container story out of Kazakhstan declared its
   * sharing image as `globenewswire.com/newsroom/ti?nf=...`, which is a 1x1
   * tracking beacon. It loads successfully, so `onError` never fires; it just
   * paints one stretched pixel across the hero. Worse, rendering it makes the
   * reader's browser hit a beacon on their behalf, which is not a thing a
   * thumbnail should do. A real preview image is 600-1200px wide, so anything
   * under 200 is either a beacon or a favicon and neither belongs in the hero.
   *
   * **This check survived the move to GDELT and had to.** The field is the same
   * `og:image` either way, so it carries the same beacons; changing where the
   * project reads it changed nothing about what publishers put there.
   */
  const MIN_IMAGE_WIDTH = 200;

  /**
   * One clock reading for the whole panel, not one per row. Every age on screen
   * is then measured from the same instant — rows rendered either side of a
   * minute boundary would otherwise disagree with each other about how long ago
   * "now" was.
   */
  const now = Date.now();
  const time = publishedAt(story.date, now);

  /**
   * `yahoo.com · 3 hours ago`, or whichever half exists.
   *
   * Both halves are routinely present and neither is guaranteed: `source` is ""
   * for a feature with no domain and `publishedAt` returns "" for a stamp it
   * cannot parse. Joining the survivors is what stops a dangling separator with
   * nothing on one side of it.
   */
  const byline = [story.source, time].filter(Boolean).join(" · ");

  /** "Anaheim, California, USA", or "Somewhere in Texas, USA" — see `placeLine`. */
  const place = placeLine(story);

  /**
   * The coverage links, labelled and de-duplicated by label.
   *
   * The worker already emits one url per distinct domain, so this changes nothing
   * on well-formed data — it is here because the card renders the *label*, and
   * two rows reading `chron.com` twice would look like a bug in the card rather
   * than a change upstream. A url whose host will not parse is dropped rather
   * than printed as a bare href.
   */
  const coverage: { url: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const url of story.more) {
    const label = linkLabel(url);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    coverage.push({ url, label });
  }

  return (
    <aside className="panel" aria-label={story.title || "Story"}>
      {/* `.panel` positions and carries the shadow; this element clips to the
          card's radius. One element cannot both overflow and clip. */}
      <div className="panel__scroll">
        <header className={`panel__hero${image ? " panel__hero--image" : ""}`}>
          {image && (
            /*
             * The publisher's own CDN serves this, so it is a plain <img> rather
             * than next/image: optimizing it would mean proxying their bytes
             * through Vercel, and the point of taking the URL from GDELT was to
             * stop this project touching the publisher's server at all. `onError`
             * falls back to the flat header — a hotlinked image can 403 or
             * vanish, and a broken-image icon is worse than none. That matters
             * slightly more now: the URL was current when GDELT crawled the page,
             * not necessarily when the reader opens the panel.
             *
             * eslint-disable-next-line @next/next/no-img-element
             */
            <img
              className="panel__image"
              src={image}
              alt=""
              onError={() => setRejectedUrl(story.url)}
              onLoad={(event) => {
                const loaded = event.currentTarget;
                if (loaded.naturalWidth < MIN_IMAGE_WIDTH) setRejectedUrl(story.url);
              }}
              referrerPolicy="no-referrer"
            />
          )}
          {/*
            **The mockup draws no ×, and shipping without one would be a trap.**
            A card with no dismissal is a card the reader cannot put down. There
            are three ways out and none of them costs visual weight: Escape and a
            click on the map background are both handled in `MapView`, and this is
            the one that is visible to somebody who does not know either.
          */}
          <button type="button" className="panel__close" onClick={onClose} aria-label="Close panel">
            ×
          </button>
        </header>

        <div className="panel__body">
          {byline && <p className="panel__byline">{byline}</p>}

          {/*
            An `h2`, not an `a` — see `.panel__title`. §2.6 is unchanged by that:
            the card still links out and only links out, it just does it from the
            button below rather than from the headline.
          */}
          <h2 className="panel__title">{story.title}</h2>

          {place && (
            <p className="panel__where">
              <span className="panel__sphere" aria-hidden="true" />
              {place}
            </p>
          )}

          {/* §2.6: link-out only. Title, source, link — never article text. */}
          <a
            className="panel__cta"
            href={story.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Read The Story
          </a>
        </div>

        {/*
          **Omitted entirely when there is nothing to put in it**, which is the
          common case rather than the degraded one: 87.2% of groups are a single
          article and carry no coverage at all (measured — see the theme audit).
          An empty "More Reporting" heading over a blank space would read as a
          failed fetch on nine cards out of ten.
        */}
        {coverage.length > 0 && (
          <section className="panel__more" aria-label="More reporting">
            <h3>More Reporting</h3>
            <ul>
              {coverage.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/*
          §5.2 decision 3's route out of the card. The placement disclosure used
          to be a line under the headline; /about carries the rule, the measured
          accuracy and the interval, which is more than the line ever said, and
          the card gets its place line back as a place rather than a hedge.

          `next/link` because this is the one in-app navigation the card has —
          /about is a route in this project, not somebody else's site, and it is
          the only anchor here that is not `target="_blank"`.
        */}
        <footer className="panel__footer panel__footer--about">
          <Link className="panel__about" href="/about">
            How does this work?
          </Link>
        </footer>
      </div>
    </aside>
  );
}
