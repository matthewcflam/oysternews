"use client";

import Link from "next/link";
import { useState } from "react";
import { type PanelStory, placeLine, publishedAt } from "@/lib/story";

export type StoryPanelProps = {
  story: PanelStory;
  onClose: () => void;
};

export default function StoryPanel({ story, onClose }: StoryPanelProps) {
  // Stores the rejected url, not a boolean: a boolean needs an effect to clear, which flashes
  // the flat header for a frame.
  const [rejectedUrl, setRejectedUrl] = useState("");
  const image = rejectedUrl === story.url ? "" : story.image;

  // Under 200 natural pixels is a tracking beacon or a favicon. Beacons load fine, so onError
  // never fires.
  const MIN_IMAGE_WIDTH = 200;

  // One clock reading for the whole panel, so rows never disagree across a minute boundary.
  const now = Date.now();
  const time = publishedAt(story.date, now);

  const byline = [story.source, time].filter(Boolean).join(" · ");

  const place = placeLine(story);

  return (
    <aside className="panel" aria-label={story.title || "Story"}>
      {/* `.panel` carries the shadow; this element clips. One element cannot both overflow and clip. */}
      <div className="panel__scroll">
        <header className={`panel__hero${image ? " panel__hero--image" : ""}`}>
          {image && (
            // onError falls back to the flat header: a hotlinked image can 403 or vanish.
            // biome-ignore lint/performance/noImgElement: publisher CDN URL, avoid Vercel proxy
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
          <button type="button" className="panel__close" onClick={onClose} aria-label="Close panel">
            ×
          </button>
        </header>

        <div className="panel__body">
          {byline && <p className="panel__byline">{byline}</p>}

          <h2 className="panel__title">{story.title}</h2>

          {place && (
            <p className="panel__where">
              <span className="panel__sphere" aria-hidden="true" />
              {place}
            </p>
          )}

          <a className="panel__cta" href={story.url} target="_blank" rel="noopener noreferrer">
            Read The Story
          </a>
        </div>

        <footer className="panel__footer panel__footer--about">
          <Link className="panel__about" href="/about">
            How does this work?
          </Link>
        </footer>
      </div>
    </aside>
  );
}
