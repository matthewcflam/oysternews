"use client";

import { useState } from "react";
import MapTilerLogo from "./MapTilerLogo";
import PanelTab from "./PanelTab";
import { flagUrl } from "@/lib/flag";
import { publishedAt } from "@/lib/story";
import type { RegionStory } from "@/lib/types";

/**
 * §2.3's region panel: the top stories of the country or state whose label was
 * clicked.
 *
 * **This is the story panel, wearing the same clothes** (2026-08-14). It used to
 * be a dark floating card with a border and rounded corners, which made the one
 * slot §2.3 allows look like two different features depending on what you had
 * clicked. Same `.panel` rules now, so the differences are only the ones that
 * mean something:
 *
 * - the hero is the country's **flag** instead of a publisher's `og:image`,
 *   because a region has no article and therefore no picture of its own;
 * - there is **no headline block** — a country is not an article, so it has no
 *   title, timestamp, source or placement line to show;
 * - the list is headed **"Top stories"** rather than "Stories Nearby", which is
 *   the honest description of what the index holds: `compareGroups`' ranking of
 *   the region, not a radius query around a point.
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
  stories: RegionStory[];
  /** `unavailable` covers both "this manifest predates the index" and a failed fetch. */
  status: "loading" | "ready" | "unavailable";
  onClose: () => void;
  /** Slid off the left edge, still selected. Owned by `MapView` — see the note there. */
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export default function RegionPanel({
  name,
  regionId,
  stories,
  status,
  onClose,
  collapsed,
  onToggleCollapse,
}: RegionPanelProps) {
  /**
   * The flag, or `null` for "draw the flat purple hero instead".
   *
   * **The state is the URL that FAILED, not the URL to show.** `flagUrl` knows
   * the code maps to an ISO country; it cannot know flagcdn has an image for it,
   * so a failed load still has to fall back to the flat hero — the story panel
   * does the same with a hotlinked `og:image`, and for the same reason (a
   * broken-image icon is worse than no image). Storing the failure rather than
   * the value is what makes that survive the panel staying mounted as the reader
   * clicks from one country to the next: the URL is derived fresh every render,
   * so a new region cannot inherit the previous one's flag for a frame, and does
   * not need an effect to clear it.
   */
  const url = flagUrl(regionId);
  const [failed, setFailed] = useState<string | null>(null);
  const flag = url && url !== failed ? url : null;

  /** One clock reading for every row — see the same note in `StoryPanel`. */
  const now = Date.now();

  return (
    <aside
      className={`panel${collapsed ? " panel--collapsed" : ""}`}
      aria-label={`Top stories in ${name || regionId}`}
    >
      {/* `.panel` positions and slides; this holds and scrolls — see `StoryPanel`. */}
      <div className="panel__scroll">
        <header className={`panel__hero${flag ? " panel__hero--image" : ""}`}>
          {flag && (
            /*
             * A plain <img>, not next/image, for the same reason the story panel's
             * thumbnail is: this is a third party's URL, and routing it through
             * Vercel's optimizer would proxy their bytes on every view.
             *
             * eslint-disable-next-line @next/next/no-img-element
             */
            <img
              className="panel__image"
              src={flag}
              alt=""
              onError={() => setFailed(flag)}
              referrerPolicy="no-referrer"
            />
          )}
          <span className="panel__dot" aria-hidden="true" />
          <button type="button" className="panel__close" onClick={onClose} aria-label="Close panel">
            ×
          </button>
          <h2 className="panel__place">{name || regionId}</h2>
        </header>

        <section className="panel__list" aria-label={`Top stories in ${name || regionId}`}>
          <h3>Top stories</h3>

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
             * An `ol`, where "Stories Nearby" is a `ul`: this list IS ranked —
             * `compareGroups` decided the order and the panel does not re-rank —
             * while neighbours have no order beyond what the radius query returned.
             * The markers are off in CSS either way; the element is what says so to
             * a screen reader.
             */
            <ol>
              {stories.map((story) => {
                const age = publishedAt(story.date, now);
                return (
                  <li key={story.url}>
                    {/* The same meta row "Stories Nearby" carries, from the same
                      `publishedAt` — one clock and one chip across both panels. */}
                    <p className="panel__meta">
                      {story.source && <span className="panel__chip">{story.source}</span>}
                      {age && <span className="panel__stamp">{age}</span>}
                    </p>
                    {/* §2.6: link-out only. Title, source, link — never article text. */}
                    <a href={story.url} target="_blank" rel="noopener noreferrer">
                      {story.title}
                    </a>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* The same footer the story panel renders, and now for one reason
          rather than two — see `StoryPanel`. §2.6's logo must survive this panel
          covering the map's bottom-left corner; /about moved to the brand block
          on 2026-08-14 and is reachable with no panel open at all. */}
        <footer className="panel__footer">
          <MapTilerLogo className="maptiler-logo--panel" />
        </footer>
      </div>

      <PanelTab collapsed={collapsed} onToggle={onToggleCollapse} />
    </aside>
  );
}
