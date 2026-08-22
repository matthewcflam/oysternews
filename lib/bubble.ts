/**
 * Where the opening-card speech bubbles go. The top five stories on
 * screen wear a ring, but at world zoom the headline layer is off
 * entirely — a bubble puts the headline on the map next to its pin, tail
 * pointing back at it. Laid out once per opening (`MapView` captures the
 * five at the first `idle`, retires them on the reader's first camera
 * move), so this only has to fit one viewport, never stay stable under a
 * pan. Pure product rule — screen points in, sides and survivors out, no
 * MapLibre/DOM/measurement — same split as `lib/top.ts` and
 * `lib/spiderfy.ts`. See docs/DESIGN.md#the-selection-triangle-and-the-opening-card-bubbles.
 */

/** Which side of the pin the BODY sits on. A `left` bubble's tail exits bottom-right. */
export type BubbleSide = "left" | "right";

// Which side of the pin the body sits on vertically: `up` hangs above with
// the tail dropping onto the pin, `down` mirrors it. A second orientation
// matters — with only `up`, a measured live case dropped 3 of 5 bubbles
// to clustering and chrome overlap; the mirror rescues both.

export type BubbleLift = "up" | "down";

/** The body, from the mockup. Fixed: only the height varies, and only in CSS. */
export const BUBBLE_WIDTH = 135;

// The maximum height (4 lines + padding, past which text clamps). The
// layout always assumes this height even for a one-line headline —
// measuring the real height would need a render-then-relayout pass, a DOM
// dependency in the one rule worth unit-testing. See docs/DESIGN.md#the-selection-triangle-and-the-opening-card-bubbles.
export const BUBBLE_MAX_HEIGHT = 79;

/** How far the tail's point falls below the body's bottom edge. */
export const TAIL_DROP = 52;

// How far past the body's near edge the tail's point lands. Used to be an
// inset (12px back inside the body), which left a visible step where the
// wedge met the body; flush continues the body's own edge instead.
export const TAIL_REACH = 8;

/** Breathing room between two reserved boxes, so bubbles never touch. */
export const BUBBLE_GAP = 4;

// How far apart two pins must be before a bubble may open on the far side
// of its own pin — gates the side flip only, see `placeBubbles`. Two tails
// closer than the tail's own base width (32px) would be one smudge with
// two headlines; below the gap the loser keeps its ring instead.
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

// The box a bubble would occupy if its tail landed on (x, y). The two axes
// are independent (horizontal depends only on side, vertical only on
// lift), which is what keeps "does this fit" a single balancing pass.
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

// One axis of the layout: two mutually exclusive options, which fit, and
// how strongly each candidate wants one. Both axes are the same sentence
// ("put the body where there is more room"), so they share this
// description rather than two copies of a loop that could drift apart.
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

// Assign every candidate one option on one axis, balanced as far as the
// viewport allows. Edges beat balance: a bubble with only one legal option
// keeps it even if that skews the count, since a sliced headline is worse
// than uneven. Only real choices flip, weakest preference first, so the
// result is a pure function of input order/position.
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
 * The bubbles that actually get drawn, best first. Walks the ranking and
 * keeps a candidate only where its box is on-canvas and clear of every
 * box already kept — the loser is dropped, not shrunk or moved, since the
 * story keeps its ringed circle regardless. A blocked candidate tries the
 * other lift first (its own side has somewhere else to go), and only then
 * the other side — gated on `TAIL_TIP_GAP`, since an ungated flip was
 * measured to create smudged tail pairs while an unflipped bubble in a
 * genuinely empty area was measured to be dropped for no good reason.
 * After drops, one more balance pass per axis, since a flip is only legal
 * once the kept set exists.
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

// Is this pin far enough from every pin already carrying a bubble to be
// worth a side flip? Straight-line distance — two tips are ambiguous in
// whichever direction they are near each other.
const clearOfKeptPins = (input: BubbleInput, kept: readonly Placement[]): boolean =>
  kept.every(
    (placed) => Math.hypot(placed.input.x - input.x, placed.input.y - input.y) >= TAIL_TIP_GAP,
  );

const other = <T,>(options: readonly [T, T], option: T): T =>
  option === options[0] ? options[1] : options[0];

const assignSide = (placed: Placement, side: BubbleSide) => ({ ...placed, side });
const assignLift = (placed: Placement, lift: BubbleLift) => ({ ...placed, lift });

// Even out one axis among the survivors, in place. Lowest-ranked first, so
// the best story keeps what it was given; a crowded view simply stays
// uneven rather than trading balance for overlap.
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
