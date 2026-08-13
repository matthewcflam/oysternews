"use client";

import { storyAge } from "@/lib/regions";
import type { RegionStory } from "@/lib/types";

/**
 * §2.3's region panel: the top stories of the country or state whose label was
 * clicked.
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
};

export default function RegionPanel({
  name,
  regionId,
  stories,
  status,
  onClose,
}: RegionPanelProps) {
  const now = Date.now();

  return (
    <aside className="panel" aria-label={`Top stories in ${name || regionId}`}>
      <header className="panel__head">
        <h2>{name || regionId}</h2>
        <button type="button" className="panel__close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </header>

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
        <ol className="panel__list">
          {stories.map((story) => (
            <li key={story.url} className="panel__story">
              {/* §2.6: link-out only. Title, source, link — never article text. */}
              <a href={story.url} target="_blank" rel="noopener noreferrer">
                {story.title}
              </a>
              <p className="panel__meta">
                {story.source}
                {story.place && ` · ${story.place}`}
                {storyAge(story.date, now) && ` · ${storyAge(story.date, now)}`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
