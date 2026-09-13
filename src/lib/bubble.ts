type BubbleSide = "left" | "right";

type BubbleLift = "up" | "down";

export const BUBBLE_WIDTH = 135;

export const BUBBLE_MAX_HEIGHT = 79;

export const TAIL_DROP = 52;

export const TAIL_REACH = 8;

const BUBBLE_GAP = 4;

export const TAIL_TIP_GAP = 32;

export const CHROME_TOP = 70;

const EDGE_MARGIN = 8;

export type Viewport = { width: number; height: number };

export type BubbleInput = { url: string; x: number; y: number };

export type PlacedBubble = {
  url: string;
  side: BubbleSide;
  lift: BubbleLift;
  x: number;
  y: number;
};

type Box = { left: number; right: number; top: number; bottom: number };

export function bubbleBox(x: number, y: number, side: BubbleSide, lift: BubbleLift): Box {
  const [left, right] = sideSpan(x, side);
  const [top, bottom] = liftSpan(y, lift);
  return { left, right, top, bottom };
}

const sideSpan = (x: number, side: BubbleSide): [number, number] => {
  const reach = BUBBLE_WIDTH + TAIL_REACH;
  return side === "left" ? [x - reach, x] : [x, x + reach];
};

const liftSpan = (y: number, lift: BubbleLift): [number, number] => {
  const reach = TAIL_DROP + BUBBLE_MAX_HEIGHT;
  return lift === "up" ? [y - reach, y] : [y, y + reach];
};

function boxFits(box: Box, viewport: Viewport): boolean {
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

export const sideCap = (count: number): number => Math.ceil(count / 2);

type Axis<T extends string> = {
  options: readonly [T, T];
  fits: (input: BubbleInput, option: T) => boolean;
  prefer: (input: BubbleInput) => T;
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

function chooseAxis<T extends string>(inputs: readonly BubbleInput[], axis: Axis<T>): T[] {
  const choices: Choice<T>[] = inputs.map((input) => {
    const allowed = axis.options.filter((option) => axis.fits(input, option));
    const wanted = axis.prefer(input);
    const option = allowed.includes(wanted) ? wanted : (allowed[0] ?? wanted);
    return { input, option, allowed };
  });

  const cap = sideCap(choices.length);

  for (const option of axis.options) {
    const other = option === axis.options[0] ? axis.options[1] : axis.options[0];
    // Stable sort, ties broken by rank: the same input must always give the same answer.
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

export function chooseSides(
  inputs: readonly BubbleInput[],
  viewport: Viewport
): Array<{ url: string; side: BubbleSide }> {
  const sides = chooseAxis(inputs, horizontal(viewport));
  return inputs.map((input, index) => ({ url: input.url, side: sides[index] }));
}

export function chooseLifts(
  inputs: readonly BubbleInput[],
  viewport: Viewport
): Array<{ url: string; lift: BubbleLift }> {
  const lifts = chooseAxis(inputs, vertical(viewport));
  return inputs.map((input, index) => ({ url: input.url, lift: lifts[index] }));
}

export function placeBubbles(inputs: readonly BubbleInput[], viewport: Viewport): PlacedBubble[] {
  const sides = chooseAxis(inputs, horizontal(viewport));
  const lifts = chooseAxis(inputs, vertical(viewport));

  const kept: Placement[] = [];

  inputs.forEach((input, index) => {
    const side = sides[index];
    const assigned = lifts[index];

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

  return kept.map(({ input, side, lift }) => ({
    url: input.url,
    side,
    lift,
    x: input.x,
    y: input.y,
  }));
}

type Placement = { input: BubbleInput; side: BubbleSide; lift: BubbleLift; box: Box };

const clearOfKeptPins = (input: BubbleInput, kept: readonly Placement[]): boolean =>
  kept.every(
    (placed) => Math.hypot(placed.input.x - input.x, placed.input.y - input.y) >= TAIL_TIP_GAP
  );

const other = <T>(options: readonly [T, T], option: T): T =>
  option === options[0] ? options[1] : options[0];

const assignSide = (placed: Placement, side: BubbleSide) => ({ ...placed, side });
const assignLift = (placed: Placement, lift: BubbleLift) => ({ ...placed, lift });

function rebalance<T extends string>(
  kept: Placement[],
  viewport: Viewport,
  options: readonly [T, T],
  read: (placed: Placement) => T,
  write: (placed: Placement, option: T) => Placement
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
