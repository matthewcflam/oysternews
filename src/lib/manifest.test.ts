import { describe, expect, it } from "vitest";
import { CADENCE_HOURS, freshnessLabel, isStale } from "./manifest";

const NOW = Date.parse("2026-08-12T20:00:00.000Z");
const ago = (hours: number) => new Date(NOW - hours * 3600 * 1000).toISOString();

describe("freshnessLabel", () => {
  it("rounds down to the coarsest honest unit", () => {
    expect(freshnessLabel(ago(0), NOW)).toBe("Updated just now");
    expect(freshnessLabel(ago(0.5), NOW)).toBe("Updated 30 minutes ago");
    expect(freshnessLabel(ago(1), NOW)).toBe("Updated an hour ago");
    expect(freshnessLabel(ago(5), NOW)).toBe("Updated 5 hours ago");
    expect(freshnessLabel(ago(25), NOW)).toBe("Updated a day ago");
    expect(freshnessLabel(ago(50), NOW)).toBe("Updated 2 days ago");
  });

  it("does not report a future timestamp as negative", () => {
    expect(freshnessLabel(ago(-0.05), NOW)).toBe("Updated just now");
  });

  it("says so rather than throwing on an unparseable timestamp", () => {
    expect(freshnessLabel("not a date", NOW)).toBe("Updated at an unknown time");
  });
});

describe("isStale", () => {
  it("tolerates one missed run and flags two", () => {
    expect(isStale(ago(CADENCE_HOURS), NOW)).toBe(false);
    expect(isStale(ago(2 * CADENCE_HOURS - 0.1), NOW)).toBe(false);
    expect(isStale(ago(2 * CADENCE_HOURS + 0.1), NOW)).toBe(true);
  });

  it("treats an unreadable timestamp as stale", () => {
    expect(isStale("", NOW)).toBe(true);
  });
});
