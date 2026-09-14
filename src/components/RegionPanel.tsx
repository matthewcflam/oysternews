"use client";

import { useState } from "react";
import { countryName, flagUrl } from "@/lib/flag";
import { placeLine, publishedAt } from "@/lib/story";
import type { RegionEntry } from "@/lib/types";
import PanelTab from "./PanelTab";

export type RegionPanelProps = {
  name: string;
  regionId: string;
  entry: RegionEntry;
  status: "loading" | "ready" | "unavailable";
  onZoom: (() => void) | null;
  collapsed: boolean;
  onToggle: () => void;
  flagCode?: string;
  trail?: string[];
};

const SCROLL_ID = "region-panel-content";

export default function RegionPanel({
  name,
  regionId,
  entry,
  status,
  onZoom,
  collapsed,
  onToggle,
  flagCode,
  trail: trailOverride,
}: RegionPanelProps) {
  const { stories, total, sources } = entry;
  // Stores the URL that FAILED, not the one to show: deriving it each render means a new
  // region never inherits the previous flag for a frame.
  const url = flagUrl(flagCode ?? regionId);
  const [failed, setFailed] = useState<string | null>(null);
  const flag = url && url !== failed ? url : null;

  const heading = name || regionId;

  // Filtered: countryName returns "" for an uncarried code, and a missing crumb must not leave a gap.
  const parent = regionId.trim().length === 2 ? "" : countryName(regionId);
  const middle = trailOverride ?? [parent];
  const trail = ["World", ...middle, heading].filter(Boolean);

  // total 0 means the index predates the counts, not a region with no news.
  const counts =
    total > 0
      ? [
          `${total} ${total === 1 ? "story" : "stories"} today`,
          sources > 0 ? `${sources} ${sources === 1 ? "source" : "sources"}` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

  const now = Date.now();

  return (
    <aside
      className="panel panel--bounded"
      data-collapsed={collapsed}
      aria-label={`Top stories in ${heading}`}
    >
      {/* `.panel` carries the shadow; this element clips. One element cannot both overflow and clip. */}
      <div className="panel__scroll" id={SCROLL_ID} inert={collapsed}>
        <header className="panel__head">
          <div className="panel__ident">
            <p className="panel__crumbs">
              {trail.map((crumb, at) => (
                <span
                  key={crumb}
                  className={at === trail.length - 1 ? "panel__crumb--here" : undefined}
                >
                  {at > 0 && (
                    <span className="panel__crumb-sep" aria-hidden="true">
                      ›
                    </span>
                  )}
                  {crumb}
                </span>
              ))}
            </p>
            <h2 className="panel__region">{heading}</h2>
            {counts && <p className="panel__counts">{counts}</p>}
          </div>

          {flag && (
            // biome-ignore lint/performance/noImgElement: third-party URL, avoid Vercel proxy
            <img
              className="panel__flag"
              src={flag}
              alt=""
              onError={() => setFailed(flag)}
              referrerPolicy="no-referrer"
            />
          )}
        </header>

        <section className="panel__list" aria-label={`Top stories in ${heading}`}>
          {status === "loading" && <p className="panel__note">Loading stories…</p>}

          {status === "unavailable" && (
            <p className="panel__note">Story list unavailable for this run.</p>
          )}

          {status === "ready" && stories.length === 0 && (
            <p className="panel__note">No stories here in the last 24 hours.</p>
          )}

          {status === "ready" && stories.length > 0 && (
            <ol>
              {stories.map((story) => {
                const age = publishedAt(story.date, now);
                const where = placeLine({ place: story.place, kind: "" });
                return (
                  <li key={story.url}>
                    {where && <p className="panel__row-place">{where}</p>}
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

        {onZoom && (
          <footer className="panel__footer panel__footer--zoom">
            <button type="button" className="panel__zoom" onClick={onZoom}>
              Zoom to {heading} <span aria-hidden="true">›</span>
            </button>
          </footer>
        )}
      </div>

      <PanelTab collapsed={collapsed} onToggle={onToggle} controls={SCROLL_ID} />
    </aside>
  );
}
