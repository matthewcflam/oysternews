"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MapLibreMap } from "maplibre-gl";
import { placeBubbles, type PlacedBubble } from "@/lib/bubble";
import type { PanelStory } from "@/lib/story";

/**
 * Browse mode's speech bubbles: the headline of each top-5 story, next to its pin.
 *
 * **An opening card, not live chrome.** The five arrive once, on the first
 * `idle` after load — the default world view, so they are the top five stories
 * in the world — and `MapView` takes them down on the reader's first camera
 * move, for good. They are the map's first sentence; a headline that followed
 * the reader around would be competing with whatever they navigated to. The
 * white ring keeps re-ranking to the viewport, which is where "what is big
 * here" continues to be answered.
 *
 * That one-shot life is what makes the rest of this component small. The camera
 * cannot move while a bubble is on screen, so the layout runs when the list
 * changes and the anchors are positioned once per layout — no `idle`
 * subscription re-ranking under a pan, no per-frame projection.
 *
 * **Where the layout rule lives is the point.** Which side a bubble opens on and
 * which bubbles survive a crowded view are in `lib/bubble.ts`, pure and tested;
 * this component is the wiring — projection, DOM, and the click.
 *
 * A DOM overlay rather than a MapLibre layer, and the choice is forced. A bubble
 * is a rounded box whose height depends on how a variable-width font wraps a
 * headline, ending in an ellipsis at the fourth line. MapLibre can draw text and
 * it can draw a stretchable icon behind it, but Newsreader is not in the
 * basemap's glyph set (`LABEL_FONT` is pinned to Noto for exactly that reason)
 * and per-feature truncation is not expressible in a style expression. In the DOM
 * it is `-webkit-line-clamp: 4` and nothing measures anything.
 */

/** A ranked story and the coordinate its tail must land on. */
export type TopStory = { story: PanelStory; lngLat: [number, number] };

type Props = {
  map: MapLibreMap | null;
  /** Best first — `lib/top.ts`'s ranking, already resolved to coordinates. */
  stories: readonly TopStory[];
  /** The open story, if any. Its bubble is withheld; see below. */
  selectedUrl: string | null;
  onSelect: (story: PanelStory, lngLat: [number, number]) => void;
};

/**
 * The pixel a coordinate is drawn at, in the copy of the world nearest the
 * camera.
 *
 * `renderWorldCopies` is on, so a story exists at lng, lng plus or minus 360,
 * and `map.project` answers for whichever one it was handed. Snapping to the
 * copy nearest the centre is the same normalisation MapLibre does for its own
 * symbols.
 */
const pointFor = (map: MapLibreMap, [lng, lat]: [number, number]) => {
  const centre = map.getCenter().lng;
  return map.project([lng + 360 * Math.round((centre - lng) / 360), lat]);
};

export default function StoryBubbles({ map, stories, selectedUrl, onSelect }: Props) {
  const [placed, setPlaced] = useState<PlacedBubble[]>([]);

  /** One anchor node per placed bubble, so positioning never goes through React. */
  const nodes = useRef(new globalThis.Map<string, HTMLDivElement>());

  /**
   * The story behind each placement. **Written only by `relayout`, alongside
   * `placed`**, so the index and the layout can never disagree about which
   * bubbles exist — a render that read one from state and the other from a ref
   * would draw a headline for a story that was no longer in the ranking.
   */
  const byUrl = useRef(new globalThis.Map<string, TopStory>());

  /**
   * Move the anchors onto their pins. **Straight to the node**, and once per
   * layout: `docs/ui-refresh-2026-08.md` records why the selection triangle is a
   * GeoJSON source and not a `Marker` — a DOM node repositioned a frame late
   * slides its point off its own dot. A bubble has the same tip and the same
   * tell, and here the camera is stationary for the whole of its life, so one
   * write before paint is both necessary and sufficient.
   */
  const position = useCallback(() => {
    if (!map) return;
    for (const [url, node] of nodes.current) {
      const entry = byUrl.current.get(url);
      if (!entry) continue;
      const point = pointFor(map, entry.lngLat);
      node.style.transform = `translate3d(${Math.round(point.x)}px, ${Math.round(point.y)}px, 0)`;
    }
  }, [map]);

  /**
   * Run the layout.
   *
   * **The selected story gets no bubble.** The selection triangle already hangs
   * up and to the left of that same pin, inside where the body would be, and the
   * open panel is carrying the headline in full. Two marks and two copies of one
   * sentence for one story.
   */
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
        viewport,
      ),
    );
  }, [map, stories, selectedUrl]);

  /**
   * Twice in a session, and a third time per story opened: when the five arrive,
   * when `MapView` clears them on the first camera move, and when a selection
   * withholds one of them. Opening a story has to take its bubble down now, not
   * when the reader next moves.
   */
  useEffect(() => {
    relayout();
  }, [relayout]);

  // Before paint, so a bubble is never briefly drawn at the top-left corner.
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
              // The clamped headline is the label; the attribute carries the rest
              // for anyone who wants the sentence the ellipsis ate.
              title={story.title}
              onClick={() => onSelect(story, lngLat)}
            >
              <span className="bubble__text">{story.title}</span>
              {/*
                Only the part of the tail beyond the body. The mockup's polygon
                starts inside the box, where its fill merges with the body's, so
                clipping its two edges at that border leaves this fixed wedge —
                the same 32x52 at every headline length, and in all four
                orientations, because CSS mirrors it about its own centre.

                x=24 is the body's corner, so the wedge's outer edge continues the
                body's edge rather than stepping in from it; x=32 is the pin.
              */}
              <svg className="bubble__tail" width="32" height="62" viewBox="0 0 32 52" aria-hidden="true">
                <path d="M0 0 L24 0 L32 52 Z" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
