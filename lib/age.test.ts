import { describe, expect, it } from "vitest";
import { ago } from "./age";

const NOW = Date.parse("2026-08-12T20:00:00.000Z");
const at = (hours: number) => NOW - hours * 3600 * 1000;

describe("ago", () => {
  it("rounds down to the coarsest honest unit", () => {
    expect(ago(at(0), NOW)).toBe("just now");
    expect(ago(at(0.5), NOW)).toBe("30 minutes ago");
    expect(ago(at(1), NOW)).toBe("an hour ago");
    expect(ago(at(5), NOW)).toBe("5 hours ago");
    expect(ago(at(25), NOW)).toBe("a day ago");
    expect(ago(at(50), NOW)).toBe("2 days ago");
  });

  it("says the singular units in words, not as 1", () => {
    // "1 hours ago" is the bug this shape of ladder exists to avoid, and it is
    // the one an off-by-one in the thresholds would reintroduce.
    expect(ago(at(1.5), NOW)).toBe("an hour ago");
    expect(ago(at(23.9), NOW)).toBe("23 hours ago");
    expect(ago(at(47.9), NOW)).toBe("a day ago");
  });

  it("does not report a future timestamp as negative", () => {
    // Clock skew between the publisher, the runner and the visitor is real and
    // small. "-3 minutes ago" reads as a bug; "just now" is truer and calmer.
    expect(ago(at(-0.05), NOW)).toBe("just now");
    expect(ago(at(-10), NOW)).toBe("just now");
  });

  it("returns nothing at all for an unreadable instant", () => {
    // The callers render this straight into the DOM, and "NaN minutes ago" is
    // worse than an empty stamp. `publishedAt` relies on this for a bad stamp.
    expect(ago(NaN, NOW)).toBe("");
  });
});
