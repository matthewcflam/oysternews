"use client";

import type { MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type PlacedBubble, placeBubbles } from "@/lib/bubble";
import type { PanelStory } from "@/lib/story";

// A DOM overlay, not a MapLibre layer: Newsreader isn't in the basemap's glyphs, and
// per-feature line clamping can't be expressed in a style.

export type TopStory = { story: PanelStory; lngLat: [number, number] };

type Props = {
  map: MapLibreMap | null;
  stories: readonly TopStory[];
  selectedUrl: string | null;
  onSelect: (story: PanelStory, lngLat: [number, number]) => void;
};

// renderWorldCopies is on: project the copy of the world nearest the camera centre.
const pointFor = (map: MapLibreMap, [lng, lat]: [number, number]) => {
  const centre = map.getCenter().lng;
  return map.project([lng + 360 * Math.round((centre - lng) / 360), lat]);
};

export default function StoryBubbles({ map, stories, selectedUrl, onSelect }: Props) {
  const [placed, setPlaced] = useState<PlacedBubble[]>([]);

  const nodes = useRef(new globalThis.Map<string, HTMLDivElement>());

  // Written only by relayout, alongside `placed`, so the index and the layout never disagree.
  const byUrl = useRef(new globalThis.Map<string, TopStory>());

  // Straight to the node, before paint: a node positioned a frame late slides off its pin.
  const position = useCallback(() => {
    if (!map) return;
    for (const [url, node] of nodes.current) {
      const entry = byUrl.current.get(url);
      if (!entry) continue;
      const point = pointFor(map, entry.lngLat);
      node.style.transform = `translate3d(${Math.round(point.x)}px, ${Math.round(point.y)}px, 0)`;
    }
  }, [map]);

  // The selected story gets no bubble: the triangle and the open panel already show it.
  const relayout = useCallback(() => {
    if (!map) return;
    const canvas = map.getCanvas();
    const viewport = { width: canvas.clientWidth, height: canvas.clientHeight };

    const candidates = stories.filter((entry) => entry.story.url !== selectedUrl);
    byUrl.current = new globalThis.Map(candidates.map((entry) => [entry.story.url, entry]));

    setPlaced(
      placeBubbles(
        candidates.map((entry) => {
          const point = pointFor(map, entry.lngLat);
          return { url: entry.story.url, x: point.x, y: point.y };
        }),
        viewport
      )
    );
  }, [map, stories, selectedUrl]);

  useEffect(() => {
    relayout();
  }, [relayout]);

  // Before paint, so a bubble is never briefly drawn at the top-left corner.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `placed` is the trigger; the anchor nodes it renders must be positioned after each layout
  useLayoutEffect(position, [position, placed]);

  if (!placed.length) return null;

  return (
    <div className="bubbles">
      {placed.map((bubble) => {
        const entry = byUrl.current.get(bubble.url);
        if (!entry) return null;
        const { story, lngLat } = entry;

        return (
          <div
            key={bubble.url}
            className="bubble-anchor"
            ref={(node) => {
              if (node) nodes.current.set(bubble.url, node);
              else nodes.current.delete(bubble.url);
            }}
          >
            <button
              type="button"
              className={`bubble bubble--${bubble.side} bubble--${bubble.lift}`}
              title={story.title}
              onClick={() => onSelect(story, lngLat)}
            >
              <span className="bubble__text">{story.title}</span>
              <svg
                className="bubble__tail"
                width="32"
                height="62"
                viewBox="0 0 32 52"
                aria-hidden="true"
              >
                <path d="M0 0 L24 0 L32 52 Z" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
