"use client";

import { useState } from "react";
import MapTilerLogo from "./MapTilerLogo";
import PanelTab from "./PanelTab";
import { placeHeading, placementLine, publishedAt, type PanelStory } from "@/lib/story";

/**
 * The story panel: what a click on a pin opens.
 *
 * **This replaces the map popup.** The popup was a 280px box anchored to a dot,
 * which is the wrong shape for a headline, a place, a timestamp and a list of
 * neighbours; the panel is the same slot §2.3's region panel already uses, so
 * only one of the two is ever open.
 *
 * **Presentational only**, for the same reason `RegionPanel` is: the gesture, the
 * radius query and the outline all live in `MapView.tsx`, so the §2.6 constraint
 * can be checked by reading one short file. **It has no exceptions as of
 * 2026-08-14** — the thumbnail used to be fetched here, from `/api/og`, and that
 * was the one network call in the component. GDELT carries the publisher's
 * `og:image` (`V2.1SHARINGIMAGE`), so it now rides the tile feature like every
 * other field and this component fetches nothing at all.
 *
 * **§2.6 is enforced by `PanelStory`, not by care.** Title, source, url, place,
 * kind, date and image. There is no article text to render because there is no
 * field for it, and `panelStory()` is the only constructor — see `lib/story.ts`,
 * which explains why `image` is on that list and why it is not article content.
 */

export type StoryPanelProps = {
  story: PanelStory;
  /** Neighbours from the radius query. Empty is a normal answer — see `lib/nearby.ts`. */
  nearby: PanelStory[];
  onClose: () => void;
  /**
   * Slid off the left edge, still selected. Owned by `MapView` rather than by
   * this component because the same tab has to survive swapping to `RegionPanel`
   * — see the note there.
   */
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export default function StoryPanel({
  story,
  nearby,
  onClose,
  collapsed,
  onToggleCollapse,
}: StoryPanelProps) {
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

  const heading = placeHeading(story.place);
  const placement = placementLine(story);
  /**
   * One clock reading for the whole panel, not one per row. Every age on screen
   * is then measured from the same instant — rows rendered either side of a
   * minute boundary would otherwise disagree with each other about how long ago
   * "now" was.
   */
  const now = Date.now();
  const time = publishedAt(story.date, now);

  return (
    <aside
      className={`panel${collapsed ? " panel--collapsed" : ""}`}
      aria-label={story.title || "Story"}
    >
      {/*
        `.panel` positions and slides; this element holds and scrolls. The split
        is what lets the tab hang off the right edge — `overflow-y: auto` clips
        both axes, so on one element the tab was invisible.
      */}
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
          <span className="panel__dot" aria-hidden="true" />
          <button type="button" className="panel__close" onClick={onClose} aria-label="Close panel">
            ×
          </button>
          {heading && <h2 className="panel__place">{heading}</h2>}
        </header>

        <div className="panel__body">
          {/* §2.6: link-out only. Title, source, link — never article text. */}
          <a className="panel__title" href={story.url} target="_blank" rel="noopener noreferrer">
            {story.title}
          </a>
          {time && <p className="panel__time">{time}</p>}
          <a className="panel__source" href={story.url} target="_blank" rel="noopener noreferrer">
            {story.source}
          </a>
          {/*
          §5.2 decision 3, the pin half: the panel names the place the rule picked
          and says it was picked automatically. Uniform by measurement — there is
          no per-pin signal to grade on (lib/story.ts has the table).
        */}
          {placement && <p className="panel__placement">{placement}</p>}
        </div>

        <section className="panel__list" aria-label="Stories nearby">
          <h3>Stories Nearby</h3>

          {nearby.length === 0 ? (
            // A normal answer, not an error. §2.4's budget thins features at low
            // zoom, so a quiet part of the world genuinely has no neighbours drawn.
            <p className="panel__note">Nothing else nearby on the map right now.</p>
          ) : (
            <ul>
              {nearby.map((other) => {
                const age = publishedAt(other.date, now);
                return (
                  <li key={other.url}>
                    {/*
                      Publisher and age above the headline. Both come off the
                      story itself — §2.6's five fields already carry them — so
                      this adds no data, only surfaces what a reader previously
                      had to click through to find.
                    */}
                    <p className="panel__meta">
                      {other.source && <span className="panel__chip">{other.source}</span>}
                      {age && <span className="panel__stamp">{age}</span>}
                    </p>
                    {/*
                      §2.6: link-out only, and as of 2026-08-14 that is what a
                      neighbour click DOES. It used to swap the panel to this
                      story, which made the list a browsing surface that always
                      ended in a second click on the same headline. Going
                      straight to the publisher is the one thing this project can
                      actually give a reader, so the row does it in one gesture —
                      the same anchor `RegionPanel` has always used.
                    */}
                    <a href={other.url} target="_blank" rel="noopener noreferrer">
                      {other.title}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/*
        The panel's footer, and the home of two things that used to live on the
        map itself.

        **The MapTiler logo** is here because this panel is full-bleed and covers
        the map's own bottom-left copy (§2.6 — the Free plan requires the mark,
        and it fails silently when hidden). Same component, so the two cannot
        drift.

        **"How this works" has moved out again (2026-08-14)**, to "About Us" in
        the brand block over the map's top-right corner. It lived here only
        because the deleted masthead left it homeless, and the cost was that
        §5.2 decision 3's measured accuracy was reachable *only with a story
        open*. The new chrome is always on screen, so that trade is repaid and
        the footer goes back to carrying one thing.

        `RegionPanel` renders this same footer, because both are the panel and
        both cover the same corner. The stylesheet makes it sticky so the logo
        survives a list too long to fit — see `.panel__footer`.
      */}
        <footer className="panel__footer">
          <MapTilerLogo className="maptiler-logo--panel" />
        </footer>
      </div>

      <PanelTab collapsed={collapsed} onToggle={onToggleCollapse} />
    </aside>
  );
}
