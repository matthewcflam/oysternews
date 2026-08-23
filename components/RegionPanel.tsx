"use client";

import { useState } from "react";
import { countryName, flagUrl } from "@/lib/flag";
import { placeLine, publishedAt } from "@/lib/story";
import type { RegionEntry } from "@/lib/types";

/**
 * The region panel: top stories of the country, state, city, or continent
 * whose label was clicked. Presentational only — the gesture, outline,
 * and fetch all live in `MapView.tsx`. The counts (`248 stories today ·
 * 39 sources`) and the zoom button are real, computed over the whole pool
 * before the top-N cap, and both degrade to absent rather than a wrong
 * number when data predates them. Topic chips and "See all N stories"
 * are still not drawn, since the underlying data doesn't exist yet.
 * Link-out enforced by the type — `RegionStory` has no field for article
 * text, salience, or tier-1. The panel does not re-rank; ordering is
 * `compareGroups`, applied by the worker. See docs/DESIGN.md#regions.
 */

export type RegionPanelProps = {
  /** The label's own text, for the heading. Display only — nothing joins on it. */
  name: string;
  /** FIPS region id the outline is drawn from, shown when the name is missing. `""` for a city — a city draws no outline and has no id of its own. */
  regionId: string;
  /** Rows plus the two pool counts — already normalised by `entryFor` (or already shaped like a `RegionEntry` for a city). */
  entry: RegionEntry;
  /** `unavailable` covers both "this manifest predates the index" and a failed fetch. */
  status: "loading" | "ready" | "unavailable";
  /** `null` when the boundary set has no box for this id — the button is then absent. */
  onZoom: (() => void) | null;
  onClose: () => void;
  /**
   * The flag is drawn from this code rather than from `regionId` when given —
   * a city has no `regionId` of its own but shows its country's flag. Falls
   * back to `regionId`, which is exactly today's behaviour for a country or a
   * state.
   */
  flagCode?: string;
  /**
   * Caller-built breadcrumb between "World" and the heading — `["USA",
   * "Illinois"]` for a city, `[]` for a continent. Omitted (not just empty)
   * falls back to today's derivation from `regionId`'s length, which is what
   * a country or a state click still passes.
   */
  trail?: string[];
};

export default function RegionPanel({
  name,
  regionId,
  entry,
  status,
  onZoom,
  onClose,
  flagCode,
  trail: trailOverride,
}: RegionPanelProps) {
  const { stories, total, sources } = entry;
  // The flag, or null for "draw the heading without one". State holds the
  // URL that FAILED, not the URL to show — flagUrl can't know flagcdn has
  // an image, so a failed load still needs a fallback. Deriving the URL
  // fresh every render means a new region can't inherit the previous
  // one's flag for a frame, with no effect needed to clear it.
  const url = flagUrl(flagCode ?? regionId);
  const [failed, setFailed] = useState<string | null>(null);
  const flag = url && url !== failed ? url : null;

  const heading = name || regionId;

  // "World › India", "World › USA › California", or with trailOverride
  // "World › USA › Illinois › Chicago" (city) / "World › Europe"
  // (continent). The parent crumb only draws for an admin-1 — a
  // country's own crumb IS the heading, and "World › India › India" says
  // nothing twice. Filtered, not conditionally assembled, since
  // countryName returns "" for an uncarried code and a missing crumb must
  // disappear rather than leave a gap between separators.
  const parent = regionId.trim().length === 2 ? "" : countryName(regionId);
  const middle = trailOverride ?? [parent];
  const trail = ["World", ...middle, heading].filter(Boolean);

  // "248 stories today · 39 sources", or "" when there's nothing honest
  // to say. total of 0 means the index predates the counts (see
  // entryFor), NOT a region with no news — that case has no rows either
  // and gets the empty-state note below.
  const counts =
    total > 0
      ? [
          `${total} ${total === 1 ? "story" : "stories"} today`,
          sources > 0 ? `${sources} ${sources === 1 ? "source" : "sources"}` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

  /** One clock reading for every row — see the same note in `StoryPanel`. */
  const now = Date.now();

  return (
    <aside className="panel panel--bounded" aria-label={`Top stories in ${heading}`}>
      {/* `.panel` positions and carries the shadow; this element clips to the
          card's radius. One element cannot both overflow and clip. */}
      <div className="panel__scroll">
        <header className="panel__head">
          <div className="panel__ident">
            {/*
              An ordered trail, but not a list of links: only the last crumb is a
              place the reader is at, and the other two are places this app has
              no route to. Printing them as links would promise a navigation that
              does not exist — "World" is the map with nothing selected, which is
              already one Escape away.
            */}
            <p className="panel__crumbs">
              {trail.map((crumb, at) => (
                <span key={crumb} className={at === trail.length - 1 ? "panel__crumb--here" : undefined}>
                  {at > 0 && <span className="panel__crumb-sep" aria-hidden="true">›</span>}
                  {crumb}
                </span>
              ))}
            </p>
            <h2 className="panel__region">{heading}</h2>
            {counts && <p className="panel__counts">{counts}</p>}
          </div>

          {flag && (
            /*
             * A plain <img>, not next/image, for the same reason the story panel's
             * thumbnail is: this is a third party's URL, and routing it through
             * Vercel's optimizer would proxy their bytes on every view.
             *
             * eslint-disable-next-line @next/next/no-img-element
             */
            <img
              className="panel__flag"
              src={flag}
              alt=""
              onError={() => setFailed(flag)}
              referrerPolicy="no-referrer"
            />
          )}

          {/*
            **The mockup draws no ×, and shipping without one would be a trap** —
            the same argument the story card makes. Escape and a click on the map
            background are both handled in `MapView`; this is the one that is
            visible to somebody who knows neither.
          */}
          <button type="button" className="panel__close" onClick={onClose} aria-label="Close panel">
            ×
          </button>
        </header>

        <section className="panel__list" aria-label={`Top stories in ${heading}`}>
          {status === "loading" && <p className="panel__note">Loading stories…</p>}

          {status === "unavailable" && (
            // Not an error notice: the map is fine and the rest of it still works.
            // A manifest published before 2026-08-13 carries no regionsUrl at all.
            <p className="panel__note">Story list unavailable for this run.</p>
          )}

          {status === "ready" && stories.length === 0 && (
            // A normal answer. 124 of ~250 countries had any news in a 24-hour
            // window (§2.4), and the boundaries archive draws every one of them.
            <p className="panel__note">No stories here in the last 24 hours.</p>
          )}

          {status === "ready" && stories.length > 0 && (
            /*
             * An `ol`. This list IS ranked — `compareGroups` decided the order and
             * the panel does not re-rank. The markers are off in CSS; the element
             * is what says so to a screen reader.
             */
            <ol>
              {stories.map((story) => {
                const age = publishedAt(story.date, now);
                /*
                 * The same line the story card prints, from the same function, so
                 * a place reads identically whichever surface shows it. `kind` is
                 * "" because the region index carries no such field — a row here
                 * is always a placed story, never a container.
                 */
                const where = placeLine({ place: story.place, kind: "" });
                return (
                  <li key={story.url}>
                    {where && <p className="panel__row-place">{where}</p>}
                    {/* §2.6: link-out only. Title, source, link — never article text. */}
                    <a href={story.url} target="_blank" rel="noopener noreferrer">
                      {story.title}
                    </a>
                    <p className="panel__meta">
                      {story.source && <span className="panel__source">{story.source}</span>}
                      {story.source && age && <span className="panel__bullet" aria-hidden="true" />}
                      {age && <span className="panel__stamp">{age}</span>}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/*
          The mockup's footer carries two actions. Only one of them has data —
          "See all N stories" needs the full-list shards, which are not built —
          so the row holds the one that works rather than a live control beside a
          dead one. `justify-content: flex-end` in the CSS is what keeps it on
          the right, where the mockup draws it, without a placeholder to balance
          against.

          A `button`, not an `a`: it moves this page's camera. Nothing is
          navigated to and there is no URL for where the map ends up, so an
          anchor would be a link shape over a non-link action.
        */}
        {onZoom && (
          <footer className="panel__footer panel__footer--zoom">
            <button type="button" className="panel__zoom" onClick={onZoom}>
              Zoom to {heading} <span aria-hidden="true">›</span>
            </button>
          </footer>
        )}
      </div>
    </aside>
  );
}
