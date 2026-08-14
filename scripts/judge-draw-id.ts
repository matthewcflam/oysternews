/**
 * The draw fingerprint — what stops a judged sheet being scored against the
 * wrong sample.
 *
 * **This exists because it nearly happened, 2026-08-14.** `audit_sample_judge.jsonl`
 * was committed in `98fac58`, then re-drawn with the same seed before the sheet
 * was sent out. Record ids were `<seed36>-<index>`, so both draws produced
 * `c29ce-0` … `c29ce-89` — **identical ids over completely different articles**.
 * `score-audit.ts` joins on id alone, matched all 90, warned about nothing, and
 * returned pins 82.2% / containers 65.8%, which reads as **KILL CONTAINERS**.
 * The true numbers were 68.1% / 83.3%. One stale file and the project would have
 * amputated a feature on a verdict that was pure noise.
 *
 * The defect is that the id was derived from the *seed* and the draw is not a
 * function of the seed. `draw-judge-sample.ts` walks back from the newest GDELT
 * bundle, so `--seed 12345` means a different population every time it is run.
 * "Reproducible from (seed, bundles) alone" was true of the shuffle and false of
 * the thing being shuffled.
 *
 * So the id carries a hash of the drawn URLs, in draw order, and the scorer
 * recomputes it from the sample it was handed. Different articles, different id,
 * loud failure. It is 6 hex characters over a 90-element list — collision is not
 * the threat model here, silence is.
 */

import { createHash } from "node:crypto";

/** Stable over the drawn URLs in draw order. Short: it goes in every record id. */
export function drawFingerprint(urls: string[]): string {
  return createHash("sha256").update(urls.join("\n")).digest("hex").slice(0, 6);
}

/**
 * `<seed36>-<fingerprint>-<index>` for a fingerprinted draw, `<seed36>-<index>`
 * for one drawn before 2026-08-14.
 *
 * Segment count is what tells them apart, which is why the fingerprint is its
 * own segment rather than glued to the seed. Legacy ids cannot be verified at
 * all — there is nothing in them that describes their content — so they are
 * reported rather than rejected: the archived `judged-c29ce-90.jsonl` is real
 * evidence and must stay re-scorable.
 */
export function fingerprintOf(recordId: string): string | null {
  const parts = recordId.split("-");
  return parts.length >= 3 ? parts[parts.length - 2] : null;
}
