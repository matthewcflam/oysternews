"use client";

import { useState } from "react";
import { countryName, flagUrl } from "@/lib/flag";
import { placeLine, publishedAt } from "@/lib/story";
import type { RegionEntry } from "@/lib/types";

/**
 * §2.3's region panel: the top stories of the country or state whose label was
 * clicked.
 *
 * **Mode 3 (2026-08-16) gave it its own content inside the shared card.** It had
 * worn the story panel's clothes since 2026-08-14 — same hero, same list — which
 * was the right call while the two were the same shape, and stopped being right
 * the moment the mockup made them different shapes. What they still share is the
 * shell: `.panel` positions, sizes and fills both, so §2.3's one slot still reads
 * as one slot.
 *
 * What changed, and why:
 *
 * - **The hero is gone.** A flag stretched across 190px of card was the loudest
 *   thing on screen — a national flag is designed to be maximally saturated — and
 *   it was 190px spent on a picture the reader already knows. It is now a small
 *   plate beside the heading, which is the size at which it does its actual job:
 *   confirming which country you clicked.
 * - **A breadcrumb above the name**, `World › India` or `World › USA ›
 *   California`. The panel is a place in a hierarchy and now says so; see
 *   `countryName` for why the parent is a prefix of the id rather than a join.
 * - **The rows are restacked**: place, then headline, then source and age. The
 *   headline is the thing being scanned, so it is the biggest thing in the row
 *   and the two lines around it are captions. The publisher lost its orange pill
 *   — nine pills down a 324px column read as the loudest thing in the panel — and
 *   keeps the accent as one small disc between it and the timestamp.
 * - **No MapTiler logo in the footer.** The card ends ~200px above the
 *   bottom-left corner, so the map's own copy is visible past it; the story card
 *   dropped its second copy on the same measurement (§2.6). There is no footer
 *   here at all now.
 * - **No orange disc in the corner.** It was the map's pin restated on a hero
 *   that no longer exists.
 *
 * **The counts and the zoom are real as of the same day.** `248 stories today ·
 * 39 sources` comes from `RegionEntry`, counted over the whole pool by
 * `worker/regions.ts` before the top-N cap — the rows on screen cannot produce
 * it, since 68 of 163 regions exceed the cap and the largest holds 977. `Zoom to
 * India ›` fits `public/region-bbox.json`, built from the same Natural Earth
 * features the click-outline is.
 *
 * **Both degrade to absent rather than to a wrong number.** An index published
 * before 2026-08-16 has no counts, so `total` is 0 and the line is not drawn; a
 * region the boundary set has no polygon for gets no button. Neither prints a
 * zero, and neither is a failure state worth telling the reader about.
 *
 * **Still not drawn, because the data still does not exist:** the topic chips
 * (blocked on the chip-set decision — Sports and Tech cannot be built from
 * GDELT) and `See all 248 stories` (blocked on the full-list shards). Nothing
 * here is stubbed for them.
 *
 * **Presentational only.** It is handed rows and renders them; the gesture, the
 * outline and the fetch all live in `MapView.tsx`. That split is what lets the
 * §2.6 constraint be checked by reading one short file.
 *
 * **§2.6 is enforced by the type, not by care.** `RegionStory` is title, source,
 * url, date and place — there is no article text to render, because there is no
 * field for it. Nothing here reads salience or tier-1 either: §2.3 says the
 * preference is invisible, so a badge would need a field the row does not carry.
 *
 * The ordering is `compareGroups`, applied by the worker. **The panel does not
 * re-rank** — one content model (§2.3).
 */

export type RegionPanelProps = {
  /** The label's own text, for the heading. Display only — nothing joins on it. */
  name: string;
  /** FIPS region id the outline is drawn from, shown when the name is missing. */
  regionId: string;
  /** Rows plus the two pool counts — already normalised by `entryFor`. */
  entry: RegionEntry;
  /** `unavailable` covers both "this manifest predates the index" and a failed fetch. */
  status: "loading" | "ready" | "unavailable";
  /** `null` when the boundary set has no box for this id — the button is then absent. */
  onZoom: (() => void) | null;
  onClose: () => void;
};

export default function RegionPanel({
  name,
  regionId,
  entry,
  status,
  onZoom,
  onClose,
}: RegionPanelProps) {
  const { stories, total, sources } = entry;
  /**
   * The flag, or `null` for "draw the heading without one".
   *
   * **The state is the URL that FAILED, not the URL to show.** `flagUrl` knows
   * the code maps to an ISO country; it cannot know flagcdn has an image for it,
   * so a failed load still has to fall back — the story panel does the same with
   * a hotlinked `og:image`, and for the same reason (a broken-image icon is worse
   * than no image). Storing the failure rather than the value is what makes that
   * survive the panel staying mounted as the reader clicks from one country to
   * the next: the URL is derived fresh every render, so a new region cannot
   * inherit the previous one's flag for a frame, and does not need an effect to
   * clear it.
   */
  const url = flagUrl(regionId);
  const [failed, setFailed] = useState<string | null>(null);
  const flag = url && url !== failed ? url : null;

  const heading = name || regionId;

  /**
   * `World › India`, or `World › USA › California`.
   *
   * The parent crumb is only drawn for an admin-1 — a country's own crumb IS the
   * heading, and `World › India › India` says nothing twice. `flagUrl` uses the
   * same length test for the same reason: two characters is a country and four
   * is a subdivision, which is exactly how `boundaries.pmtiles` distinguishes
   * them.
   *
   * Filtered rather than conditionally assembled, because `countryName` returns
   * "" for a code the crosswalk does not carry and a missing crumb has to
   * disappear rather than render as a gap between two separators.
   */
  const parent = regionId.trim().length === 2 ? "" : countryName(regionId);
  const trail = ["World", parent, heading].filter(Boolean);

  /**
   * `248 stories today · 39 sources`, or "" when there is nothing honest to say.
   *
   * **"today" is the window, and it is the pipeline's own word.** The pool is a
   * rolling 24 hours (§2.4), which is what every other relative stamp on this
   * card is measured against.
   *
   * `total` of 0 means the index predates the counts (see `entryFor`), NOT a
   * region with no news — that case has no rows either and gets the empty-state
   * note below. `sources` is dropped on its own if it is missing, so a partial
   * entry degrades to the half it can support rather than to nothing.
   */
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
