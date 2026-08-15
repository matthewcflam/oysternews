/**
 * Where the browse-mode speech bubbles go (mode 1).
 *
 * The top five stories on screen already wear a white ring (`isTop` in
 * `lib/layers.ts`). At z2 the headline layer is off entirely — `LABEL_MINZOOM`
 * is 4 — so the five best stories in the world view are five identical dots. A
 * bubble puts the headline on the map next to its pin, tail pointing back at it.
 *
 * Laid out once per opening: `MapView` captures the five at the first `idle` and
 * retires them on the reader's first camera move, so this rule answers "how does
 * this one arrangement fit this one viewport" and never has to be stable under a
 * pan.
 *
 * **This module is the product rule and nothing else**: screen points in, sides
 * and survivors out. No MapLibre, no DOM, no measurement — the same split
 * `lib/top.ts` and `lib/spiderfy.ts` already make, and the only part of mode 1
 * that a `environment: "node"` test suite can reach.
 *
 * Geometry is decomposed from the mockup's own CSS. `Rectangle 11` is 135×79 at
 * (437, 450); `Polygon 3` is 36.81×76.24 at (535.18, 505) rotated 172.71° about
 * its centre. Rotating the polygon's apex vector (0, −38.12) by that angle puts
 * the point at (558.4, 580.9) — +121.4 right of and +130.9 below the body's
 * top-left corner, which matches the mockup screenshot to within a pixel.
 *
 * The tail was later pulled flush with the body's edge and the point moved just
 * past it; see `TAIL_REACH`.
 */

/** Which side of the pin the BODY sits on. A `left` bubble's tail exits bottom-right. */
export type BubbleSide = "left" | "right";

/**
 * Which side of the pin the body sits on vertically.
 *
 * `up` is the mockup's original: the body hangs above and the tail drops onto the
 * pin. `down` is its mirror — the body below, the tail climbing up to the pin.
 *
 * **A second orientation is worth more than it looks.** With one, a candidate
 * whose place is taken is simply dropped; measured on the live map at z2, the top
 * five sat in two tight clusters and only two bubbles were drawn. A pin in the
 * top ~200px was dropped outright, because its box would run under the search
 * pill. The mirror costs one CSS flag and rescues both cases.
 */
export type BubbleLift = "up" | "down";

/** The body, from the mockup. Fixed: only the height varies, and only in CSS. */
export const BUBBLE_WIDTH = 135;

/**
 * Four lines of 16px plus 6px/9px padding — the maximum, past which the headline
 * is clamped with an ellipsis. **The layout always assumes this height**, even
 * for a one-line headline. Measuring the real height would mean rendering first,
 * reading `offsetHeight`, then re-laying-out, and would put a DOM dependency in
 * the middle of the one rule worth testing. A bubble that renders shorter than
 * the reservation only ever has more clearance than it was promised.
 */
export const BUBBLE_MAX_HEIGHT = 79;

/** How far the tail's point falls below the body's bottom edge. */
export const TAIL_DROP = 52;

/**
 * How far past the body's near edge the tail's point lands.
 *
 * **It used to be an inset**, 12px back INSIDE the body's footprint, which is
 * what the mockup's polygon decomposed to. Drawn, that put the wedge's outer edge
 * short of the body's corner and left a visible step where the two met — the body
 * ended, then the tail started again a few pixels in. Flush is the fix: the
 * wedge's outer edge now continues the body's own edge, and the point carries on
 * past it to the pin.
 */
export const TAIL_REACH = 8;

/** Breathing room between two reserved boxes, so bubbles never touch. */
export const BUBBLE_GAP = 4;

/**
 * How far apart two pins must be before a bubble may open on the far side of its
 * own pin. **This gates the side flip and nothing else** — see `placeBubbles`.
 *
 * The tail's base is 32px wide where it meets the body, which is the width of the
 * mark a reader follows back to a dot. Two tails whose tips land closer than that
 * are one smudge with two headlines hanging off it, and no reader can say which
 * headline belongs to which story. Below the gap the loser keeps its ring.
 *
 * The measured spread on the default world view (2026-08-15) is not close to the
 * line: the two pair-mates the flip must refuse sit 6px and 21px from their
 * neighbours, and the loner it must rescue sits 118px away. A dumb constant with
 * that much daylight on both sides is doing better work here than a rule that
 * tried to compute the right distance per view.
 */
export const TAIL_TIP_GAP = 32;

/**
 * The strip along the top where a bubble may not be placed: the search pill and
 * the brand block live there (`z-index: 2`, above the overlay), and a headline
 * sliding under them reads as a rendering fault rather than as chrome.
 */
export const CHROME_TOP = 70;

/** Keep a bubble off the very edge of the canvas. */
export const EDGE_MARGIN = 8;

export type Viewport = { width: number; height: number };

/** A candidate, in screen pixels, best first. `y` is the pin the tail points at. */
export type BubbleInput = { url: string; x: number; y: number };

export type PlacedBubble = {
  url: string;
  side: BubbleSide;
  lift: BubbleLift;
  x: number;
  y: number;
};

/** The reserved rectangle: the body, plus the strip the tail falls through. */
export type Box = { left: number; right: number; top: number; bottom: number };

/**
 * The box a bubble would occupy if its tail landed on `(x, y)`.
 *
 * The tail's own extent is inside the body's on both axes, so the union is just
 * the body pushed out to the point.
 *
 * **The two axes are independent, and that is what keeps the rule small.** The
 * horizontal span depends only on the side and the vertical span only on the
 * lift, so "does this side fit the canvas" and "does this lift fit the canvas"
 * are separate questions and one balancing pass answers both.
 */
export function bubbleBox(x: number, y: number, side: BubbleSide, lift: BubbleLift): Box {
  const [left, right] = sideSpan(x, side);
  const [top, bottom] = liftSpan(y, lift);
  return { left, right, top, bottom };
}

/**
 * The body plus the sliver of tail that reaches past it, so the reservation
 * covers everything drawn. The pin itself is one end of the span.
 */
const sideSpan = (x: number, side: BubbleSide): [number, number] => {
  const reach = BUBBLE_WIDTH + TAIL_REACH;
  return side === "left" ? [x - reach, x] : [x, x + reach];
};

const liftSpan = (y: number, lift: BubbleLift): [number, number] => {
  const reach = TAIL_DROP + BUBBLE_MAX_HEIGHT;
  return lift === "up" ? [y - reach, y] : [y, y + reach];
};

/** Does this box sit entirely inside the part of the canvas bubbles may use? */
export function boxFits(box: Box, viewport: Viewport): boolean {
  return (
    box.left >= EDGE_MARGIN &&
    box.right <= viewport.width - EDGE_MARGIN &&
    box.top >= CHROME_TOP &&
    box.bottom <= viewport.height - EDGE_MARGIN
  );
}

const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right + BUBBLE_GAP &&
  b.left < a.right + BUBBLE_GAP &&
  a.top < b.bottom + BUBBLE_GAP &&
  b.top < a.bottom + BUBBLE_GAP;

/**
 * The most either option on an axis may hold. Five bubbles balance 3/2, which is
 * the rule as the mockup states it; an even count splits evenly.
 */
export const sideCap = (count: number): number => Math.ceil(count / 2);

/**
 * One axis of the layout: two mutually exclusive options, which of them fit, and
 * how strongly each candidate wants one.
 *
 * Both axes are the same sentence — *put the body where there is more room* — so
 * they share a description rather than two copies of a loop that could drift
 * apart.
 */
type Axis<T extends string> = {
  options: readonly [T, T];
  /** Is this option's span inside the part of the canvas bubbles may use? */
  fits: (input: BubbleInput, option: T) => boolean;
  /** The option with more room behind it. */
  prefer: (input: BubbleInput) => T;
  /** How weakly the candidate holds that preference — flipped first for balance. */
  pull: (input: BubbleInput) => number;
};

const SIDES = ["left", "right"] as const;
const LIFTS = ["up", "down"] as const;

const horizontal = (viewport: Viewport): Axis<BubbleSide> => ({
  options: SIDES,
  fits: (input, side) => {
    const [left, right] = sideSpan(input.x, side);
    return left >= EDGE_MARGIN && right <= viewport.width - EDGE_MARGIN;
  },
  prefer: (input) => (input.x > viewport.width / 2 ? "left" : "right"),
  pull: (input) => Math.abs(input.x - viewport.width / 2),
});

const vertical = (viewport: Viewport): Axis<BubbleLift> => ({
  options: LIFTS,
  fits: (input, lift) => {
    const [top, bottom] = liftSpan(input.y, lift);
    return top >= CHROME_TOP && bottom <= viewport.height - EDGE_MARGIN;
  },
  prefer: (input) => (input.y > viewport.height / 2 ? "up" : "down"),
  pull: (input) => Math.abs(input.y - viewport.height / 2),
});

type Choice<T extends string> = { input: BubbleInput; option: T; allowed: T[] };

/**
 * Assign every candidate one option on one axis, balanced as far as the viewport
 * allows.
 *
 * **Edges beat balance.** A bubble whose body would run off the canvas has one
 * legal option and keeps it, even where that leaves the count 4/1; the
 * alternative is a headline sliced by the window, which is worse than an uneven
 * split. Only bubbles with a real choice are flipped, weakest preference first,
 * so the result is a pure function of the input order and positions — one
 * ranking must always produce one picture, and `placeBubbles` is re-run when a
 * selection withholds a bubble and the other four have to re-place around it.
 */
function chooseAxis<T extends string>(inputs: readonly BubbleInput[], axis: Axis<T>): T[] {
  const choices: Choice<T>[] = inputs.map((input) => {
    const allowed = axis.options.filter((option) => axis.fits(input, option));
    const wanted = axis.prefer(input);
    // Nothing fits: the placement pass will drop it. Give it its preference
    // anyway rather than a special case, so this function stays total.
    const option = allowed.includes(wanted) ? wanted : (allowed[0] ?? wanted);
    return { input, option, allowed };
  });

  const cap = sideCap(choices.length);

  for (const option of axis.options) {
    const other = option === axis.options[0] ? axis.options[1] : axis.options[0];
    // Weakest pull first, and ties broken by rank via a stable sort — the same
    // input must always give the same answer.
    const flippable = choices
      .map((choice, rank) => ({ choice, rank }))
      .filter(({ choice }) => choice.option === option && choice.allowed.includes(other))
      .sort((a, b) => axis.pull(a.choice.input) - axis.pull(b.choice.input) || a.rank - b.rank);

    let count = choices.filter((choice) => choice.option === option).length;
    for (const { choice } of flippable) {
      if (count <= cap) break;
      choice.option = other;
      count--;
    }
  }

  return choices.map((choice) => choice.option);
}

/** The balanced left/right assignment, in input order. */
export function chooseSides(
  inputs: readonly BubbleInput[],
  viewport: Viewport,
): Array<{ url: string; side: BubbleSide }> {
  const sides = chooseAxis(inputs, horizontal(viewport));
  return inputs.map((input, index) => ({ url: input.url, side: sides[index] }));
}

/** The balanced up/down assignment, in input order. */
export function chooseLifts(
  inputs: readonly BubbleInput[],
  viewport: Viewport,
): Array<{ url: string; lift: BubbleLift }> {
  const lifts = chooseAxis(inputs, vertical(viewport));
  return inputs.map((input, index) => ({ url: input.url, lift: lifts[index] }));
}

/**
 * The bubbles that actually get drawn, best first.
 *
 * Walks the ranking and keeps a candidate only where its reserved box is on the
 * canvas and clear of every box already kept. **The loser is dropped, not
 * shrunk or moved** — the story keeps its ringed circle, so nothing is lost
 * except the headline, and five bubbles is a maximum rather than a quota.
 *
 * **A blocked candidate tries the other lift first, and only then the other
 * side.** The lift retry is the whole point of a vertical axis — a bubble whose
 * place above the pin is taken can very often hang below it instead, where
 * nothing is. Both lifts on the assigned side are exhausted before the side is
 * touched, so a bubble that has anywhere to go on its own side stays there.
 *
 * **The side flip is a last resort, and it is the difference between a headline
 * and no headline.** Flipping sides *on a collision* was offered when mode 1 was
 * specified and declined, because a bubble that jumps across its pin to escape a
 * crowd is harder to follow than one that is simply not there. That reasoning
 * holds for the crowd and breaks for the loner: measured on the default world
 * view (2026-08-15), the story at `(185, 379)` — alone in North America, with the
 * whole left half of the canvas free — opened right, because `prefer` reads the
 * viewport's centre and 185 is left of it. Its box grazed the next anchor's
 * column by 8px on both lifts and it was dropped, taking the first screen from
 * three headlines to two. The choice there is not "which side is easier to
 * follow" but "a bubble, or nothing", and a bubble on the far side of its own pin
 * is still attached to it by a tail.
 *
 * **So the flip is gated on `TAIL_TIP_GAP`, and the gate is the whole of the
 * original objection.** Ungated, the same view rescued the two pair-mates as
 * well: five bubbles, two of them opening on opposite sides of a pair of dots 6px
 * apart, with both tails landing on one smudge. That picture carries more
 * headlines and less information than the one it replaced. A candidate may reach
 * for its far side only where its own pin stands clear of every pin already
 * drawing a bubble.
 *
 * After the drops it makes one more pass at balance on each axis, because a flip
 * is only legal if it lands somewhere free and that cannot be known until the
 * kept set exists.
 */
export function placeBubbles(inputs: readonly BubbleInput[], viewport: Viewport): PlacedBubble[] {
  const sides = chooseAxis(inputs, horizontal(viewport));
  const lifts = chooseAxis(inputs, vertical(viewport));

  const kept: Placement[] = [];

  inputs.forEach((input, index) => {
    const side = sides[index];
    const assigned = lifts[index];

    // Assigned side first, both lifts, before the far side is considered at all.
    // The far side is offered only to a pin that stands clear of every pin
    // already drawing a bubble; see `TAIL_TIP_GAP`.
    const trials = clearOfKeptPins(input, kept) ? [side, other(SIDES, side)] : [side];

    for (const trial of trials) {
      for (const lift of [assigned, other(LIFTS, assigned)]) {
        const box = bubbleBox(input.x, input.y, trial, lift);
        if (!boxFits(box, viewport)) continue;
        if (kept.some((placed) => overlaps(placed.box, box))) continue;
        kept.push({ input, side: trial, lift, box });
        return;
      }
    }
  });

  rebalance(kept, viewport, SIDES, (placed) => placed.side, assignSide);
  rebalance(kept, viewport, LIFTS, (placed) => placed.lift, assignLift);

  return kept.map(({ input, side, lift }) => ({ url: input.url, side, lift, x: input.x, y: input.y }));
}

type Placement = { input: BubbleInput; side: BubbleSide; lift: BubbleLift; box: Box };

/**
 * Is this pin far enough from every pin already carrying a bubble to be worth a
 * side flip? Straight-line distance, because two tips are ambiguous in whichever
 * direction they are near each other.
 */
const clearOfKeptPins = (input: BubbleInput, kept: readonly Placement[]): boolean =>
  kept.every(
    (placed) => Math.hypot(placed.input.x - input.x, placed.input.y - input.y) >= TAIL_TIP_GAP,
  );

const other = <T,>(options: readonly [T, T], option: T): T =>
  option === options[0] ? options[1] : options[0];

const assignSide = (placed: Placement, side: BubbleSide) => ({ ...placed, side });
const assignLift = (placed: Placement, lift: BubbleLift) => ({ ...placed, lift });

/**
 * Even out one axis among the survivors, in place.
 *
 * Lowest-ranked first: the best story keeps what it was given. A flip has to
 * both fit the canvas and clear every peer, so a crowded view simply stays
 * uneven rather than trading a balanced picture for an overlapping one.
 */
function rebalance<T extends string>(
  kept: Placement[],
  viewport: Viewport,
  options: readonly [T, T],
  read: (placed: Placement) => T,
  write: (placed: Placement, option: T) => Placement,
): void {
  const cap = sideCap(kept.length);

  for (const option of options) {
    let count = kept.filter((placed) => read(placed) === option).length;

    for (let index = kept.length - 1; index >= 0 && count > cap; index--) {
      const placed = kept[index];
      if (read(placed) !== option) continue;

      const flipped = write(placed, other(options, option));
      const box = bubbleBox(placed.input.x, placed.input.y, flipped.side, flipped.lift);
      if (!boxFits(box, viewport)) continue;
      if (kept.some((peer) => peer !== placed && overlaps(peer.box, box))) continue;

      kept[index] = { ...flipped, box };
      count--;
    }
  }
}
