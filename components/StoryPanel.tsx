"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import MapTilerLogo from "./MapTilerLogo";
import PanelTab from "./PanelTab";
import { loadOgImage } from "@/lib/og";
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
 * can be checked by reading one short file. The one exception is the thumbnail —
 * it is fetched here because it is keyed by the story on screen and by nothing
 * else, and threading it through the map effect would put a network call in the
 * middle of a click handler.
 *
 * **§2.6 is enforced by `PanelStory`, not by care.** Title, source, url, place,
 * kind and date. There is no article text to render because there is no field for
 * it, and `panelStory()` is the only constructor — see `lib/story.ts`.
 */

export type StoryPanelProps = {
  story: PanelStory;
  /** Neighbours from the radius query. Empty is a normal answer — see `lib/nearby.ts`. */
  nearby: PanelStory[];
  /** Swap the panel to a neighbour without going back to the map. */
  onSelect: (story: PanelStory) => void;
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
  onSelect,
  onClose,
  collapsed,
  onToggleCollapse,
}: StoryPanelProps) {
  /**
   * `undefined` while the lookup is in flight, `null` once it has come back with
   * nothing. The two are distinct so the header does not flash the fallback
   * before settling on the image.
   */
  const [image, setImage] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setImage(undefined);
    loadOgImage(story.url).then((found) => {
      if (!cancelled) setImage(found ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [story.url]);

  /**
   * The smallest image worth showing, in natural pixels.
   *
   * **Not a guess — measured.** A container story out of Kazakhstan declared its
   * `og:image` as `globenewswire.com/newsroom/ti?nf=...`, which is a 1x1 tracking
   * beacon. It loads successfully, so `onError` never fires; it just paints one
   * stretched pixel across the hero. Worse, rendering it makes the reader's
   * browser hit a beacon on their behalf, which is not a thing a thumbnail should
   * do. A real preview image is 600-1200px wide, so anything under 200 is either
   * a beacon or a favicon and neither belongs in the hero.
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
             * through Vercel, which is the one thing the /api/og route is careful
             * not to do. `onError` falls back to the flat header — a hotlinked
             * image can 403 or vanish, and a broken-image icon is worse than none.
             *
             * eslint-disable-next-line @next/next/no-img-element
             */
            <img
              className="panel__image"
              src={image}
              alt=""
              onError={() => setImage(null)}
              onLoad={(event) => {
                const loaded = event.currentTarget;
                if (loaded.naturalWidth < MIN_IMAGE_WIDTH) setImage(null);
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
                    <button type="button" onClick={() => onSelect(other)}>
                      {other.title}
                    </button>
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

        **"How this works"** came off the masthead when the masthead was deleted.
        It is inside the panel, so it is only reachable with a story open — the
        accepted cost of giving the map back its top-left corner. `next/link`
        rather than an anchor: /about is a route in this app, and a full document
        load would discard the map and every tile it has cached.

        `RegionPanel` renders this same footer, because both are the panel and
        both cover the same corner. The stylesheet makes it sticky so the logo
        survives a list too long to fit — see `.panel__footer`.
      */}
        <footer className="panel__footer">
          <MapTilerLogo className="maptiler-logo--panel" />
          <Link className="panel__about" href="/about">
            How does this work?
          </Link>
        </footer>
      </div>

      <PanelTab collapsed={collapsed} onToggle={onToggleCollapse} />
    </aside>
  );
}
