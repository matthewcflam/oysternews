/**
 * Relative time, in one voice, for the whole site.
 *
 * **This exists because the repo had grown three of them.** `freshnessLabel` said
 * "3 hours ago", `storyAge` said "3h ago", and `publishedAt` said "19:34 UTC" —
 * three answers to "when?" on one screen, in three formats, from three files.
 * When the panel stamps went relative on 2026-08-14 the choice was to add a
 * fourth or to collapse them, and a label is exactly the kind of thing that
 * drifts silently: nothing fails, the surfaces just stop matching.
 *
 * So this is the ladder, and its callers add only their own framing:
 * `freshnessLabel` prefixes "Updated ", the panels use it bare. `storyAge` is
 * gone.
 *
 * **The ladder rounds DOWN to the coarsest honest unit.** "an hour ago" rather
 * than "60 minutes ago", "a day ago" rather than "25 hours ago" — a reader
 * checking whether the map is current wants a magnitude, not arithmetic.
 */
export function ago(at: number, now: number): string {
  if (Number.isNaN(at)) return "";

  const minutes = Math.floor((now - at) / 60_000);
  /**
   * Clock skew between the publisher, the runner and the visitor is real and
   * small. "-3 minutes ago" reads as a bug; "just now" is both truer and calmer.
   */
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "an hour ago";
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "a day ago" : `${days} days ago`;
}
