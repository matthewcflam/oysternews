import { describe, expect, it } from "vitest";
import {
  BUBBLE_MAX_HEIGHT,
  BUBBLE_WIDTH,
  type BubbleInput,
  bubbleBox,
  CHROME_TOP,
  chooseLifts,
  chooseSides,
  placeBubbles,
  sideCap,
  TAIL_DROP,
  TAIL_REACH,
  TAIL_TIP_GAP,
} from "./bubble";

const DESKTOP = { width: 1482, height: 900 };
const PHONE = { width: 390, height: 844 };

const at = (url: string, x: number, y: number): BubbleInput => ({ url, x, y });

const sidesOf = (placed: ReadonlyArray<{ side: string }>) => ({
  left: placed.filter((bubble) => bubble.side === "left").length,
  right: placed.filter((bubble) => bubble.side === "right").length,
});

const liftsOf = (placed: ReadonlyArray<{ lift: string }>) => ({
  up: placed.filter((bubble) => bubble.lift === "up").length,
  down: placed.filter((bubble) => bubble.lift === "down").length,
});

describe("bubbleBox", () => {
  it("puts the tail's point on the pin, at both ends of the box", () => {
    const box = bubbleBox(700, 500, "left", "up");
    expect(box.right).toBe(700);
    expect(box.bottom).toBe(500);
    expect(box.right - box.left).toBe(BUBBLE_WIDTH + TAIL_REACH);
    expect(box.bottom - box.top).toBe(BUBBLE_MAX_HEIGHT + TAIL_DROP);
  });

  it("mirrors for a right bubble", () => {
    const left = bubbleBox(700, 500, "left", "up");
    const right = bubbleBox(700, 500, "right", "up");
    expect(right.left).toBe(700);
    expect(right.right).toBe(700 + BUBBLE_WIDTH + TAIL_REACH);
    expect(right.top).toBe(left.top);
    expect(right.bottom).toBe(left.bottom);
  });

  it("mirrors vertically for a down bubble, leaving the side alone", () => {
    const up = bubbleBox(700, 500, "left", "up");
    const down = bubbleBox(700, 500, "left", "down");
    expect(down.top).toBe(500);
    expect(down.bottom).toBe(500 + TAIL_DROP + BUBBLE_MAX_HEIGHT);
    expect(down.left).toBe(up.left);
    expect(down.right).toBe(up.right);
  });
});

describe("sideCap", () => {
  it("splits five as three and two", () => {
    expect(sideCap(5)).toBe(3);
    expect(sideCap(4)).toBe(2);
    expect(sideCap(1)).toBe(1);
  });
});

describe("chooseSides", () => {
  it("balances five free bubbles three-two", () => {
    const inputs = [200, 500, 800, 1100, 1400].map((x, index) => at(`s${index}`, x, 500));
    const counts = sidesOf(chooseSides(inputs, DESKTOP));
    expect(counts.left + counts.right).toBe(5);
    expect(Math.abs(counts.left - counts.right)).toBe(1);
  });

  it("forces a pin near the left edge to open right", () => {
    const [choice] = chooseSides([at("edge", 30, 500)], DESKTOP);
    expect(choice.side).toBe("right");
  });

  it("lets the edge win over balance", () => {
    const inputs = [30, 60, 90, 120].map((x, index) => at(`s${index}`, x, 500));
    const counts = sidesOf(chooseSides(inputs, DESKTOP));
    expect(counts).toEqual({ left: 0, right: 4 });
  });
});

describe("chooseLifts", () => {
  it("balances five free bubbles three-two on the vertical axis too", () => {
    const inputs = [200, 350, 450, 550, 700].map((y, index) => at(`s${index}`, 700, y));
    const counts = liftsOf(chooseLifts(inputs, DESKTOP));
    expect(counts.up + counts.down).toBe(5);
    expect(Math.abs(counts.up - counts.down)).toBe(1);
  });

  it("forces a pin near the top edge to open downward", () => {
    const [choice] = chooseLifts([at("high", 700, 100)], DESKTOP);
    expect(choice.lift).toBe("down");
  });

  it("forces a pin near the bottom edge to open upward", () => {
    const [choice] = chooseLifts([at("low", 700, 850)], DESKTOP);
    expect(choice.lift).toBe("up");
  });
});

describe("placeBubbles", () => {
  it("keeps five well-spread bubbles and balances both axes", () => {
    const inputs = [
      at("a", 200, 300),
      at("b", 560, 620),
      at("c", 800, 300),
      at("d", 1120, 620),
      at("e", 1400, 300),
    ];
    const placed = placeBubbles(inputs, DESKTOP);
    expect(placed).toHaveLength(5);
    expect(Math.abs(sidesOf(placed).left - sidesOf(placed).right)).toBe(1);
    expect(Math.abs(liftsOf(placed).up - liftsOf(placed).down)).toBe(1);
  });

  it("places a pin too near the top, which used to be dropped outright", () => {
    const placed = placeBubbles([at("high", 700, 100)], DESKTOP);
    expect(placed).toHaveLength(1);
    expect(placed[0].lift).toBe("down");
  });

  it("rescues a blocked candidate with the other lift rather than dropping it", () => {
    const placed = placeBubbles([at("best", 700, 300), at("blocked", 700, 500)], DESKTOP);

    expect(placed.map((bubble) => bubble.url)).toEqual(["best", "blocked"]);
    expect(placed[1].lift).toBe("down");
    expect(new Set(placed.map((bubble) => bubble.lift)).size).toBe(2);
  });

  it("still drops a cluster too tight for two headlines", () => {
    const cluster = [at("a", 320, 312), at("b", 303, 326), at("c", 185, 379)];
    expect(placeBubbles(cluster, DESKTOP).map((bubble) => bubble.url)).toEqual(["a"]);
  });

  it("flips a loner to its free side rather than dropping it", () => {
    const live = [
      at("e", 742, 217),
      at("b", 320, 312),
      at("c", 303, 326),
      at("d", 748, 221),
      at("a", 185, 379),
    ];
    const placed = placeBubbles(live, DESKTOP);

    expect(placed.map((bubble) => bubble.url)).toEqual(["e", "b", "a"]);
    expect(placed[2].side).toBe("left");
  });

  it("refuses the far side to a pin its neighbour is sitting on", () => {
    const near = (gap: number) => [at("e", 742, 217), at("b", 320, 312), at("x", 320 - gap, 312)];

    expect(placeBubbles(near(TAIL_TIP_GAP), DESKTOP).map((bubble) => bubble.url)).toEqual([
      "e",
      "b",
      "x",
    ]);
    expect(placeBubbles(near(TAIL_TIP_GAP - 1), DESKTOP).map((bubble) => bubble.url)).toEqual([
      "e",
      "b",
    ]);
  });

  it("refuses to slide a bubble under the chrome", () => {
    expect(CHROME_TOP + TAIL_DROP + BUBBLE_MAX_HEIGHT).toBe(187);
    const shallow = { width: 1482, height: 210 };
    expect(placeBubbles([at("high", 700, 100)], shallow)).toHaveLength(0);
    expect(placeBubbles([at("high", 700, 187)], shallow)[0]?.lift).toBe("up");
  });

  it("thins itself on a phone with no phone-specific rule", () => {
    const inputs = [
      at("a", 80, 300),
      at("b", 200, 340),
      at("c", 300, 380),
      at("d", 150, 600),
      at("e", 260, 700),
    ];
    const placed = placeBubbles(inputs, PHONE);
    expect(placed.length).toBeLessThan(5);
    expect(placed.length).toBeGreaterThan(0);
  });

  it("is a pure function of its input", () => {
    const inputs = [200, 500, 800, 1100, 1400].map((x, index) => at(`s${index}`, x, 500));
    expect(placeBubbles(inputs, DESKTOP)).toEqual(placeBubbles(inputs, DESKTOP));
  });
});
